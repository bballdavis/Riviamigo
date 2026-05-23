//! Periodic and event-triggered polling of the Rivian consumer GraphQL API.
//!
//! This module is intentionally separate from rivian_auth.rs (which owns the
//! login flow) and ws_client.rs (which owns the real-time subscription).
//!
//! ## Stewardship
//! Every outbound HTTP call increments `outbound_graphql_requests` in
//! `riviamigo.rivian_stewardship_counters`.  The caller is responsible for
//! invoking [`increment_poll_counter`] after each successful request.

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::ingestion::session_store::RivianTokenBundle;

// ── URL constants ────────────────────────────────────────────────────────────

const GATEWAY_URL: &str = "https://rivian.com/api/gql/gateway/graphql";
const CHRG_URL: &str = "https://rivian.com/api/gql/chrg/user/graphql";

const APOLLO_CLIENT_NAME: &str = "com.rivian.ios.consumer-apollo-ios";
const USER_AGENT: &str = "RivianApp/707 CFNetwork/1237 Darwin/20.4.0";

// ── Generic GQL helpers ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct GqlEnvelope<T> {
    data: Option<T>,
    errors: Option<Vec<GqlError>>,
}

#[derive(Debug, Deserialize)]
struct GqlError {
    message: String,
}

fn fmt_errors(errors: &[GqlError]) -> String {
    errors
        .iter()
        .map(|e| e.message.as_str())
        .collect::<Vec<_>>()
        .join("; ")
}

/// Send a single GraphQL request and deserialize the `data` object.
///
/// Returns `Err` on HTTP failure, non-200 status, GQL error list, or parse
/// failure.  Callers should increment the stewardship counter after this
/// succeeds.
pub async fn gql_request<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
    tokens: &RivianTokenBundle,
    operation: &str,
    query: &str,
    variables: serde_json::Value,
) -> Result<T> {
    let body = serde_json::json!({
        "operationName": operation,
        "query": query,
        "variables": variables,
    });

    let mut req = client
        .post(url)
        .header("User-Agent", USER_AGENT)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("Apollographql-Client-Name", APOLLO_CLIENT_NAME)
        .header("dc-cid", format!("m-ios-{}", Uuid::new_v4()))
        .header("A-Sess", &tokens.app_session_token)
        .header("U-Sess", &tokens.user_session_token)
        .json(&body);

    if !tokens.csrf_token.is_empty() {
        req = req.header("Csrf-Token", &tokens.csrf_token);
    }
    if !tokens.access_token.is_empty() {
        req = req.bearer_auth(&tokens.access_token);
    }

    let response = req.send().await.context("HTTP request failed")?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(anyhow!("Rivian API: unauthorized (token expired?)"));
    }
    if !status.is_success() {
        return Err(anyhow!("Rivian API: HTTP {}", status));
    }

    let envelope = response
        .json::<GqlEnvelope<T>>()
        .await
        .context("failed to parse Rivian API response")?;

    if let Some(errors) = &envelope.errors {
        if !errors.is_empty() {
            return Err(anyhow!("Rivian GQL errors: {}", fmt_errors(errors)));
        }
    }

    envelope.data.ok_or_else(|| anyhow!("Rivian API: empty data for {operation}"))
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
    #[serde(rename = "supportedFeatures")]
    supported_features: Option<Vec<SupportedFeature>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleEnrichmentDetails {
    interior_color: Option<String>,
    wheel_option: Option<String>,
    max_vehicle_power: Option<f64>,
    charge_port_type: Option<String>,
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
              supportedFeatures {
                name
                status
              }
              vehicle {
                interiorColor
                wheelOption
                maxVehiclePower
                chargingPortType
              }
            }
          }
        }
    "#;

    let data: UserInfoEnrichmentData =
        gql_request(client, GATEWAY_URL, tokens, "getUserInfo", Q, serde_json::Value::Null).await?;

    let item = data
        .current_user
        .and_then(|u| u.vehicles)
        .unwrap_or_default()
        .into_iter()
        .find(|v| v.id == rivian_vehicle_id);

    let Some(item) = item else {
        return Err(anyhow!("vehicle {rivian_vehicle_id} not found in getUserInfo"));
    };

    let details = item.vehicle;
    let interior_color = details.as_ref().and_then(|d| d.interior_color.clone());
    let wheel_option = details.as_ref().and_then(|d| d.wheel_option.clone());
    let max_vehicle_power_kw = details.as_ref().and_then(|d| d.max_vehicle_power);
    let charge_port_type = details.as_ref().and_then(|d| d.charge_port_type.clone());

    let features_json: Option<serde_json::Value> = item.supported_features.map(|feats| {
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
         SET interior_color        = COALESCE($2, interior_color),
             wheel_option          = COALESCE($3, wheel_option),
             max_vehicle_power_kw  = COALESCE($4, max_vehicle_power_kw),
             charge_port_type      = COALESCE($5, charge_port_type),
             supported_features    = COALESCE($6, supported_features),
             updated_at            = now()
         WHERE id = $1",
    )
    .bind(vehicle_id)
    .bind(interior_color)
    .bind(wheel_option)
    .bind(max_vehicle_power_kw)
    .bind(charge_port_type)
    .bind(features_json)
    .execute(pool)
    .await?;

    increment_poll_counter(pool, vehicle_id).await;
    tracing::debug!(vehicle_id=%vehicle_id, "vehicle enrichment upserted");
    Ok(())
}

// ── Battery static fields ─────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleStateData {
    vehicle_state: Option<VehicleStaticFields>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleStaticFields {
    battery_cell_type: Option<StringValue>,
}

#[derive(Debug, Deserialize)]
struct StringValue {
    value: Option<String>,
}

/// Fetch battery cell type (NMC / LFP) and upsert into `vehicles`.
pub async fn fetch_battery_static(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<()> {
    const Q: &str = r#"
        query GetVehicleState($vehicleID: String!) {
          vehicleState(id: $vehicleID) {
            batteryCellType { value }
          }
        }
    "#;

    let vars = serde_json::json!({ "vehicleID": rivian_vehicle_id });
    let data: VehicleStateData =
        gql_request(client, GATEWAY_URL, tokens, "GetVehicleState", Q, vars).await?;

    let battery_cell_type = data
        .vehicle_state
        .and_then(|s| s.battery_cell_type)
        .and_then(|v| v.value);

    sqlx::query(
        "UPDATE riviamigo.vehicles
         SET battery_cell_type = COALESCE($2, battery_cell_type),
             updated_at        = now()
         WHERE id = $1",
    )
    .bind(vehicle_id)
    .bind(battery_cell_type)
    .execute(pool)
    .await?;

    increment_poll_counter(pool, vehicle_id).await;
    tracing::debug!(vehicle_id=%vehicle_id, "battery static upserted");
    Ok(())
}

// ── Wallboxes ─────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WallboxesData {
    registered_wallboxes: Option<Vec<WallboxItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WallboxItem {
    wallbox_id: Option<String>,
    name: Option<String>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    max_power: Option<f64>,
    model: Option<String>,
    serial_number: Option<String>,
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
          registeredWallboxes {
            wallboxId
            name
            latitude
            longitude
            maxPower
            model
            serialNumber
            firmwareVersion
            linked
          }
        }
    "#;

    let data: WallboxesData =
        gql_request(client, GATEWAY_URL, tokens, "getRegisteredWallboxes", Q, serde_json::Value::Null).await?;

    let boxes = data.registered_wallboxes.unwrap_or_default();
    for wb in &boxes {
        let Some(wb_id) = &wb.wallbox_id else { continue };
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
        .bind(wb.max_power)
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

// ── Charge session history ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletedSessionsData {
    get_completed_session_summaries: Option<CompletedSessionsPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletedSessionsPayload {
    data: Option<Vec<CompletedSessionItem>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompletedSessionItem {
    /// Rivian's own session identifier
    id: Option<String>,
    start_time: Option<DateTime<Utc>>,
    end_time: Option<DateTime<Utc>>,
    /// kWh added during the session
    energy_added: Option<f64>,
    /// km of range added
    range_added: Option<f64>,
    /// e.g. "Rivian", "Electrify America"
    network_name: Option<String>,
    is_free_session: Option<bool>,
    rivian_energy: Option<bool>,
    /// Total billed amount in USD (Rivian network only)
    paid_total: Option<f64>,
    /// SoC at session start (0–100)
    starting_soc: Option<f64>,
    /// SoC at session end (0–100)
    ending_soc: Option<f64>,
    location: Option<ChargingLocation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChargingLocation {
    latitude: Option<f64>,
    longitude: Option<f64>,
}

/// Fetch completed charge sessions from Rivian's charging endpoint.
///
/// ## Modes
/// - **`full_backfill = false`** (post-session enrichment): enriches existing
///   local rows by matching on `rivian_session_id` then by start-time window.
///   Sessions with no local match are skipped.
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
    fetch_charge_history_inner(rivian_vehicle_id, vehicle_id, false, pool, client, tokens).await
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
    fetch_charge_history_inner(rivian_vehicle_id, vehicle_id, true, pool, client, tokens).await
}

async fn fetch_charge_history_inner(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    full_backfill: bool,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<usize> {
    const PAGE_SIZE: i64 = 200;
    const MAX_PAGES: usize = 50;

    const Q: &str = r#"
        query getCompletedSessionSummaries($vehicleId: String!, $limit: Int, $offset: Int) {
          getCompletedSessionSummaries(vehicleId: $vehicleId, limit: $limit, offset: $offset) {
            data {
              id
              startTime
              endTime
              energyAdded
              rangeAdded
              networkName
              isFreeSession
              rivianEnergy
              paidTotal
              startingSoc
              endingSoc
              location {
                latitude
                longitude
              }
            }
          }
        }
    "#;

    let mut total_processed = 0usize;
    let mut total_inserted = 0usize;
    let mut offset = 0i64;

    for _page in 0..MAX_PAGES {
        let vars = serde_json::json!({
            "vehicleId": rivian_vehicle_id,
            "limit": PAGE_SIZE,
            "offset": offset,
        });

        let data: CompletedSessionsData =
            gql_request(client, CHRG_URL, tokens, "getCompletedSessionSummaries", Q, vars.clone()).await?;

        increment_poll_counter(pool, vehicle_id).await;

        let sessions = data
            .get_completed_session_summaries
            .and_then(|p| p.data)
            .unwrap_or_default();

        let page_len = sessions.len();

        for s in &sessions {
            let Some(rivian_id) = &s.id else { continue };

            // Try to enrich an existing row matched by rivian_session_id.
            let affected = sqlx::query(
                "UPDATE riviamigo.charge_sessions SET
                     rivian_session_id  = $2,
                     network_vendor     = COALESCE(network_vendor, $3),
                     range_added_km     = COALESCE(range_added_km, $4),
                     is_free_session    = COALESCE(is_free_session, $5),
                     is_rivian_network  = COALESCE(is_rivian_network, $6),
                     rivian_paid_total  = COALESCE(rivian_paid_total, $7)
                 WHERE vehicle_id = $1
                   AND rivian_session_id = $2",
            )
            .bind(vehicle_id)
            .bind(rivian_id)
            .bind(&s.network_name)
            .bind(s.range_added)
            .bind(s.is_free_session)
            .bind(s.rivian_energy)
            .bind(s.paid_total)
            .execute(pool)
            .await?
            .rows_affected();

            if affected == 0 {
                // Try to match by start-time window (±5 min).
                let time_matched = if let Some(start) = s.start_time {
                    let window_start = start - chrono::Duration::minutes(5);
                    let window_end = start + chrono::Duration::minutes(5);

                    sqlx::query(
                        "UPDATE riviamigo.charge_sessions SET
                             rivian_session_id  = $2,
                             network_vendor     = COALESCE(network_vendor, $3),
                             range_added_km     = COALESCE(range_added_km, $4),
                             is_free_session    = COALESCE(is_free_session, $5),
                             is_rivian_network  = COALESCE(is_rivian_network, $6),
                             rivian_paid_total  = COALESCE(rivian_paid_total, $7)
                         WHERE vehicle_id = $1
                           AND rivian_session_id IS NULL
                           AND started_at BETWEEN $8 AND $9",
                    )
                    .bind(vehicle_id)
                    .bind(rivian_id)
                    .bind(&s.network_name)
                    .bind(s.range_added)
                    .bind(s.is_free_session)
                    .bind(s.rivian_energy)
                    .bind(s.paid_total)
                    .bind(window_start)
                    .bind(window_end)
                    .execute(pool)
                    .await?
                    .rows_affected()
                } else {
                    0
                };

                // Full backfill: insert sessions that have no local counterpart.
                if full_backfill && time_matched == 0 {
                    if let Some(start) = s.start_time {
                        let loc = s.location.as_ref();
                        let result = sqlx::query(
                            "INSERT INTO riviamigo.charge_sessions
                                 (vehicle_id, started_at, ended_at, kwh_added,
                                  soc_start, soc_end, location_lat, location_lng,
                                  rivian_session_id, network_vendor, range_added_km,
                                  is_free_session, is_rivian_network, rivian_paid_total,
                                  source)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'rivian_api')
                             ON CONFLICT DO NOTHING",
                        )
                        .bind(vehicle_id)
                        .bind(start)
                        .bind(s.end_time)
                        .bind(s.energy_added)
                        .bind(s.starting_soc)
                        .bind(s.ending_soc)
                        .bind(loc.and_then(|l| l.latitude))
                        .bind(loc.and_then(|l| l.longitude))
                        .bind(rivian_id)
                        .bind(&s.network_name)
                        .bind(s.range_added)
                        .bind(s.is_free_session)
                        .bind(s.rivian_energy)
                        .bind(s.paid_total)
                        .execute(pool)
                        .await;

                        if let Ok(r) = result {
                            total_inserted += r.rows_affected() as usize;
                        }
                    }
                }
            }

            total_processed += 1;
        }

        // Stop paginating when the page is smaller than the page size.
        if page_len < PAGE_SIZE as usize {
            break;
        }
        offset += PAGE_SIZE;
    }

    tracing::debug!(
        vehicle_id=%vehicle_id,
        total_processed,
        total_inserted,
        full_backfill,
        "charge history synced"
    );
    Ok(total_processed)
}

// ── Live session data (Redis only, not persisted) ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveSessionData {
    pub session_id: Option<String>,
    pub soc_percent: Option<f64>,
    pub power_kw: Option<f64>,
    pub energy_added_kwh: Option<f64>,
    pub range_added_km: Option<f64>,
    pub minutes_remaining: Option<f64>,
    pub cost_usd: Option<f64>,
    pub network_name: Option<String>,
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveSessionApiData {
    get_live_session_data: Option<LiveSessionApiPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveSessionApiPayload {
    id: Option<String>,
    soc: Option<f64>,
    power: Option<f64>,
    energy_added: Option<f64>,
    range_added: Option<f64>,
    time_remaining: Option<f64>,
    billing: Option<LiveSessionBilling>,
    network_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveSessionBilling {
    total: Option<f64>,
}

/// Fetch live charging session data from Rivian's charging endpoint.
/// Returns `None` if no session is currently active.
/// This data is NOT persisted to the database — publish to Redis instead.
pub async fn fetch_live_session(
    rivian_vehicle_id: &str,
    vehicle_id: Uuid,
    pool: &PgPool,
    client: &reqwest::Client,
    tokens: &RivianTokenBundle,
) -> Result<Option<LiveSessionData>> {
    const Q: &str = r#"
        query getLiveSessionData($vehicleId: String!) {
          getLiveSessionData(vehicleId: $vehicleId) {
            id
            soc
            power
            energyAdded
            rangeAdded
            timeRemaining
            networkName
            billing {
              total
            }
          }
        }
    "#;

    let vars = serde_json::json!({ "vehicleId": rivian_vehicle_id });
    let data: LiveSessionApiData =
        gql_request(client, CHRG_URL, tokens, "getLiveSessionData", Q, vars).await?;

    increment_poll_counter(pool, vehicle_id).await;

    let payload = match data.get_live_session_data {
        Some(p) => p,
        None => return Ok(None),
    };

    Ok(Some(LiveSessionData {
        session_id: payload.id,
        soc_percent: payload.soc,
        power_kw: payload.power,
        energy_added_kwh: payload.energy_added,
        range_added_km: payload.range_added,
        minutes_remaining: payload.time_remaining,
        cost_usd: payload.billing.and_then(|b| b.total),
        network_name: payload.network_name,
        fetched_at: Utc::now(),
    }))
}

// ── Charging schedule ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChargingScheduleData {
    get_vehicle_charging_settings: Option<VehicleChargingSettings>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VehicleChargingSettings {
    charge_policy: Option<ChargePolicyItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChargePolicyItem {
    enabled: Option<bool>,
    start_time: Option<i32>,
    duration: Option<i32>,
    amperage: Option<f64>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    week_days: Option<Vec<String>>,
    updated_at: Option<DateTime<Utc>>,
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
        query getVehicleChargingSettings($vehicleId: String!) {
          getVehicleChargingSettings(vehicleId: $vehicleId) {
            chargePolicy {
              enabled
              startTime
              duration
              amperage
              latitude
              longitude
              weekDays
              updatedAt
            }
          }
        }
    "#;

    let vars = serde_json::json!({ "vehicleId": rivian_vehicle_id });
    let data: ChargingScheduleData =
        gql_request(client, GATEWAY_URL, tokens, "getVehicleChargingSettings", Q, vars).await?;

    let policy = data
        .get_vehicle_charging_settings
        .and_then(|s| s.charge_policy);

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
        .bind(p.latitude)
        .bind(p.longitude)
        .bind(week_days.as_deref())
        .bind(p.updated_at)
        .execute(pool)
        .await?;
    }

    increment_poll_counter(pool, vehicle_id).await;
    tracing::debug!(vehicle_id=%vehicle_id, "charging schedule upserted");
    Ok(())
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
    let data: DepartureSchedulesData =
        gql_request(client, GATEWAY_URL, tokens, "getDepartureSchedules", Q, vars).await?;

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

    let _: MutateChargingScheduleData =
        gql_request(client, GATEWAY_URL, tokens, "updateVehicleChargingSettings", M, vars).await?;

    increment_poll_counter(pool, vehicle_id).await;

    // Refresh from API to pick up server-side normalisation.
    fetch_charging_schedule(rivian_vehicle_id, vehicle_id, pool, client, tokens).await
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

    let data: CreateDepartureData =
        gql_request(client, GATEWAY_URL, tokens, "createDepartureSchedule", M, vars).await?;

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

    let _: UpdateDepartureData =
        gql_request(client, GATEWAY_URL, tokens, "updateDepartureSchedule", M, vars).await?;

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

    let _: DeleteDepartureData =
        gql_request(client, GATEWAY_URL, tokens, "deleteDepartureSchedule", M, vars).await?;

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

// ── Poll task entry points ────────────────────────────────────────────────────

/// Run all one-shot startup polls for a vehicle.  Errors are logged but not
/// fatal — a failure in one poll must not prevent others from running.
///
/// If `history_backfilled_at IS NULL` (first time this vehicle's worker has
/// ever run), a full charge-history backfill is performed that also inserts
/// sessions sourced entirely from the Rivian API.  On subsequent starts only
/// the most recent page is fetched to pick up any sessions missed since the
/// last run.
pub async fn run_startup_polls(
    rivian_vehicle_id: String,
    vehicle_id: Uuid,
    user_id: Uuid,
    tokens: RivianTokenBundle,
    pool: PgPool,
    client: reqwest::Client,
) {
    tracing::info!(vehicle_id=%vehicle_id, "startup polls begin");

    if let Err(e) = fetch_vehicle_enrichment(&rivian_vehicle_id, vehicle_id, &pool, &client, &tokens).await {
        tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_vehicle_enrichment failed");
    }

    if let Err(e) = fetch_battery_static(&rivian_vehicle_id, vehicle_id, &pool, &client, &tokens).await {
        tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_battery_static failed");
    }

    if let Err(e) = fetch_wallboxes(user_id, vehicle_id, &pool, &client, &tokens).await {
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

        let _ = sqlx::query(
            "UPDATE riviamigo.vehicles SET history_backfill_status='running' WHERE id=$1",
        )
        .bind(vehicle_id)
        .execute(&pool)
        .await;

        match fetch_charge_history_full(&rivian_vehicle_id, vehicle_id, &pool, &client, &tokens).await {
            Ok(count) => {
                let _ = sqlx::query(
                    "UPDATE riviamigo.vehicles
                     SET history_backfill_status='done',
                         history_backfilled_at=now(),
                         history_session_count=$2
                     WHERE id=$1",
                )
                .bind(vehicle_id)
                .bind(count as i32)
                .execute(&pool)
                .await;
                tracing::info!(vehicle_id=%vehicle_id, count, "full backfill complete");
            }
            Err(e) => {
                let _ = sqlx::query(
                    "UPDATE riviamigo.vehicles SET history_backfill_status='error' WHERE id=$1",
                )
                .bind(vehicle_id)
                .execute(&pool)
                .await;
                tracing::warn!(vehicle_id=%vehicle_id, err=%e, "full backfill failed");
            }
        }
    } else {
        // Incremental enrich: just reconcile any sessions that appeared since last run.
        match fetch_charge_history(&rivian_vehicle_id, vehicle_id, &pool, &client, &tokens).await {
            Ok(n) => tracing::info!(vehicle_id=%vehicle_id, enriched=%n, "incremental charge history sync complete"),
            Err(e) => tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_charge_history failed"),
        }
    }

    if let Err(e) = fetch_charging_schedule(&rivian_vehicle_id, vehicle_id, &pool, &client, &tokens).await {
        tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_charging_schedule failed");
    }

    if let Err(e) = fetch_departure_schedules(&rivian_vehicle_id, vehicle_id, &pool, &client, &tokens).await {
        tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_departure_schedules failed");
    }

    tracing::info!(vehicle_id=%vehicle_id, "startup polls complete");
}

/// Periodic and event-driven poll loop.
///
/// - Watches `power_state_rx` so it can adapt cadence with [`poll_interval`].
/// - While `Charging`, fetches live session data every 30 s and publishes to
///   the `vehicle:{id}:live_session` Redis key.
/// - Responds to `PollEvent` signals: charge session ended → re-sync history;
///   OTA version changed → fetch release notes.
pub async fn run_poll_loop(
    rivian_vehicle_id: String,
    vehicle_id: Uuid,
    tokens: RivianTokenBundle,
    pool: PgPool,
    client: reqwest::Client,
    mut power_state_rx: tokio::sync::watch::Receiver<Option<crate::models::telemetry::PowerState>>,
    mut shutdown: tokio::sync::broadcast::Receiver<()>,
    redis: redis::Client,
) {
    use crate::{ingestion::poller::poll_interval, models::telemetry::PowerState};
    use redis::AsyncCommands;

    tracing::info!(vehicle_id=%vehicle_id, "poll loop started");

    loop {
        let current_power = power_state_rx.borrow().clone();
        let sleep_dur = poll_interval(current_power.as_ref());

        // Adaptive sleep — bail early on shutdown or power state change.
        tokio::select! {
            _ = tokio::time::sleep(sleep_dur) => {},
            _ = power_state_rx.changed() => {
                // Power state changed; re-evaluate immediately.
            },
            _ = shutdown.recv() => {
                tracing::info!(vehicle_id=%vehicle_id, "poll loop shutdown");
                return;
            }
        }

        let power = power_state_rx.borrow().clone();

        if matches!(power, Some(PowerState::Charging)) {
            match fetch_live_session(&rivian_vehicle_id, vehicle_id, &pool, &client, &tokens).await {
                Ok(Some(live)) => {
                    if let Ok(json) = serde_json::to_string(&live) {
                        if let Ok(mut conn) = redis.get_multiplexed_async_connection().await {
                            let key = format!("vehicle:{}:live_session", vehicle_id);
                            // Expire after 2 minutes so stale data auto-clears.
                            let _: Result<(), _> = conn.set_ex(&key, &json, 120).await;
                        }
                    }
                }
                Ok(None) => {} // no active session
                Err(e) => tracing::warn!(vehicle_id=%vehicle_id, err=%e, "fetch_live_session failed"),
            }
        }
    }
}
