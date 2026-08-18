//! Periodic and event-triggered polling of the Rivian consumer GraphQL API.
//!
//! This module is intentionally separate from rivian_auth.rs (which owns the
//! login flow) and ws_client.rs (which owns the real-time subscription).
//!
//! ## Stewardship
//! Every outbound HTTP call increments `outbound_graphql_requests` in
//! `riviamigo.rivian_stewardship_counters`.  The caller is responsible for
//! invoking [`increment_poll_counter`] after each successful request.

use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::ingestion::rivian_auth::rivian_refresh_csrf;
use crate::ingestion::session_store::{decrypt_tokens, encrypt_tokens, RivianTokenBundle};
use crate::services::charge_backfill::{self, ChargeBackfillError};
use crate::services::charge_sessions::{
    self, ChargeSessionPayloadRef, ChargeSessionSummaryPayload, UnmatchedInsertPolicy,
};

mod transport;

pub use transport::{gql_request, AuthError};

// ── URL constants ────────────────────────────────────────────────────────────

const GATEWAY_URL: &str = "https://rivian.com/api/gql/gateway/graphql";
const CHRG_URL: &str = "https://rivian.com/api/gql/chrg/user/graphql";

fn json_number_as_f64(value: Option<&serde_json::Value>) -> Option<f64> {
    match value {
        Some(serde_json::Value::Number(n)) => n.as_f64(),
        Some(serde_json::Value::String(s)) => s.parse().ok(),
        _ => None,
    }
}

// ── Token-refresh helpers ────────────────────────────────────────────────────

/// Returns `true` when the error is the typed [`AuthError`] marker — i.e. the
/// Rivian API explicitly reported an authentication failure (HTTP 401 or
/// GraphQL `extensions.code = "UNAUTHENTICATED"`).  Substring matching of
/// `Error::to_string()` was previously used here and produced false positives
/// against our own error-wrapper strings.
fn is_auth_error(e: &anyhow::Error) -> bool {
    e.downcast_ref::<AuthError>().is_some()
}

/// Refresh the CSRF/app-session tokens and persist the updated bundle.
/// The access token is preserved unchanged — only the short-lived CSRF pair rotates.
async fn try_refresh_csrf(
    vehicle_id: Uuid,
    current_tokens: &RivianTokenBundle,
    client: &reqwest::Client,
    pool: &PgPool,
    age_key: &str,
) -> Result<RivianTokenBundle> {
    tracing::info!(vehicle_id=%vehicle_id, "refreshing Rivian CSRF session");

    let new_tokens = rivian_refresh_csrf(client, current_tokens)
        .await
        .map_err(|e| anyhow!("CSRF refresh failed: {e}"))?;

    let identity = age_key
        .parse::<age::x25519::Identity>()
        .map_err(|e| anyhow!("bad age key: {e}"))?;

    let encrypted = encrypt_tokens(&new_tokens, &identity)?;

    sqlx::query(
        "INSERT INTO riviamigo.vehicle_credentials
            (vehicle_id, encrypted_tokens, token_created_at, last_refreshed_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (vehicle_id) DO UPDATE
         SET encrypted_tokens = EXCLUDED.encrypted_tokens,
             last_refreshed_at = now()",
    )
    .bind(vehicle_id)
    .bind(&encrypted)
    .bind(new_tokens.created_at)
    .execute(pool)
    .await?;

    tracing::info!(vehicle_id=%vehicle_id, "Rivian CSRF session refreshed");
    Ok(new_tokens)
}

async fn load_vehicle_tokens(
    vehicle_id: Uuid,
    pool: &PgPool,
    age_key: &str,
) -> Result<(String, RivianTokenBundle)> {
    let identity = age_key
        .parse::<age::x25519::Identity>()
        .map_err(|e| anyhow!("bad age key: {e}"))?;

    let row = sqlx::query_as::<_, (String, Vec<u8>)>(
        "SELECT v.rivian_vehicle_id, c.encrypted_tokens
         FROM riviamigo.vehicles v
         JOIN riviamigo.vehicle_credentials c ON c.vehicle_id = v.id
         WHERE v.id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow!("vehicle {vehicle_id} has no Rivian credentials"))?;

    let (rivian_vehicle_id, encrypted_tokens) = row;
    let tokens = decrypt_tokens(&encrypted_tokens, &identity)
        .map_err(|e| anyhow!("failed to decrypt Rivian credentials: {e}"))?;
    tokens
        .validate()
        .map_err(|e| anyhow!("Rivian credential bundle is invalid: {e}"))?;

    Ok((rivian_vehicle_id, tokens))
}

async fn with_vehicle_auth_retry<T, F>(
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
    operation_name: &'static str,
    mut operation: F,
) -> Result<T>
where
    for<'a> F: FnMut(
        &'a str,
        &'a RivianTokenBundle,
        &'a PgPool,
        &'a reqwest::Client,
    ) -> BoxFuture<'a, Result<T>>,
{
    let (rivian_vehicle_id, current_tokens) =
        load_vehicle_tokens(vehicle_id, pool, age_key).await?;

    match operation(&rivian_vehicle_id, &current_tokens, pool, client).await {
        Ok(value) => {
            reset_auth_failure_counter(pool, vehicle_id).await;
            Ok(value)
        }
        Err(error) if is_auth_error(&error) => {
            // CSRF/app-session may have expired — rotate them and retry once.
            // This mirrors the HA integration's RivianExpiredTokenError handler.
            // The access token itself is long-lived and is never refreshed here.
            tracing::info!(
                vehicle_id=%vehicle_id,
                operation=operation_name,
                "Rivian auth failed; rotating CSRF and retrying"
            );

            let refreshed_tokens =
                match try_refresh_csrf(vehicle_id, &current_tokens, client, pool, age_key).await {
                    Ok(tokens) => tokens,
                    Err(refresh_error) => {
                        tracing::warn!(
                            vehicle_id=%vehicle_id,
                            operation=operation_name,
                            err=%refresh_error,
                            "CSRF refresh failed"
                        );
                        record_auth_failure(pool, vehicle_id, &refresh_error.to_string()).await;
                        return Err(refresh_error);
                    }
                };

            match operation(&rivian_vehicle_id, &refreshed_tokens, pool, client).await {
                Ok(value) => {
                    reset_auth_failure_counter(pool, vehicle_id).await;
                    Ok(value)
                }
                Err(retry_error) if is_auth_error(&retry_error) => {
                    // Transient 401s can survive a single CSRF refresh.  Don't
                    // flip needs_reauth on the first occurrence — only after we
                    // see this happen consecutively over a meaningful window.
                    tracing::info!(
                        vehicle_id=%vehicle_id,
                        operation=operation_name,
                        "operation still unauthenticated after CSRF refresh"
                    );
                    record_auth_failure(pool, vehicle_id, &retry_error.to_string()).await;
                    Err(retry_error)
                }
                Err(other) => Err(other),
            }
        }
        Err(error) => Err(error),
    }
}

/// Threshold for flipping auth_state to `needs_reauth`.  A single transient
/// 401 is recoverable via the CSRF rotation that already ran; we only mark
/// the credentials as dead once we've seen repeated post-rotation failures.
const NEEDS_REAUTH_FAILURE_THRESHOLD: i32 = 3;

/// Increment the consecutive-failure counter.  Flip `auth_state` to
/// `needs_reauth` only after the counter crosses the threshold.
async fn record_auth_failure(pool: &PgPool, vehicle_id: Uuid, reason: &str) {
    let updated: Option<i32> = sqlx::query_scalar(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
               (vehicle_id, consecutive_auth_failures, last_auth_failure_at, updated_at)
           VALUES ($1, 1, now(), now())
           ON CONFLICT (vehicle_id) DO UPDATE
               SET consecutive_auth_failures = vehicle_runtime_state.consecutive_auth_failures + 1,
                   last_auth_failure_at = now(),
                   updated_at = now()
           RETURNING consecutive_auth_failures"#,
    )
    .bind(vehicle_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let count = updated.unwrap_or(1);
    tracing::debug!(
        vehicle_id=%vehicle_id,
        consecutive_auth_failures=count,
        "rivian auth failure counted"
    );

    if count >= NEEDS_REAUTH_FAILURE_THRESHOLD {
        mark_needs_reauth(pool, vehicle_id, reason).await;
    }
}

async fn reset_auth_failure_counter(pool: &PgPool, vehicle_id: Uuid) {
    let _ = sqlx::query(
        "UPDATE riviamigo.vehicle_runtime_state
            SET consecutive_auth_failures = 0,
                last_auth_failure_at = NULL,
                updated_at = now()
          WHERE vehicle_id = $1
            AND consecutive_auth_failures <> 0",
    )
    .bind(vehicle_id)
    .execute(pool)
    .await;
}

/// Write an auth-required state into `vehicle_runtime_state` while keeping
/// collector health separate from credential status.
async fn mark_needs_reauth(pool: &PgPool, vehicle_id: Uuid, reason: &str) {
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
           (vehicle_id, is_online, worker_health, worker_health_msg, auth_state, auth_reason_code, updated_at)
           VALUES ($1, false, 'error', $2, 'needs_reauth', 'rivian_auth_expired', now())
           ON CONFLICT (vehicle_id) DO UPDATE
           SET is_online = false,
               worker_health = 'error',
               worker_health_msg = $2,
               auth_state = 'needs_reauth',
               auth_reason_code = 'rivian_auth_expired',
               updated_at = now()"#,
    )
    .bind(vehicle_id)
    .bind(reason)
    .execute(pool)
    .await;
}

// ── Stewardship counter ──────────────────────────────────────────────────────

pub async fn increment_poll_counter(pool: &PgPool, vehicle_id: Uuid) {
    let today = Utc::now().date_naive();
    let _ = sqlx::query(
        "INSERT INTO riviamigo.rivian_stewardship_counters
             (vehicle_id, day, outbound_graphql_requests)
         VALUES ($1, $2, 1)
         ON CONFLICT (vehicle_id, day)
         DO UPDATE SET outbound_graphql_requests =
             rivian_stewardship_counters.outbound_graphql_requests + 1",
    )
    .bind(vehicle_id)
    .bind(today)
    .execute(pool)
    .await;
}

// ── Vehicle enrichment (getUserInfo static fields) ───────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserInfoEnrichmentData {
    current_user: Option<CurrentUserEnrichment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurrentUserEnrichment {
    vehicles: Option<Vec<VehicleEnrichmentItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleEnrichmentItem {
    id: String,
    vehicle: Option<VehicleEnrichmentDetails>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleEnrichmentDetails {
    mobile_configuration: Option<MobileConfiguration>,
    vehicle_state: Option<VehicleStateEnrichment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobileConfiguration {
    trim_option: Option<MobileConfigOption>,
    #[allow(dead_code)]
    exterior_color_option: Option<MobileConfigOption>,
    interior_color_option: Option<MobileConfigOption>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct MobileConfigOption {
    option_id: Option<String>,
    option_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleStateEnrichment {
    #[serde(rename = "supportedFeatures")]
    supported_features: Option<Vec<SupportedFeature>>,
}

/// API response shape — `status` field is received from Rivian but not used locally.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct SupportedFeature {
    name: Option<String>,
    status: Option<String>,
}

/// Fetch trim/interior/wheel/charger-port static fields and upsert into `vehicles`.
pub async fn fetch_vehicle_enrichment(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<()> {
    const Q: &str = r#"
        query getUserInfo {
          currentUser {
            vehicles {
              id
              vehicle {
                mobileConfiguration {
                  trimOption          { optionId optionName }
                  exteriorColorOption { optionId optionName }
                  interiorColorOption { optionId optionName }
                }
                vehicleState {
                  supportedFeatures {
                    name
                    status
                  }
                }
              }
            }
          }
        }
    "#;

    let data: UserInfoEnrichmentData = gql_request(
        client,
        GATEWAY_URL,
        tokens,
        "getUserInfo",
        Q,
        serde_json::Value::Null,
    )
    .await?;

    let item = data
        .current_user
        .and_then(|u| u.vehicles)
        .unwrap_or_default()
        .into_iter()
        .find(|v| v.id == rivian_vehicle_id);

    let Some(item) = item else {
        return Err(anyhow!(
            "vehicle {rivian_vehicle_id} not found in getUserInfo"
        ));
    };

    let details = item.vehicle;
    let mobile_config = details
        .as_ref()
        .and_then(|d| d.mobile_configuration.as_ref());
    let interior_color = mobile_config
        .and_then(|m| m.interior_color_option.as_ref())
        .and_then(|o| o.option_name.clone());
    let trim = mobile_config
        .and_then(|m| m.trim_option.as_ref())
        .and_then(|o| o.option_name.clone());

    let features_json: Option<serde_json::Value> = details
        .and_then(|d| d.vehicle_state)
        .and_then(|state| state.supported_features)
        .map(|feats| {
            serde_json::Value::Array(
                feats
                    .into_iter()
                    .filter_map(|f| f.name)
                    .map(serde_json::Value::String)
                    .collect(),
            )
        });

    sqlx::query(
        "UPDATE riviamigo.vehicles
         SET interior_color     = COALESCE($2, interior_color),
             trim               = COALESCE($3, trim),
             supported_features = COALESCE($4, supported_features),
             updated_at         = now()
         WHERE id = $1",
    )
    .bind(vehicle_id)
    .bind(interior_color)
    .bind(trim)
    .bind(features_json)
    .execute(pool)
    .await?;

    increment_poll_counter(pool, vehicle_id).await;
    tracing::debug!(vehicle_id=%vehicle_id, "vehicle enrichment upserted");
    Ok(())
}

// ── Wallboxes ─────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WallboxesData {
    get_registered_wallboxes: Option<Vec<WallboxItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WallboxItem {
    wallbox_id: Option<String>,
    name: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    max_power: Option<serde_json::Value>,
    model: Option<String>,
    serial_number: Option<String>,
    #[serde(rename = "softwareVersion")]
    firmware_version: Option<String>,
    linked: Option<bool>,
}

/// Fetch registered home wallboxes and upsert into `riviamigo.wallboxes`.
pub async fn fetch_wallboxes(
    user_id: Uuid,
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<()> {
    const Q: &str = r#"
        query getRegisteredWallboxes {
          getRegisteredWallboxes {
            wallboxId
            name
            latitude
            longitude
            maxPower
            model
            serialNumber
            softwareVersion
            linked
          }
        }
    "#;

    let data: WallboxesData = gql_request(
        client,
        CHRG_URL,
        tokens,
        "getRegisteredWallboxes",
        Q,
        serde_json::Value::Null,
    )
    .await?;

    let boxes = data.get_registered_wallboxes.unwrap_or_default();
    for wb in &boxes {
        let Some(wb_id) = &wb.wallbox_id else {
            continue;
        };
        sqlx::query(
            "INSERT INTO riviamigo.wallboxes
                 (user_id, rivian_wallbox_id, name, latitude, longitude,
                  max_power_kw, model, serial_number, firmware_version, linked)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (user_id, rivian_wallbox_id) DO UPDATE SET
                 name             = EXCLUDED.name,
                 latitude         = EXCLUDED.latitude,
                 longitude        = EXCLUDED.longitude,
                 max_power_kw     = EXCLUDED.max_power_kw,
                 model            = EXCLUDED.model,
                 serial_number    = EXCLUDED.serial_number,
                 firmware_version = EXCLUDED.firmware_version,
                 linked           = EXCLUDED.linked,
                 updated_at       = now()",
        )
        .bind(user_id)
        .bind(wb_id)
        .bind(&wb.name)
        .bind(wb.latitude)
        .bind(wb.longitude)
        .bind(json_number_as_f64(wb.max_power.as_ref()))
        .bind(&wb.model)
        .bind(&wb.serial_number)
        .bind(&wb.firmware_version)
        .bind(wb.linked)
        .execute(pool)
        .await?;
    }

    increment_poll_counter(pool, vehicle_id).await;
    tracing::debug!(vehicle_id=%vehicle_id, count=%boxes.len(), "wallboxes upserted");
    Ok(())
}

pub async fn fetch_vehicle_enrichment_for_vehicle(
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
) -> Result<()> {
    with_vehicle_auth_retry(
        vehicle_id,
        pool,
        client,
        age_key,
        "fetch_vehicle_enrichment",
        move |rivian_vehicle_id, tokens, pool, client| {
            Box::pin(async move {
                fetch_vehicle_enrichment(rivian_vehicle_id, vehicle_id, pool, client, tokens).await
            })
        },
    )
    .await
}

pub async fn fetch_wallboxes_for_vehicle(
    user_id: Uuid,
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
) -> Result<()> {
    with_vehicle_auth_retry(
        vehicle_id,
        pool,
        client,
        age_key,
        "fetch_wallboxes",
        move |_rivian_vehicle_id, tokens, pool, client| {
            Box::pin(
                async move { fetch_wallboxes(user_id, vehicle_id, pool, client, tokens).await },
            )
        },
    )
    .await
}

// ── Charge session history ────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompletedSessionsData {
    get_completed_session_summaries: Option<Vec<ChargeSessionSummaryPayload>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct CompletedSessionItem {
    /// Rivian's own session identifier
    transaction_id: Option<String>,
    start_instant: Option<DateTime<Utc>>,
    end_instant: Option<DateTime<Utc>>,
    charger_type: Option<String>,
    currency_code: Option<String>,
    /// kWh added during the session
    total_energy_kwh: Option<f64>,
    /// km of range added
    range_added_km: Option<f64>,
    city: Option<String>,
    vehicle_id: Option<String>,
    vehicle_name: Option<String>,
    /// e.g. "Rivian", "Electrify America"
    vendor: Option<String>,
    /// Total billed amount in USD (Rivian network only)
    paid_total: Option<f64>,
    is_public: Option<bool>,
    /// SoC at session start (0–100)
    is_home_charger: Option<bool>,
    /// SoC at session end (0–100)
    is_roaming_network: Option<bool>,
    meta: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveSessionHistoryData {
    get_live_session_history: Option<LiveSessionHistory>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveSessionHistory {
    chart_data: Option<Vec<LiveCurvePoint>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveCurvePoint {
    kw: Option<f64>,
    time: Option<DateTime<Utc>>,
}

const RECENT_INCREMENTAL_INSERT_LOOKBACK_DAYS: i64 = 30;
const LIVE_CURVE_OVERLAP_MINUTES: i64 = 5;

async fn record_charge_history_sync_started(pool: &PgPool, vehicle_id: Uuid) {
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
           (vehicle_id, last_charge_history_sync_at, updated_at)
           VALUES ($1, now(), now())
           ON CONFLICT (vehicle_id) DO UPDATE
           SET last_charge_history_sync_at = now(),
               updated_at = now()"#,
    )
    .bind(vehicle_id)
    .execute(pool)
    .await;
}

async fn record_charge_history_sync_succeeded(pool: &PgPool, vehicle_id: Uuid) {
    let _ = sqlx::query(
        r#"INSERT INTO riviamigo.vehicle_runtime_state
           (vehicle_id, last_charge_history_sync_at, last_charge_history_success_at, updated_at)
           VALUES ($1, now(), now(), now())
           ON CONFLICT (vehicle_id) DO UPDATE
           SET last_charge_history_sync_at = now(),
               last_charge_history_success_at = now(),
               updated_at = now()"#,
    )
    .bind(vehicle_id)
    .execute(pool)
    .await;
}

/// Fetch completed charge sessions from Rivian's charging endpoint.
///
/// ## Modes
/// - **`full_backfill = false`** (post-session enrichment): enriches existing
///   local rows by matching on `rivian_session_id` then by start-time window.
///   Recent completed sessions without a local match are inserted so missed
///   telemetry sessions can still land in the canonical charging history.
/// - **`full_backfill = true`** (first-start backfill): additionally INSERTs
///   sessions that have no local match at all, tagged with `source = 'rivian_api'`.
///   Paginates until the API returns fewer than `PAGE_SIZE` results (cap: 50 pages).
pub async fn fetch_charge_history(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<usize> {
    fetch_charge_history_inner_v2(rivian_vehicle_id, vehicle_id, false, pool, client, tokens).await
}

pub async fn fetch_charge_history_for_vehicle(
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
) -> Result<usize> {
    record_charge_history_sync_started(pool, vehicle_id).await;
    let result = with_vehicle_auth_retry(
        vehicle_id,
        pool,
        client,
        age_key,
        "fetch_charge_history",
        move |rivian_vehicle_id, tokens, pool, client| {
            Box::pin(async move {
                fetch_charge_history(rivian_vehicle_id, vehicle_id, pool, client, tokens).await
            })
        },
    )
    .await;

    if result.is_ok() {
        record_charge_history_sync_succeeded(pool, vehicle_id).await;
    }

    result
}

/// Same as [`fetch_charge_history`] but inserts new sessions from the API that
/// have no local counterpart (for the first-start full backfill flow).
pub async fn fetch_charge_history_full(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<usize> {
    fetch_charge_history_inner_v2(rivian_vehicle_id, vehicle_id, true, pool, client, tokens).await
}

async fn fetch_charge_history_inner_v2(
    _rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    full_backfill: bool,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<usize> {
    // Hold a distributed per-vehicle transaction lock across the upstream fetch
    // and reconciliation writes. SQLx rolls back a dropped transaction before
    // reusing its pooled connection, so cancellation cannot leak the lock.
    let mut lock_transaction = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("rivian-charge-history:{vehicle_id}"))
        .execute(&mut *lock_transaction)
        .await?;

    let result = fetch_charge_history_locked(vehicle_id, full_backfill, pool, client, tokens).await;
    if let Err(error) = lock_transaction.rollback().await {
        tracing::error!(vehicle_id=%vehicle_id, error=%error, "charge history lock release failed");
        if result.is_ok() {
            return Err(anyhow!(
                "failed to release charge-history transaction lock: {error}"
            ));
        }
    }

    result
}

async fn fetch_charge_history_locked(
    vehicle_id: Uuid,
    full_backfill: bool,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<usize> {
    const Q: &str = r#"
        query getCompletedSessionSummaries {
          getCompletedSessionSummaries {
            transactionId
            startInstant
            endInstant
            totalEnergyKwh
            rangeAddedKm
            vendor
            paidTotal
            chargerType
            currencyCode
            city
            vehicleId
            vehicleName
            isPublic
            isHomeCharger
            isRoamingNetwork
            meta {
              transactionIdGroupingKey
              dataSources
            }
          }
        }
    "#;

    let data: CompletedSessionsData = gql_request(
        client,
        CHRG_URL,
        tokens,
        "getCompletedSessionSummaries",
        Q,
        serde_json::Value::Null,
    )
    .await?;

    increment_poll_counter(pool, vehicle_id).await;

    let insert_policy = if full_backfill {
        UnmatchedInsertPolicy::Always
    } else {
        UnmatchedInsertPolicy::RecentOnly {
            now: Utc::now(),
            lookback_days: RECENT_INCREMENTAL_INSERT_LOOKBACK_DAYS,
        }
    };

    let mut total_processed = 0usize;
    let mut total_linked = 0usize;
    let mut payloads_reused = 0usize;
    let mut payloads_inserted = 0usize;
    for summary in &data.get_completed_session_summaries.unwrap_or_default() {
        let payload = serde_json::to_value(summary).unwrap_or_else(|_| serde_json::json!({}));
        let payload_ref = match record_charge_payload_with_ref(
            pool,
            vehicle_id,
            "getCompletedSessionSummaries",
            summary.transaction_id.as_deref(),
            summary.vehicle_id.as_deref(),
            payload,
        )
        .await
        {
            Ok(payload_ref) => {
                if payload_ref.unchanged {
                    payloads_reused += 1;
                } else {
                    payloads_inserted += 1;
                }
                Some(payload_ref)
            }
            Err(error) => {
                tracing::debug!(vehicle_id=%vehicle_id, error=%error, "charge history payload audit failed");
                None
            }
        };

        let already_linked_session = unchanged_linked_session(payload_ref);
        let matched_session_id = if let Some(session_id) = already_linked_session {
            Some(session_id)
        } else {
            charge_sessions::reconcile_completed_session_summary(
                pool,
                vehicle_id,
                summary,
                insert_policy,
                payload_ref,
            )
            .await?
        };

        if let (Some(payload_ref), Some(session_id)) = (
            payload_ref.filter(|_| already_linked_session.is_none()),
            matched_session_id,
        ) {
            sqlx::query(
                "UPDATE riviamigo.rivian_charge_payloads
                 SET charge_session_id = $2
                 WHERE id = $1
                   AND charge_session_id IS DISTINCT FROM $2",
            )
            .bind(payload_ref.payload_id)
            .bind(session_id)
            .execute(pool)
            .await?;
        }

        if let Some(session_id) = matched_session_id.filter(|_| already_linked_session.is_none()) {
            total_linked += 1;
            let _ = crate::services::cost::recompute_charge_session_cost(pool, session_id).await?;
        }

        total_processed += 1;
    }

    tracing::debug!(
        vehicle_id=%vehicle_id,
        total_processed,
        total_linked,
        payloads_inserted,
        payloads_reused,
        full_backfill,
        "charge history synced"
    );

    Ok(total_processed)
}

fn unchanged_linked_session(payload_ref: Option<ChargeSessionPayloadRef>) -> Option<Uuid> {
    payload_ref.and_then(|payload| {
        if payload.unchanged {
            payload.charge_session_id
        } else {
            None
        }
    })
}

async fn record_charge_payload_with_ref(
    pool: &PgPool,
    vehicle_id: Uuid,
    operation: &str,
    rivian_transaction_id: Option<&str>,
    rivian_vehicle_id: Option<&str>,
    payload: serde_json::Value,
) -> Result<ChargeSessionPayloadRef> {
    let mut tx = pool.begin().await?;

    let existing = sqlx::query_as::<_, (Uuid, DateTime<Utc>, Option<Uuid>)>(
        r#"WITH candidate AS (
               SELECT digest(convert_to(riviamigo.semantic_charge_payload($5::jsonb)::text, 'UTF8'), 'sha256') AS fingerprint,
                      digest(convert_to(concat_ws(
                          E'\x1f', $1::text, $2, coalesce($3, ''), coalesce($4, ''),
                          encode(digest(convert_to(riviamigo.semantic_charge_payload($5::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
                      ), 'UTF8'), 'sha256') AS identity_key
           )
           SELECT payload.id, payload.captured_at, payload.charge_session_id
           FROM candidate
           JOIN riviamigo.rivian_charge_payload_identities identity
             ON identity.identity_key = candidate.identity_key
           JOIN riviamigo.rivian_charge_payloads payload
             ON payload.id = identity.canonical_payload_id
           LIMIT 1"#,
    )
    .bind(vehicle_id)
    .bind(operation)
    .bind(rivian_transaction_id)
    .bind(rivian_vehicle_id)
    .bind(&payload)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(existing) = existing {
        tx.commit().await?;
        return Ok(ChargeSessionPayloadRef {
            payload_id: existing.0,
            captured_at: existing.1,
            charge_session_id: existing.2,
            unchanged: true,
        });
    }

    // A historical row may not have reached the background identity worker
    // yet. Reconcile that row before inserting a new payload so replay
    // idempotency remains intact while the worker is catching up.
    let pending_existing = sqlx::query_as::<_, (Uuid, DateTime<Utc>, Option<Uuid>)>(
        r#"SELECT payload.id, payload.captured_at, payload.charge_session_id
           FROM riviamigo.rivian_charge_payloads payload
           WHERE payload.vehicle_id = $1
             AND payload.operation = $2
             AND payload.rivian_transaction_id IS NOT DISTINCT FROM $3::text
             AND payload.rivian_vehicle_id IS NOT DISTINCT FROM $4::text
             AND payload.payload_fingerprint IS NULL
             AND digest(
                     convert_to(
                         riviamigo.semantic_charge_payload(payload.payload)::text,
                         'UTF8'
                     ),
                     'sha256'
                 ) = digest(
                     convert_to(
                         riviamigo.semantic_charge_payload($5::jsonb)::text,
                         'UTF8'
                     ),
                     'sha256'
                 )
           ORDER BY payload.captured_at, payload.id
           LIMIT 1
           FOR UPDATE"#,
    )
    .bind(vehicle_id)
    .bind(operation)
    .bind(rivian_transaction_id)
    .bind(rivian_vehicle_id)
    .bind(&payload)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(pending_existing) = pending_existing {
        sqlx::query(
            r#"UPDATE riviamigo.rivian_charge_payloads
               SET payload_fingerprint = digest(
                   convert_to(
                       riviamigo.semantic_charge_payload(payload)::text,
                       'UTF8'
                   ),
                   'sha256'
               )
               WHERE id = $1 AND payload_fingerprint IS NULL"#,
        )
        .bind(pending_existing.0)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"WITH candidate AS (
                   SELECT digest(
                              convert_to(
                                  riviamigo.semantic_charge_payload($5::jsonb)::text,
                                  'UTF8'
                              ),
                              'sha256'
                          ) AS fingerprint
               )
               INSERT INTO riviamigo.rivian_charge_payload_identities (
                   identity_key, vehicle_id, operation, payload_fingerprint,
                   canonical_payload_id
               )
               SELECT digest(
                          convert_to(
                              concat_ws(
                                  E'\\x1f',
                                  $1::text,
                                  $2,
                                  coalesce($3::text, ''),
                                  coalesce($4::text, ''),
                                  encode(candidate.fingerprint, 'hex')
                              ),
                              'UTF8'
                          ),
                          'sha256'
                      ),
                      $1,
                      $2,
                      candidate.fingerprint,
                      $6
               FROM candidate
               ON CONFLICT (identity_key) DO NOTHING"#,
        )
        .bind(vehicle_id)
        .bind(operation)
        .bind(rivian_transaction_id)
        .bind(rivian_vehicle_id)
        .bind(&payload)
        .bind(pending_existing.0)
        .execute(&mut *tx)
        .await?;

        let canonical = sqlx::query_as::<_, (Uuid, DateTime<Utc>, Option<Uuid>)>(
            r#"WITH candidate AS (
                   SELECT digest(
                              convert_to(
                                  concat_ws(
                                      E'\\x1f',
                                      $1::text,
                                      $2,
                                      coalesce($3::text, ''),
                                      coalesce($4::text, ''),
                                      encode(
                                          digest(
                                              convert_to(
                                                  riviamigo.semantic_charge_payload($5::jsonb)::text,
                                                  'UTF8'
                                              ),
                                              'sha256'
                                          ),
                                          'hex'
                                      )
                                  ),
                                  'UTF8'
                              ),
                              'sha256'
                          ) AS identity_key
               )
               SELECT payload.id, payload.captured_at, payload.charge_session_id
               FROM candidate
               JOIN riviamigo.rivian_charge_payload_identities identity
                 ON identity.identity_key = candidate.identity_key
               JOIN riviamigo.rivian_charge_payloads payload
                 ON payload.id = identity.canonical_payload_id
               LIMIT 1"#,
        )
        .bind(vehicle_id)
        .bind(operation)
        .bind(rivian_transaction_id)
        .bind(rivian_vehicle_id)
        .bind(&payload)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;
        return Ok(ChargeSessionPayloadRef {
            payload_id: canonical.0,
            captured_at: canonical.1,
            charge_session_id: canonical.2,
            unchanged: true,
        });
    }

    let charge_session_id: Option<Uuid> = if let Some(transaction_id) = rivian_transaction_id {
        sqlx::query_scalar(
            r#"SELECT cs.id
               FROM riviamigo.charge_sessions cs
               LEFT JOIN riviamigo.charge_session_external_aliases alias
                 ON alias.charge_session_id = cs.id
               WHERE cs.vehicle_id = $1
                 AND (cs.rivian_session_id = $2 OR alias.external_id = $2)
               ORDER BY cs.started_at DESC
               LIMIT 1"#,
        )
        .bind(vehicle_id)
        .bind(transaction_id)
        .fetch_optional(&mut *tx)
        .await?
    } else {
        None
    };

    let candidate_id = Uuid::new_v4();
    let inserted = sqlx::query_as::<_, (Uuid, DateTime<Utc>)>(
        r#"WITH candidate AS (
               SELECT digest(convert_to(riviamigo.semantic_charge_payload($6::jsonb)::text, 'UTF8'), 'sha256') AS fingerprint
           )
           INSERT INTO riviamigo.rivian_charge_payloads
               (id, vehicle_id, charge_session_id, operation, rivian_transaction_id,
                rivian_vehicle_id, payload_fingerprint, payload)
           SELECT $1, $2, $3, $4, $5, $7, candidate.fingerprint, $6
           FROM candidate
           RETURNING id, captured_at"#,
    )
    .bind(candidate_id)
    .bind(vehicle_id)
    .bind(charge_session_id)
    .bind(operation)
    .bind(rivian_transaction_id)
    .bind(&payload)
    .bind(rivian_vehicle_id)
    .fetch_one(&mut *tx)
    .await?;

    let canonical = sqlx::query_scalar::<_, Uuid>(
        r#"WITH candidate AS (
               SELECT digest(convert_to(riviamigo.semantic_charge_payload($5::jsonb)::text, 'UTF8'), 'sha256') AS fingerprint,
                      digest(convert_to(concat_ws(
                          E'\x1f', $1::text, $2, coalesce($3, ''), coalesce($4, ''),
                          encode(
                              digest(convert_to(riviamigo.semantic_charge_payload($5::jsonb)::text, 'UTF8'), 'sha256'),
                              'hex'
                          )
                      ), 'UTF8'), 'sha256') AS identity_key
           )
           INSERT INTO riviamigo.rivian_charge_payload_identities
               (identity_key, vehicle_id, operation, payload_fingerprint, canonical_payload_id)
           SELECT candidate.identity_key, $1, $2, candidate.fingerprint, $6
           FROM candidate
           ON CONFLICT (identity_key) DO NOTHING
           RETURNING canonical_payload_id"#,
    )
    .bind(vehicle_id)
    .bind(operation)
    .bind(rivian_transaction_id)
    .bind(rivian_vehicle_id)
    .bind(&payload)
    .bind(candidate_id)
    .fetch_optional(&mut *tx)
    .await?;

    if canonical.is_none() {
        sqlx::query("DELETE FROM riviamigo.rivian_charge_payloads WHERE id = $1")
            .bind(candidate_id)
            .execute(&mut *tx)
            .await?;
        let existing = sqlx::query_as::<_, (Uuid, DateTime<Utc>, Option<Uuid>)>(
            r#"WITH candidate AS (
                   SELECT digest(convert_to(riviamigo.semantic_charge_payload($5::jsonb)::text, 'UTF8'), 'sha256') AS identity_payload,
                          digest(convert_to(concat_ws(
                              E'\x1f', $1::text, $2, coalesce($3, ''), coalesce($4, ''),
                              encode(digest(convert_to(riviamigo.semantic_charge_payload($5::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
                          ), 'UTF8'), 'sha256') AS identity_key
               )
               SELECT payload.id, payload.captured_at, payload.charge_session_id
               FROM candidate
               JOIN riviamigo.rivian_charge_payload_identities identity
                 ON identity.identity_key = candidate.identity_key
               JOIN riviamigo.rivian_charge_payloads payload
                 ON payload.id = identity.canonical_payload_id
               LIMIT 1"#,
        )
        .bind(vehicle_id)
        .bind(operation)
        .bind(rivian_transaction_id)
        .bind(rivian_vehicle_id)
        .bind(&payload)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(ChargeSessionPayloadRef {
            payload_id: existing.0,
            captured_at: existing.1,
            charge_session_id: existing.2,
            unchanged: true,
        });
    }

    tx.commit().await?;
    Ok(ChargeSessionPayloadRef {
        payload_id: inserted.0,
        captured_at: inserted.1,
        charge_session_id,
        unchanged: false,
    })
}

const LIVE_SESSION_HISTORY_QUERY: &str = r#"
    query getLiveSessionHistory($vehicleId: ID!) {
      getLiveSessionHistory(vehicleId: $vehicleId) {
        chartData { kw time }
      }
    }
"#;

pub async fn fetch_live_session_history(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    active_session_id: Option<Uuid>,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<usize> {
    let data: LiveSessionHistoryData = gql_request(
        client,
        CHRG_URL,
        tokens,
        "getLiveSessionHistory",
        LIVE_SESSION_HISTORY_QUERY,
        serde_json::json!({ "vehicleId": rivian_vehicle_id }),
    )
    .await?;
    increment_poll_counter(pool, vehicle_id).await;

    let points = data
        .get_live_session_history
        .and_then(|history| history.chart_data)
        .unwrap_or_default();
    let latest_stored: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT MAX(ts) FROM riviamigo.rivian_charge_curve_points WHERE vehicle_id = $1",
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;
    let cutoff =
        latest_stored.map(|latest| latest - chrono::Duration::minutes(LIVE_CURVE_OVERLAP_MINUTES));
    let records_received = points.len();
    let mut selected = points
        .into_iter()
        .filter_map(|point| point.time.map(|ts| (ts, point.kw)))
        .filter(|(ts, _)| cutoff.is_none_or(|cutoff| *ts >= cutoff))
        .collect::<Vec<_>>();
    selected.sort_by_key(|(ts, _)| *ts);
    if selected.is_empty() {
        tracing::debug!(
            vehicle_id=%vehicle_id,
            records_received,
            records_selected=0,
            curve_points_changed=0,
            "live charge curve unchanged"
        );
        return Ok(0);
    }

    let timestamps = selected.iter().map(|(ts, _)| *ts).collect::<Vec<_>>();
    let power = selected.iter().map(|(_, power)| *power).collect::<Vec<_>>();
    let actions = sqlx::query_scalar::<_, bool>(
        r#"INSERT INTO riviamigo.rivian_charge_curve_points
               (vehicle_id, charge_session_id, ts, power_kw)
           SELECT $1, $2, incoming.ts, incoming.power_kw
           FROM unnest($3::timestamptz[], $4::double precision[])
               AS incoming(ts, power_kw)
           ON CONFLICT (vehicle_id, ts)
           DO UPDATE SET
               charge_session_id = COALESCE(
                   rivian_charge_curve_points.charge_session_id,
                   EXCLUDED.charge_session_id
               ),
               power_kw = COALESCE(
                   EXCLUDED.power_kw,
                   rivian_charge_curve_points.power_kw
               )
           WHERE rivian_charge_curve_points.charge_session_id IS DISTINCT FROM
                     COALESCE(
                         rivian_charge_curve_points.charge_session_id,
                         EXCLUDED.charge_session_id
                     )
              OR rivian_charge_curve_points.power_kw IS DISTINCT FROM
                     COALESCE(
                         EXCLUDED.power_kw,
                         rivian_charge_curve_points.power_kw
                     )
           RETURNING xmax = 0"#,
    )
    .bind(vehicle_id)
    .bind(active_session_id)
    .bind(&timestamps)
    .bind(&power)
    .fetch_all(pool)
    .await?;

    tracing::debug!(
        vehicle_id=%vehicle_id,
        records_received,
        records_selected=selected.len(),
        curve_points_changed=actions.len(),
        "live charge curve synchronized"
    );

    Ok(actions.len())
}

pub async fn fetch_live_session_history_for_vehicle(
    vehicle_id: Uuid,
    active_session_id: Option<Uuid>,
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
) -> Result<usize> {
    with_vehicle_auth_retry(
        vehicle_id,
        pool,
        client,
        age_key,
        "fetch_live_session_history",
        move |rivian_vehicle_id, tokens, pool, client| {
            Box::pin(async move {
                fetch_live_session_history(
                    rivian_vehicle_id,
                    vehicle_id,
                    active_session_id,
                    pool,
                    client,
                    tokens,
                )
                .await
            })
        },
    )
    .await
}

// ── Live session data (WebSocket chargingSession subscription) ──────────────

/// Serialized to Redis and served by GET /v1/vehicles/:id/live-session.
/// Field names must match the frontend LiveSession TypeScript interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveSessionData {
    pub soc_pct: Option<f64>,
    pub power_kw: Option<f64>,
    pub energy_kwh: Option<f64>,
    pub range_added_km: Option<f64>,
    pub time_remaining_min: Option<f64>,
    pub charger_type: Option<String>,
    pub ts: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charge_rate_kph: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_elapsed_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_free_session: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_charger_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
}

pub(crate) const LIVE_SESSION_TTL_SECONDS: u64 = 120;

pub(crate) fn live_session_redis_key(vehicle_id: Uuid) -> String {
    format!("vehicle:{vehicle_id}:live_session")
}

/// Convert the documented `chargingSession` payload into the existing live
/// Redis contract. `timeRemaining` and `timeElapsed` are seconds in Rivian's
/// charging payload; the public live-session field remains minutes.
pub fn normalize_charging_session(
    event: &crate::ingestion::parser::ChargingSessionEvent,
    received_at: DateTime<Utc>,
) -> Option<LiveSessionData> {
    let live = event.live_data.as_ref()?;
    let has_live_value = live.power_kw.is_some()
        || live.kilometers_charged_per_hour.is_some()
        || live.range_added_this_session.is_some()
        || live.total_charged_energy.is_some()
        || live.time_elapsed_seconds.is_some()
        || live.time_remaining_seconds.is_some()
        || live.price.is_some()
        || live.currency.is_some()
        || live.is_free_session.is_some()
        || live.vehicle_charger_state.is_some()
        || live.start_time.is_some();
    let has_chart_value = event.chart_data.iter().any(|point| {
        point.soc.is_some()
            || point.power_kw.is_some()
            || point.start_time.is_some()
            || point.end_time.is_some()
            || point.time_estimation_validity_status.is_some()
            || point.vehicle_charger_state.is_some()
    });
    if !has_live_value && !has_chart_value {
        return None;
    }
    Some(LiveSessionData {
        soc_pct: event.chart_data.iter().rev().find_map(|point| point.soc),
        power_kw: live.power_kw,
        energy_kwh: live.total_charged_energy,
        range_added_km: live.range_added_this_session,
        time_remaining_min: live.time_remaining_seconds.map(|seconds| seconds / 60.0),
        charger_type: live.vehicle_charger_state.clone(),
        ts: received_at,
        charge_rate_kph: live.kilometers_charged_per_hour,
        time_elapsed_seconds: live.time_elapsed_seconds,
        price: live.price,
        currency: live.currency.clone(),
        is_free_session: live.is_free_session,
        vehicle_charger_state: live.vehicle_charger_state.clone(),
        started_at: live.start_time,
    })
}

/// Persist the fields that belong to the active canonical charge session.
/// The WebSocket worker owns when this is called; this helper owns the SQL
/// shape so HTTP history and live-stream enrichment share one seam.
pub async fn persist_live_session_data(
    pool: &PgPool,
    active_session_id: Option<Uuid>,
    live: &LiveSessionData,
) -> Result<()> {
    let Some(session_id) = active_session_id else {
        return Ok(());
    };

    let updated = sqlx::query(
        "UPDATE riviamigo.charge_sessions SET
             live_current_price       = COALESCE($2, live_current_price),
             live_current_currency    = COALESCE($3, live_current_currency),
             live_total_charged_kwh   = COALESCE($4, live_total_charged_kwh),
             live_range_added_km      = COALESCE($5, live_range_added_km),
             live_power_kw            = COALESCE($6, live_power_kw),
             live_charge_rate_kph     = COALESCE($7, live_charge_rate_kph),
             live_time_elapsed_seconds = COALESCE($8, live_time_elapsed_seconds),
             live_session_started_at  = COALESCE($9, live_session_started_at),
             is_free_session          = COALESCE($10, is_free_session),
             kwh_added                = COALESCE(kwh_added, $4),
             range_added_km           = COALESCE(range_added_km, $5),
             source = CASE WHEN source = 'rivian_api'
                           THEN 'telemetry+rivian_api'
                           ELSE COALESCE(source, 'telemetry') END,
             data_confidence = CASE WHEN source = 'rivian_api'
                                    THEN 'telemetry_enriched'
                                    ELSE COALESCE(data_confidence, 'telemetry') END
         WHERE id = $1",
    )
    .bind(session_id)
    .bind(live.price)
    .bind(&live.currency)
    .bind(live.energy_kwh)
    .bind(live.range_added_km)
    .bind(live.power_kw)
    .bind(live.charge_rate_kph)
    .bind(
        live.time_elapsed_seconds
            .map(|seconds| seconds.round() as i32),
    )
    .bind(live.started_at)
    .bind(live.is_free_session)
    .execute(pool)
    .await?;

    if updated.rows_affected() > 0 {
        let _ = crate::services::cost::recompute_charge_session_cost(pool, session_id).await?;
    }
    Ok(())
}

/// Persist chart power points emitted by `chargingSession`. The existing
/// curve table deliberately stores only observed power; absent or malformed
/// timestamps are ignored instead of inventing samples.
pub async fn persist_charging_session_chart(
    pool: &PgPool,
    vehicle_id: Uuid,
    active_session_id: Option<Uuid>,
    points: &[crate::ingestion::parser::ChargingSessionChartPoint],
) -> Result<usize> {
    let selected = points
        .iter()
        .filter_map(|point| point.start_time.map(|ts| (ts, point.power_kw)))
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return Ok(0);
    }

    let timestamps = selected.iter().map(|(ts, _)| *ts).collect::<Vec<_>>();
    let power = selected.iter().map(|(_, power)| *power).collect::<Vec<_>>();
    let actions = sqlx::query_scalar::<_, bool>(
        r#"INSERT INTO riviamigo.rivian_charge_curve_points
               (vehicle_id, charge_session_id, ts, power_kw)
           SELECT $1, $2, incoming.ts, incoming.power_kw
           FROM unnest($3::timestamptz[], $4::double precision[])
               AS incoming(ts, power_kw)
           ON CONFLICT (vehicle_id, ts)
           DO UPDATE SET
               charge_session_id = COALESCE(
                   rivian_charge_curve_points.charge_session_id,
                   EXCLUDED.charge_session_id
               ),
               power_kw = COALESCE(
                   EXCLUDED.power_kw,
                   rivian_charge_curve_points.power_kw
               )
           WHERE rivian_charge_curve_points.charge_session_id IS DISTINCT FROM
                     COALESCE(
                         rivian_charge_curve_points.charge_session_id,
                         EXCLUDED.charge_session_id
                     )
              OR rivian_charge_curve_points.power_kw IS DISTINCT FROM
                     COALESCE(
                         EXCLUDED.power_kw,
                         rivian_charge_curve_points.power_kw
                     )
           RETURNING xmax = 0"#,
    )
    .bind(vehicle_id)
    .bind(active_session_id)
    .bind(&timestamps)
    .bind(&power)
    .fetch_all(pool)
    .await?;
    Ok(actions.len())
}

// ── Charging schedule ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChargingScheduleData {
    get_vehicle: Option<VehicleChargingSchedules>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleChargingSchedules {
    charging_schedules: Option<Vec<ChargePolicyItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChargePolicyItem {
    enabled: Option<bool>,
    start_time: Option<i32>,
    duration: Option<i32>,
    amperage: Option<f64>,
    location: Option<ChargingScheduleLocation>,
    week_days: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChargingScheduleLocation {
    latitude: Option<f64>,
    longitude: Option<f64>,
}

/// Fetch the vehicle's charging schedule and upsert into `charging_schedules`.
pub async fn fetch_charging_schedule(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<()> {
    const Q: &str = r#"
        query GetChargingSchedule($vehicleId: String!) {
          getVehicle(id: $vehicleId) {
            chargingSchedules {
              enabled
              startTime
              duration
              amperage
              location {
                latitude
                longitude
              }
              weekDays
            }
          }
        }
    "#;

    let vars = serde_json::json!({ "vehicleId": rivian_vehicle_id });
    let data: ChargingScheduleData =
        gql_request(client, GATEWAY_URL, tokens, "GetChargingSchedule", Q, vars).await?;

    let policy = data
        .get_vehicle
        .and_then(|s| s.charging_schedules)
        .and_then(|mut schedules| schedules.pop());

    if let Some(p) = policy {
        let week_days: Option<Vec<String>> = p.week_days;
        sqlx::query(
            "INSERT INTO riviamigo.charging_schedules
                 (vehicle_id, enabled, start_time_minutes, duration_minutes,
                  amperage, location_lat, location_lng, week_days, rivian_updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (vehicle_id) DO UPDATE SET
                 enabled            = EXCLUDED.enabled,
                 start_time_minutes = EXCLUDED.start_time_minutes,
                 duration_minutes   = EXCLUDED.duration_minutes,
                 amperage           = EXCLUDED.amperage,
                 location_lat       = EXCLUDED.location_lat,
                 location_lng       = EXCLUDED.location_lng,
                 week_days          = EXCLUDED.week_days,
                 rivian_updated_at  = EXCLUDED.rivian_updated_at,
                 updated_at         = now()",
        )
        .bind(vehicle_id)
        .bind(p.enabled.unwrap_or(false))
        .bind(p.start_time)
        .bind(p.duration)
        .bind(p.amperage)
        .bind(p.location.as_ref().and_then(|l| l.latitude))
        .bind(p.location.as_ref().and_then(|l| l.longitude))
        .bind(week_days.as_deref())
        .bind(Option::<DateTime<Utc>>::None)
        .execute(pool)
        .await?;
    }

    increment_poll_counter(pool, vehicle_id).await;
    tracing::debug!(vehicle_id=%vehicle_id, "charging schedule upserted");
    Ok(())
}

pub async fn fetch_charging_schedule_for_vehicle(
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
) -> Result<()> {
    with_vehicle_auth_retry(
        vehicle_id,
        pool,
        client,
        age_key,
        "fetch_charging_schedule",
        move |rivian_vehicle_id, tokens, pool, client| {
            Box::pin(async move {
                fetch_charging_schedule(rivian_vehicle_id, vehicle_id, pool, client, tokens).await
            })
        },
    )
    .await
}

// ── Departure schedules ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DepartureSchedulesData {
    get_departure_schedules: Option<Vec<DepartureScheduleItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DepartureScheduleItem {
    id: Option<String>,
    name: Option<String>,
    enabled: Option<bool>,
    occurrence: Option<serde_json::Value>,
    preconditioning_settings: Option<serde_json::Value>,
}

/// Fetch departure/preconditioning schedules and upsert into `departure_schedules`.
pub async fn fetch_departure_schedules(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<()> {
    const Q: &str = r#"
        query getDepartureSchedules($vehicleId: String!) {
          getDepartureSchedules(vehicleId: $vehicleId) {
            id
            name
            enabled
            occurrence
            preconditioningSettings
          }
        }
    "#;

    let vars = serde_json::json!({ "vehicleId": rivian_vehicle_id });
    let data: DepartureSchedulesData = gql_request(
        client,
        GATEWAY_URL,
        tokens,
        "getDepartureSchedules",
        Q,
        vars,
    )
    .await?;

    for sched in data.get_departure_schedules.unwrap_or_default() {
        let Some(rivian_id) = &sched.id else { continue };
        sqlx::query(
            "INSERT INTO riviamigo.departure_schedules
                 (vehicle_id, rivian_schedule_id, name, enabled,
                  occurrence, comfort_settings)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (vehicle_id, rivian_schedule_id) DO UPDATE SET
                 name             = EXCLUDED.name,
                 enabled          = EXCLUDED.enabled,
                 occurrence       = EXCLUDED.occurrence,
                 comfort_settings = EXCLUDED.comfort_settings,
                 updated_at       = now()",
        )
        .bind(vehicle_id)
        .bind(rivian_id)
        .bind(&sched.name)
        .bind(sched.enabled.unwrap_or(false))
        .bind(&sched.occurrence)
        .bind(&sched.preconditioning_settings)
        .execute(pool)
        .await?;
    }

    increment_poll_counter(pool, vehicle_id).await;
    tracing::debug!(vehicle_id=%vehicle_id, "departure schedules upserted");
    Ok(())
}

// ── OTA details ───────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OtaDetailsData {
    get_ota_update_details: Option<OtaDetailsPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OtaDetailsPayload {
    release_notes_url: Option<String>,
}

/// Fetch OTA update details and store the release notes URL in `vehicles`.
pub async fn fetch_ota_details(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<()> {
    const Q: &str = r#"
        query getOTAUpdateDetails($vehicleId: String!) {
          getOTAUpdateDetails(vehicleId: $vehicleId) {
            releaseNotesUrl
          }
        }
    "#;

    let vars = serde_json::json!({ "vehicleId": rivian_vehicle_id });
    let data: OtaDetailsData =
        gql_request(client, GATEWAY_URL, tokens, "getOTAUpdateDetails", Q, vars).await?;

    let url = data
        .get_ota_update_details
        .and_then(|d| d.release_notes_url);

    if let Some(ref url) = url {
        sqlx::query(
            "UPDATE riviamigo.vehicles SET ota_release_notes_url = $2, updated_at = now() WHERE id = $1",
        )
        .bind(vehicle_id)
        .bind(url)
        .execute(pool)
        .await?;
    }

    increment_poll_counter(pool, vehicle_id).await;
    tracing::debug!(vehicle_id=%vehicle_id, url=?url, "OTA details upserted");
    Ok(())
}

// ── Charging schedule mutation ────────────────────────────────────────────────

/// Input for creating or updating the charging schedule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChargingScheduleInput {
    pub enabled: bool,
    pub start_time_minutes: Option<i32>,
    pub duration_minutes: Option<i32>,
    pub amperage: Option<f64>,
    pub location_lat: Option<f64>,
    pub location_lng: Option<f64>,
    pub week_days: Option<Vec<String>>,
}

/// Mutation response — field received from Rivian but success is inferred from HTTP status.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct MutateChargingScheduleData {
    update_vehicle_charging_settings: Option<serde_json::Value>,
}

/// Send the `updateVehicleChargingSettings` mutation to Rivian and upsert
/// the result into `charging_schedules`.
pub async fn mutate_charging_schedule(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    input: &ChargingScheduleInput,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<()> {
    const M: &str = r#"
        mutation updateVehicleChargingSettings($vehicleId: String!, $chargePolicy: ChargePolicyInput!) {
          updateVehicleChargingSettings(vehicleId: $vehicleId, chargePolicy: $chargePolicy) {
            __typename
          }
        }
    "#;

    let policy = serde_json::json!({
        "enabled": input.enabled,
        "startTime": input.start_time_minutes,
        "duration": input.duration_minutes,
        "amperage": input.amperage,
        "latitude": input.location_lat,
        "longitude": input.location_lng,
        "weekDays": input.week_days,
    });
    let vars = serde_json::json!({
        "vehicleId": rivian_vehicle_id,
        "chargePolicy": policy,
    });

    let _: MutateChargingScheduleData = gql_request(
        client,
        GATEWAY_URL,
        tokens,
        "updateVehicleChargingSettings",
        M,
        vars,
    )
    .await?;

    increment_poll_counter(pool, vehicle_id).await;

    // Refresh from API to pick up server-side normalisation.
    fetch_charging_schedule(rivian_vehicle_id, vehicle_id, pool, client, tokens).await
}

pub async fn mutate_charging_schedule_for_vehicle(
    vehicle_id: Uuid,
    input: &ChargingScheduleInput,
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
) -> Result<()> {
    let input = input.clone();
    with_vehicle_auth_retry(
        vehicle_id,
        pool,
        client,
        age_key,
        "mutate_charging_schedule",
        move |rivian_vehicle_id, tokens, pool, client| {
            let input = input.clone();
            Box::pin(async move {
                mutate_charging_schedule(
                    rivian_vehicle_id,
                    vehicle_id,
                    &input,
                    pool,
                    client,
                    tokens,
                )
                .await
            })
        },
    )
    .await
}

// ── Departure schedule mutations ──────────────────────────────────────────────

/// Input for creating or updating a departure schedule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepartureScheduleInput {
    pub name: Option<String>,
    pub enabled: bool,
    pub occurrence: Option<serde_json::Value>,
    pub comfort_settings: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDepartureData {
    create_departure_schedule: Option<CreatedDeparture>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatedDeparture {
    id: Option<String>,
}

/// Create a new departure schedule on Rivian and insert into the DB.
/// Returns the Rivian schedule id.
pub async fn create_departure_schedule(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    input: &DepartureScheduleInput,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<String> {
    const M: &str = r#"
        mutation createDepartureSchedule($vehicleId: String!, $input: DepartureScheduleInput!) {
          createDepartureSchedule(vehicleId: $vehicleId, input: $input) {
            id
          }
        }
    "#;

    let vars = serde_json::json!({
        "vehicleId": rivian_vehicle_id,
        "input": {
            "name": input.name,
            "enabled": input.enabled,
            "occurrence": input.occurrence,
            "preconditioningSettings": input.comfort_settings,
        },
    });

    let data: CreateDepartureData = gql_request(
        client,
        GATEWAY_URL,
        tokens,
        "createDepartureSchedule",
        M,
        vars,
    )
    .await?;

    increment_poll_counter(pool, vehicle_id).await;

    let rivian_id = data
        .create_departure_schedule
        .and_then(|d| d.id)
        .ok_or_else(|| anyhow!("createDepartureSchedule returned no id"))?;

    sqlx::query(
        "INSERT INTO riviamigo.departure_schedules
             (vehicle_id, rivian_schedule_id, name, enabled, occurrence, comfort_settings)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (vehicle_id, rivian_schedule_id) DO UPDATE SET
             name             = EXCLUDED.name,
             enabled          = EXCLUDED.enabled,
             occurrence       = EXCLUDED.occurrence,
             comfort_settings = EXCLUDED.comfort_settings,
             updated_at       = now()",
    )
    .bind(vehicle_id)
    .bind(&rivian_id)
    .bind(&input.name)
    .bind(input.enabled)
    .bind(&input.occurrence)
    .bind(&input.comfort_settings)
    .execute(pool)
    .await?;

    Ok(rivian_id)
}

pub async fn create_departure_schedule_for_vehicle(
    vehicle_id: Uuid,
    input: &DepartureScheduleInput,
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
) -> Result<String> {
    let input = input.clone();
    with_vehicle_auth_retry(
        vehicle_id,
        pool,
        client,
        age_key,
        "create_departure_schedule",
        move |rivian_vehicle_id, tokens, pool, client| {
            let input = input.clone();
            Box::pin(async move {
                create_departure_schedule(
                    rivian_vehicle_id,
                    vehicle_id,
                    &input,
                    pool,
                    client,
                    tokens,
                )
                .await
            })
        },
    )
    .await
}

/// Mutation response — field received from Rivian but success is inferred from HTTP status.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct UpdateDepartureData {
    update_departure_schedule: Option<serde_json::Value>,
}

/// Update an existing departure schedule on Rivian and in the DB.
pub async fn update_departure_schedule(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    rivian_schedule_id: &str,
    input: &DepartureScheduleInput,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<()> {
    const M: &str = r#"
        mutation updateDepartureSchedule($vehicleId: String!, $scheduleId: String!, $input: DepartureScheduleInput!) {
          updateDepartureSchedule(vehicleId: $vehicleId, scheduleId: $scheduleId, input: $input) {
            __typename
          }
        }
    "#;

    let vars = serde_json::json!({
        "vehicleId": rivian_vehicle_id,
        "scheduleId": rivian_schedule_id,
        "input": {
            "name": input.name,
            "enabled": input.enabled,
            "occurrence": input.occurrence,
            "preconditioningSettings": input.comfort_settings,
        },
    });

    let _: UpdateDepartureData = gql_request(
        client,
        GATEWAY_URL,
        tokens,
        "updateDepartureSchedule",
        M,
        vars,
    )
    .await?;

    increment_poll_counter(pool, vehicle_id).await;

    sqlx::query(
        "UPDATE riviamigo.departure_schedules SET
             name             = COALESCE($3, name),
             enabled          = $4,
             occurrence       = COALESCE($5, occurrence),
             comfort_settings = COALESCE($6, comfort_settings),
             updated_at       = now()
         WHERE vehicle_id = $1 AND rivian_schedule_id = $2",
    )
    .bind(vehicle_id)
    .bind(rivian_schedule_id)
    .bind(&input.name)
    .bind(input.enabled)
    .bind(&input.occurrence)
    .bind(&input.comfort_settings)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn update_departure_schedule_for_vehicle(
    vehicle_id: Uuid,
    rivian_schedule_id: &str,
    input: &DepartureScheduleInput,
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
) -> Result<()> {
    let rivian_schedule_id = rivian_schedule_id.to_string();
    let input = input.clone();
    with_vehicle_auth_retry(
        vehicle_id,
        pool,
        client,
        age_key,
        "update_departure_schedule",
        move |rivian_vehicle_id, tokens, pool, client| {
            let rivian_schedule_id = rivian_schedule_id.clone();
            let input = input.clone();
            Box::pin(async move {
                update_departure_schedule(
                    rivian_vehicle_id,
                    vehicle_id,
                    &rivian_schedule_id,
                    &input,
                    pool,
                    client,
                    tokens,
                )
                .await
            })
        },
    )
    .await
}

/// Mutation response — field received from Rivian but success is inferred from HTTP status.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct DeleteDepartureData {
    delete_departure_schedule: Option<serde_json::Value>,
}

/// Delete a departure schedule on Rivian and remove from the DB.
pub async fn delete_departure_schedule(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    rivian_schedule_id: &str,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<()> {
    const M: &str = r#"
        mutation deleteDepartureSchedule($vehicleId: String!, $scheduleId: String!) {
          deleteDepartureSchedule(vehicleId: $vehicleId, scheduleId: $scheduleId) {
            __typename
          }
        }
    "#;

    let vars = serde_json::json!({
        "vehicleId": rivian_vehicle_id,
        "scheduleId": rivian_schedule_id,
    });

    let _: DeleteDepartureData = gql_request(
        client,
        GATEWAY_URL,
        tokens,
        "deleteDepartureSchedule",
        M,
        vars,
    )
    .await?;

    increment_poll_counter(pool, vehicle_id).await;

    sqlx::query(
        "DELETE FROM riviamigo.departure_schedules WHERE vehicle_id = $1 AND rivian_schedule_id = $2",
    )
    .bind(vehicle_id)
    .bind(rivian_schedule_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn delete_departure_schedule_for_vehicle(
    vehicle_id: Uuid,
    rivian_schedule_id: &str,
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
) -> Result<()> {
    let rivian_schedule_id = rivian_schedule_id.to_string();
    with_vehicle_auth_retry(
        vehicle_id,
        pool,
        client,
        age_key,
        "delete_departure_schedule",
        move |rivian_vehicle_id, tokens, pool, client| {
            let rivian_schedule_id = rivian_schedule_id.clone();
            Box::pin(async move {
                delete_departure_schedule(
                    rivian_vehicle_id,
                    vehicle_id,
                    &rivian_schedule_id,
                    pool,
                    client,
                    tokens,
                )
                .await
            })
        },
    )
    .await
}

// ── Poll task entry points ────────────────────────────────────────────────────

// ── Startup / periodic polls ──────────────────────────────────────────────────

/// Run all one-shot startup polls for a vehicle.  Errors are logged but not
/// fatal — a failure in one poll must not prevent others from running.
///
/// If `history_backfilled_at IS NULL` (first time this vehicle's worker has
/// ever run), a full charge-history backfill is performed that also inserts
/// sessions sourced entirely from the Rivian API.  On subsequent starts only
/// the most recent page is fetched to pick up any sessions missed since the
/// last run.
pub async fn run_startup_polls(
    vehicle_id: Uuid,
    user_id: Uuid,
    pool: PgPool,
    client: reqwest::Client,
    age_key: String,
) {
    tracing::info!(vehicle_id=%vehicle_id, "startup polls begin");

    // Proactively rotate the CSRF/app-session pair before any operation runs.
    // The stored pair from the last session may have expired during downtime;
    // doing this once at boot avoids the otherwise-guaranteed "first poll 401
    // → CSRF refresh → retry" dance on every restart.
    if let Ok((_, current_tokens)) = load_vehicle_tokens(vehicle_id, &pool, &age_key).await {
        match try_refresh_csrf(vehicle_id, &current_tokens, &client, &pool, &age_key).await {
            Ok(_) => {
                tracing::debug!(vehicle_id=%vehicle_id, "boot CSRF rotation complete");
            }
            Err(e) => {
                tracing::debug!(
                    vehicle_id=%vehicle_id,
                    err=%e,
                    "boot CSRF rotation failed (will retry on first poll)"
                );
            }
        }
    }

    if let Err(e) = fetch_vehicle_enrichment_for_vehicle(vehicle_id, &pool, &client, &age_key).await
    {
        if is_auth_error(&e) {
            tracing::info!(vehicle_id=%vehicle_id, err=%e, "fetch_vehicle_enrichment skipped: authentication required");
        } else {
            tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_vehicle_enrichment failed");
        }
    }

    if let Err(e) = fetch_wallboxes_for_vehicle(user_id, vehicle_id, &pool, &client, &age_key).await
    {
        tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_wallboxes failed");
    }

    // Check whether this vehicle has already been fully backfilled.
    let needs_full_backfill: bool = sqlx::query_scalar(
        "SELECT history_backfilled_at IS NULL FROM riviamigo.vehicles WHERE id = $1",
    )
    .bind(vehicle_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .unwrap_or(true);

    if needs_full_backfill {
        tracing::info!(vehicle_id=%vehicle_id, "starting full charge history backfill");

        match charge_backfill::run(&pool, &client, &age_key, vehicle_id).await {
            Ok(count) => {
                tracing::info!(vehicle_id=%vehicle_id, count, "full backfill complete");
            }
            Err(ChargeBackfillError::AlreadyRunning) => {
                tracing::info!(vehicle_id=%vehicle_id, "full backfill already running; running incremental charge sync");
                match fetch_charge_history_for_vehicle(vehicle_id, &pool, &client, &age_key).await {
                    Ok(n) => {
                        tracing::info!(vehicle_id=%vehicle_id, enriched=%n, "incremental charge history sync complete")
                    }
                    Err(e) => {
                        if is_auth_error(&e) {
                            tracing::info!(vehicle_id=%vehicle_id, err=%e, "fetch_charge_history skipped: authentication required")
                        } else {
                            tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_charge_history failed")
                        }
                    }
                }
            }
            Err(e) => {
                tracing::warn!(vehicle_id=%vehicle_id, err=%e, "full backfill failed");
            }
        }
    } else {
        // Incremental enrich: just reconcile any sessions that appeared since last run.
        match fetch_charge_history_for_vehicle(vehicle_id, &pool, &client, &age_key).await {
            Ok(n) => {
                tracing::info!(vehicle_id=%vehicle_id, enriched=%n, "incremental charge history sync complete")
            }
            Err(e) => {
                if is_auth_error(&e) {
                    tracing::info!(vehicle_id=%vehicle_id, err=%e, "fetch_charge_history skipped: authentication required")
                } else {
                    tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_charge_history failed")
                }
            }
        }
    }

    if let Err(e) = fetch_charging_schedule_for_vehicle(vehicle_id, &pool, &client, &age_key).await
    {
        if is_auth_error(&e) {
            tracing::debug!(vehicle_id=%vehicle_id, err=%e, "fetch_charging_schedule skipped: authentication required");
        } else {
            tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_charging_schedule failed");
        }
    }

    // NOTE: `getDepartureSchedules` does not exist in Rivian's schema — departure
    // schedules are subscription-only.  The call has been intentionally removed.

    tracing::info!(vehicle_id=%vehicle_id, "startup polls complete");
}

/// Periodic and event-driven poll loop.
///
/// - Watches `power_state_rx` so it can adapt cadence with [`poll_interval`].
/// - Responds to `PollEvent` signals: charge session ended → re-sync history;
///   OTA version changed → fetch release notes.
pub(crate) struct PollLoopSignals {
    pub power_state_rx: tokio::sync::watch::Receiver<Option<crate::models::telemetry::PowerState>>,
    pub charging_rx: tokio::sync::watch::Receiver<bool>,
    pub shutdown: tokio::sync::broadcast::Receiver<()>,
}

pub(crate) async fn run_poll_loop(
    vehicle_id: Uuid,
    pool: PgPool,
    client: reqwest::Client,
    age_key: String,
    signals: PollLoopSignals,
    _redis: redis::Client,
) {
    let PollLoopSignals {
        mut power_state_rx,
        mut charging_rx,
        mut shutdown,
    } = signals;

    use crate::ingestion::poller::poll_interval;
    tracing::info!(vehicle_id=%vehicle_id, "poll loop started");
    let mut last_charge_history_sync = tokio::time::Instant::now();

    loop {
        let current_power = power_state_rx.borrow().clone();
        let actively_charging = *charging_rx.borrow();
        let sleep_dur = if actively_charging {
            std::time::Duration::from_secs(30)
        } else {
            poll_interval(current_power.as_ref())
        };

        // Adaptive sleep — bail early on shutdown or power state change.
        tokio::select! {
            _ = tokio::time::sleep(sleep_dur) => {},
            _ = power_state_rx.changed() => {
                // Power state changed; re-evaluate immediately.
            },
            _ = charging_rx.changed() => {
                // Charger status changed; re-evaluate immediately.
            },
            _ = shutdown.recv() => {
                tracing::info!(vehicle_id=%vehicle_id, "poll loop shutdown");
                return;
            }
        }

        let current_power = power_state_rx.borrow().clone();

        // Live charging data is pushed by the chargingSession WebSocket
        // subscription. REST history is intentionally limited to post-session
        // reconciliation below; it is not a live-telemetry replacement.

        let charge_history_interval = match current_power {
            Some(crate::models::telemetry::PowerState::Charging)
            | Some(crate::models::telemetry::PowerState::Ready) => {
                std::time::Duration::from_secs(300)
            }
            _ => std::time::Duration::from_secs(1800),
        };

        if last_charge_history_sync.elapsed() >= charge_history_interval {
            last_charge_history_sync = tokio::time::Instant::now();
            match fetch_charge_history_for_vehicle(vehicle_id, &pool, &client, &age_key).await {
                Ok(count) => {
                    tracing::debug!(vehicle_id=%vehicle_id, reconciled=count, "periodic charge history sync complete");
                }
                Err(error) => {
                    if is_auth_error(&error) {
                        tracing::debug!(vehicle_id=%vehicle_id, err=%error, "periodic charge history sync skipped: authentication required");
                    } else {
                        tracing::warn!(vehicle_id=%vehicle_id, err=%error, "periodic charge history sync failed");
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        live_session_redis_key, unchanged_linked_session, LIVE_SESSION_HISTORY_QUERY,
        LIVE_SESSION_TTL_SECONDS,
    };
    use crate::ingestion::parser::parse_charging_session_message;
    use crate::services::charge_sessions::{
        infer_is_rivian_network, normalize_api_charger_type, ChargeSessionPayloadRef,
    };
    use chrono::Utc;

    #[test]
    fn live_session_redis_contract_uses_expected_key_and_ttl() {
        let vehicle_id = uuid::Uuid::parse_str("76d88de5-f6fa-41cb-b560-126defb7885b").unwrap();
        assert_eq!(
            live_session_redis_key(vehicle_id),
            "vehicle:76d88de5-f6fa-41cb-b560-126defb7885b:live_session"
        );
        assert_eq!(LIVE_SESSION_TTL_SECONDS, 120);
    }

    #[test]
    fn charging_session_normalization_keeps_observed_values_and_converts_seconds() {
        let event = parse_charging_session_message(
            r#"{"type":"next","payload":{"data":{"chargingSession":{"chartData":[{"soc":66.0,"powerKW":9.5,"startTime":"2026-08-18T12:00:00Z"}],"liveData":{"powerKW":9.5,"totalChargedEnergy":12.5,"rangeAddedThisSession":44.0,"timeRemaining":120,"vehicleChargerState":"charging_active","startTime":"2026-08-18T12:00:00Z"}}}}}"#,
        )
        .unwrap()
        .unwrap();

        let live = super::normalize_charging_session(&event, Utc::now()).unwrap();
        assert_eq!(live.soc_pct, Some(66.0));
        assert_eq!(live.power_kw, Some(9.5));
        assert_eq!(live.energy_kwh, Some(12.5));
        assert_eq!(live.range_added_km, Some(44.0));
        assert_eq!(live.time_remaining_min, Some(2.0));
        assert_eq!(
            live.vehicle_charger_state.as_deref(),
            Some("charging_active")
        );
    }

    #[test]
    fn empty_charging_session_frame_does_not_publish_null_snapshot() {
        let event = parse_charging_session_message(
            r#"{"type":"next","payload":{"data":{"chargingSession":{"liveData":{"powerKW":null,"kilometersChargedPerHour":null,"rangeAddedThisSession":null,"totalChargedEnergy":null,"timeElapsed":null,"timeRemaining":null,"price":null,"currency":null,"isFreeSession":null,"vehicleChargerState":null,"startTime":null},"chartData":[]}}}}"#,
        )
        .unwrap()
        .unwrap();

        assert!(super::normalize_charging_session(&event, Utc::now()).is_none());
    }

    #[test]
    fn live_history_query_uses_the_current_id_variable_contract() {
        assert!(LIVE_SESSION_HISTORY_QUERY.contains("$vehicleId: ID!"));
        assert!(!LIVE_SESSION_HISTORY_QUERY.contains("$vehicleId: String!"));
    }

    #[test]
    fn only_unchanged_payloads_with_a_live_session_link_skip_reconciliation() {
        let session_id = uuid::Uuid::new_v4();
        let base = ChargeSessionPayloadRef {
            payload_id: uuid::Uuid::new_v4(),
            captured_at: Utc::now(),
            charge_session_id: Some(session_id),
            unchanged: true,
        };

        assert_eq!(unchanged_linked_session(Some(base)), Some(session_id));
        assert_eq!(
            unchanged_linked_session(Some(ChargeSessionPayloadRef {
                unchanged: false,
                ..base
            })),
            None
        );
        assert_eq!(
            unchanged_linked_session(Some(ChargeSessionPayloadRef {
                charge_session_id: None,
                ..base
            })),
            None
        );
    }

    #[test]
    fn normalizes_documented_charger_types() {
        assert_eq!(normalize_api_charger_type(Some("wallbox")), Some("ac"));
        assert_eq!(normalize_api_charger_type(Some("Level2")), Some("ac"));
        assert_eq!(normalize_api_charger_type(Some("dcfc")), Some("dc"));
        assert_eq!(normalize_api_charger_type(Some("mystery")), None);
    }

    // ── Regression: home-session inference bug ──────────────────────────────
    // The previous version inferred `is_rivian_network = Some(true)` whenever
    // `isRoamingNetwork=false` AND `isHomeCharger` was null/false — which
    // mis-flagged home AC sessions as paid Rivian-network rows and let the
    // cost service substitute `rivian_paid_total` for the real profile cost.
    // The fix: infer ONLY from an explicit known vendor string.

    #[test]
    fn home_session_with_null_vendor_is_not_rivian_network() {
        // The exact shape Rivian returns for a typical home charger: no vendor
        // tag, no roaming/home-charger flags set.
        assert_eq!(infer_is_rivian_network(None), None);
    }

    #[test]
    fn known_paid_networks_are_identified() {
        assert_eq!(infer_is_rivian_network(Some("Rivian")), Some(true));
        assert_eq!(
            infer_is_rivian_network(Some("Electrify America")),
            Some(true)
        );
        assert_eq!(infer_is_rivian_network(Some("EVgo")), Some(true));
        assert_eq!(infer_is_rivian_network(Some("ChargePoint")), Some(true));
        assert_eq!(infer_is_rivian_network(Some("Tesla")), Some(true));
    }

    #[test]
    fn unknown_vendor_is_not_a_paid_network() {
        // Defensive: an unrecognized vendor name should not be assumed paid.
        assert_eq!(
            infer_is_rivian_network(Some("Some Random EVSE")),
            Some(false)
        );
    }

    #[test]
    fn vendor_matching_is_case_insensitive() {
        assert_eq!(infer_is_rivian_network(Some("RIVIAN")), Some(true));
        assert_eq!(infer_is_rivian_network(Some("rivian")), Some(true));
    }
}
