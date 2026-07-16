use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

pub const CHARGE_SESSION_SOURCE_TELEMETRY: &str = "telemetry";
pub const CHARGE_SESSION_SOURCE_RIVIAN_API: &str = "rivian_api";
pub const CHARGE_SESSION_SOURCE_TELEMETRY_AND_API: &str = "telemetry+rivian_api";

pub const CHARGE_SESSION_CONFIDENCE_TELEMETRY: &str = "telemetry";
pub const CHARGE_SESSION_CONFIDENCE_TELEMETRY_ENRICHED: &str = "telemetry_enriched";
pub const CHARGE_SESSION_CONFIDENCE_API_ONLY: &str = "api_only";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChargeSessionSummaryPayload {
    pub transaction_id: Option<String>,
    pub start_instant: Option<DateTime<Utc>>,
    pub end_instant: Option<DateTime<Utc>>,
    pub charger_type: Option<String>,
    pub currency_code: Option<String>,
    pub total_energy_kwh: Option<f64>,
    pub range_added_km: Option<f64>,
    pub city: Option<String>,
    pub vehicle_id: Option<String>,
    pub vehicle_name: Option<String>,
    pub vendor: Option<String>,
    pub paid_total: Option<f64>,
    pub is_public: Option<bool>,
    pub is_home_charger: Option<bool>,
    pub is_roaming_network: Option<bool>,
    pub meta: Option<ChargeSessionSummaryMeta>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChargeSessionSummaryMeta {
    pub transaction_id_grouping_key: Option<String>,
    pub data_sources: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalAliasKind {
    Cdrs,
    Txn,
    Vtxn,
    NetworkSession,
    Legacy,
    Unknown,
}

impl ExternalAliasKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ExternalAliasKind::Cdrs => "cdrs",
            ExternalAliasKind::Txn => "txn",
            ExternalAliasKind::Vtxn => "vtxn",
            ExternalAliasKind::NetworkSession => "network_session",
            ExternalAliasKind::Legacy => "legacy",
            ExternalAliasKind::Unknown => "unknown",
        }
    }

    fn rank(self) -> i32 {
        match self {
            ExternalAliasKind::Cdrs => 0,
            ExternalAliasKind::Txn => 1,
            ExternalAliasKind::NetworkSession => 2,
            ExternalAliasKind::Vtxn => 3,
            ExternalAliasKind::Legacy => 4,
            ExternalAliasKind::Unknown => 5,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChargeSessionExternalAlias {
    pub external_id: String,
    pub alias_kind: ExternalAliasKind,
    pub transaction_id_grouping_key: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub enum UnmatchedInsertPolicy {
    Never,
    Always,
    RecentOnly {
        now: DateTime<Utc>,
        lookback_days: i64,
    },
}

#[derive(Debug, Clone, Copy)]
pub struct ChargeSessionPayloadRef {
    pub payload_id: Uuid,
    pub captured_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct MatchRow {
    id: Uuid,
    source: Option<String>,
}

#[derive(Debug, FromRow)]
struct AliasRow {
    external_id: String,
    alias_kind: String,
}

#[derive(Debug, FromRow)]
struct BackfillAliasSeedRow {
    id: Uuid,
    rivian_session_id: Option<String>,
    rivian_meta: Option<serde_json::Value>,
}

fn summarize_source(existing: Option<&str>, has_api: bool) -> &'static str {
    if !has_api {
        return CHARGE_SESSION_SOURCE_TELEMETRY;
    }

    match existing {
        Some(CHARGE_SESSION_SOURCE_RIVIAN_API) => CHARGE_SESSION_SOURCE_RIVIAN_API,
        Some(CHARGE_SESSION_SOURCE_TELEMETRY_AND_API) => CHARGE_SESSION_SOURCE_TELEMETRY_AND_API,
        Some(CHARGE_SESSION_SOURCE_TELEMETRY) => CHARGE_SESSION_SOURCE_TELEMETRY_AND_API,
        Some(_) => CHARGE_SESSION_SOURCE_TELEMETRY_AND_API,
        None => CHARGE_SESSION_SOURCE_TELEMETRY_AND_API,
    }
}

pub fn confidence_for_source(source: &str) -> &'static str {
    match source {
        CHARGE_SESSION_SOURCE_RIVIAN_API => CHARGE_SESSION_CONFIDENCE_API_ONLY,
        CHARGE_SESSION_SOURCE_TELEMETRY_AND_API => CHARGE_SESSION_CONFIDENCE_TELEMETRY_ENRICHED,
        _ => CHARGE_SESSION_CONFIDENCE_TELEMETRY,
    }
}

pub fn infer_is_rivian_network(vendor: Option<&str>) -> Option<bool> {
    let vendor = vendor?.trim();
    if vendor.is_empty() {
        return None;
    }

    let normalized = vendor.to_ascii_lowercase();
    let known_network = matches!(
        normalized.as_str(),
        "rivian" | "electrify america" | "evgo" | "chargepoint" | "tesla"
    );
    Some(known_network)
}

pub fn normalize_api_charger_type(value: Option<&str>) -> Option<&'static str> {
    match value?.trim().to_ascii_lowercase().as_str() {
        "wallbox" | "ac" | "level1" | "level2" | "j1772" => Some("ac"),
        "dc" | "dcfc" | "ran15_dispenser" | "supercharger" => Some("dc"),
        _ => None,
    }
}

pub fn infer_api_charger_type(vendor: Option<&str>, is_home: Option<bool>) -> Option<&'static str> {
    if is_home == Some(true) {
        return Some("ac");
    }

    match vendor?.trim().to_ascii_lowercase().as_str() {
        "tesla" | "rivian" | "electrify america" | "evgo" => Some("dc"),
        _ => None,
    }
}

pub fn normalize_grouping_key(raw: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }

    let mut pieces = raw
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    if pieces.is_empty() {
        return None;
    }
    pieces.sort_unstable();
    pieces.dedup();
    Some(pieces.join(","))
}

fn parse_data_source_alias(data_source: &str) -> Option<(ExternalAliasKind, String)> {
    let mut parts = data_source.splitn(2, ':');
    let prefix = parts.next()?.trim();
    let external_id = parts.next()?.trim();
    if external_id.is_empty() {
        return None;
    }

    let kind = match prefix {
        "CDRS" => ExternalAliasKind::Cdrs,
        "TXN" => ExternalAliasKind::Txn,
        "VTXN" => ExternalAliasKind::Vtxn,
        _ => ExternalAliasKind::Unknown,
    };
    Some((kind, external_id.to_string()))
}

fn infer_alias_kind_from_id(external_id: &str) -> ExternalAliasKind {
    if external_id.starts_with("USCPI") {
        ExternalAliasKind::NetworkSession
    } else {
        ExternalAliasKind::Legacy
    }
}

pub fn parse_summary_aliases(
    summary: &ChargeSessionSummaryPayload,
) -> Vec<ChargeSessionExternalAlias> {
    let grouping_key = normalize_grouping_key(
        summary
            .meta
            .as_ref()
            .and_then(|meta| meta.transaction_id_grouping_key.as_deref()),
    );
    let mut aliases = Vec::<ChargeSessionExternalAlias>::new();

    if let Some(data_sources) = summary
        .meta
        .as_ref()
        .and_then(|meta| meta.data_sources.as_ref())
    {
        for data_source in data_sources {
            if let Some((alias_kind, external_id)) = parse_data_source_alias(data_source) {
                aliases.push(ChargeSessionExternalAlias {
                    external_id,
                    alias_kind,
                    transaction_id_grouping_key: grouping_key.clone(),
                });
            }
        }
    }

    if let Some(transaction_id) = summary.transaction_id.as_ref().map(|value| value.trim()) {
        if !transaction_id.is_empty()
            && !aliases
                .iter()
                .any(|alias| alias.external_id == transaction_id)
        {
            aliases.push(ChargeSessionExternalAlias {
                external_id: transaction_id.to_string(),
                alias_kind: infer_alias_kind_from_id(transaction_id),
                transaction_id_grouping_key: grouping_key.clone(),
            });
        }
    }

    aliases.sort_by(|left, right| {
        left.alias_kind
            .rank()
            .cmp(&right.alias_kind.rank())
            .then_with(|| left.external_id.cmp(&right.external_id))
    });
    aliases.dedup_by(|left, right| left.external_id == right.external_id);
    aliases
}

pub fn preferred_external_alias(
    aliases: &[ChargeSessionExternalAlias],
) -> Option<&ChargeSessionExternalAlias> {
    aliases
        .iter()
        .min_by(|left, right| left.alias_kind.rank().cmp(&right.alias_kind.rank()))
}

fn should_insert_unmatched_session(
    policy: UnmatchedInsertPolicy,
    started_at: Option<DateTime<Utc>>,
) -> bool {
    match policy {
        UnmatchedInsertPolicy::Never => false,
        UnmatchedInsertPolicy::Always => started_at.is_some(),
        UnmatchedInsertPolicy::RecentOnly { now, lookback_days } => {
            started_at.is_some_and(|start| start >= now - chrono::Duration::days(lookback_days))
        }
    }
}

async fn find_session_by_external_alias(
    pool: &PgPool,
    vehicle_id: Uuid,
    aliases: &[ChargeSessionExternalAlias],
) -> Result<Option<MatchRow>> {
    if aliases.is_empty() {
        return Ok(None);
    }

    let external_ids = aliases
        .iter()
        .map(|alias| alias.external_id.clone())
        .collect::<Vec<_>>();

    let matched = sqlx::query_as::<_, MatchRow>(
        r#"
        SELECT DISTINCT ON (cs.id)
            cs.id,
            cs.source
        FROM riviamigo.charge_sessions cs
        LEFT JOIN riviamigo.charge_session_external_aliases alias
          ON alias.charge_session_id = cs.id
        WHERE cs.vehicle_id = $1
          AND (
              cs.rivian_session_id = ANY($2)
              OR alias.external_id = ANY($2)
          )
        ORDER BY cs.id,
                 CASE COALESCE(cs.source, '')
                     WHEN 'telemetry+rivian_api' THEN 4
                     WHEN 'telemetry' THEN 3
                     WHEN 'rivian_api' THEN 1
                     ELSE 2
                 END DESC
        "#,
    )
    .bind(vehicle_id)
    .bind(&external_ids)
    .fetch_optional(pool)
    .await?;

    Ok(matched)
}

async fn find_session_by_grouping_key(
    pool: &PgPool,
    vehicle_id: Uuid,
    grouping_key: Option<&str>,
    started_at: Option<DateTime<Utc>>,
) -> Result<Option<MatchRow>> {
    let Some(grouping_key) = grouping_key else {
        return Ok(None);
    };

    let matched = sqlx::query_as::<_, MatchRow>(
        r#"
        SELECT DISTINCT ON (cs.id)
            cs.id,
            cs.source
        FROM riviamigo.charge_sessions cs
        JOIN riviamigo.charge_session_external_aliases alias
          ON alias.charge_session_id = cs.id
        WHERE cs.vehicle_id = $1
          AND alias.transaction_id_grouping_key = $2
        ORDER BY cs.id,
                 CASE COALESCE(cs.source, '')
                     WHEN 'telemetry+rivian_api' THEN 4
                     WHEN 'telemetry' THEN 3
                     WHEN 'rivian_api' THEN 1
                     ELSE 2
                 END DESC,
                 ABS(EXTRACT(EPOCH FROM (cs.started_at - COALESCE($3, cs.started_at)))) ASC
        "#,
    )
    .bind(vehicle_id)
    .bind(grouping_key)
    .bind(started_at)
    .fetch_optional(pool)
    .await?;

    Ok(matched)
}

async fn find_overlapping_session(
    pool: &PgPool,
    vehicle_id: Uuid,
    started_at: Option<DateTime<Utc>>,
    ended_at: Option<DateTime<Utc>>,
) -> Result<Option<MatchRow>> {
    let Some(started_at) = started_at else {
        return Ok(None);
    };
    let end_bound = ended_at.unwrap_or(started_at);

    let matched = sqlx::query_as::<_, MatchRow>(
        r#"
        SELECT
            cs.id,
            cs.source
        FROM riviamigo.charge_sessions cs
        WHERE cs.vehicle_id = $1
          AND cs.started_at <= $3
          AND COALESCE(cs.ended_at, cs.started_at) >= $2
        ORDER BY CASE COALESCE(cs.source, '')
                     WHEN 'telemetry+rivian_api' THEN 4
                     WHEN 'telemetry' THEN 3
                     WHEN 'rivian_api' THEN 1
                     ELSE 2
                 END DESC,
                 ABS(EXTRACT(EPOCH FROM (cs.started_at - $2))) ASC,
                 cs.started_at ASC,
                 cs.id ASC
        LIMIT 1
        "#,
    )
    .bind(vehicle_id)
    .bind(started_at)
    .bind(end_bound)
    .fetch_optional(pool)
    .await?;

    Ok(matched)
}

async fn find_time_window_session(
    pool: &PgPool,
    vehicle_id: Uuid,
    started_at: Option<DateTime<Utc>>,
) -> Result<Option<MatchRow>> {
    let Some(started_at) = started_at else {
        return Ok(None);
    };
    let window_start = started_at - chrono::Duration::minutes(60);
    let window_end = started_at + chrono::Duration::minutes(60);

    let matched = sqlx::query_as::<_, MatchRow>(
        r#"
        WITH ranked AS (
            SELECT
                cs.id,
                cs.source,
                ABS(EXTRACT(EPOCH FROM (cs.started_at - $4))) AS delta_secs,
                ROW_NUMBER() OVER (
                    ORDER BY
                        CASE COALESCE(cs.source, '')
                            WHEN 'telemetry+rivian_api' THEN 4
                            WHEN 'telemetry' THEN 3
                            WHEN 'rivian_api' THEN 1
                            ELSE 2
                        END DESC,
                        ABS(EXTRACT(EPOCH FROM (cs.started_at - $4))) ASC,
                        cs.started_at ASC,
                        cs.id ASC
                ) AS rn,
                LEAD(ABS(EXTRACT(EPOCH FROM (cs.started_at - $4)))) OVER (
                    ORDER BY
                        CASE COALESCE(cs.source, '')
                            WHEN 'telemetry+rivian_api' THEN 4
                            WHEN 'telemetry' THEN 3
                            WHEN 'rivian_api' THEN 1
                            ELSE 2
                        END DESC,
                        ABS(EXTRACT(EPOCH FROM (cs.started_at - $4))) ASC,
                        cs.started_at ASC,
                        cs.id ASC
                ) AS next_delta_secs
            FROM riviamigo.charge_sessions cs
            WHERE cs.vehicle_id = $1
              AND cs.started_at BETWEEN $2 AND $3
        )
        SELECT id, source
        FROM ranked
        WHERE rn = 1
          AND (next_delta_secs IS NULL OR (next_delta_secs - delta_secs) >= 900)
        "#,
    )
    .bind(vehicle_id)
    .bind(window_start)
    .bind(window_end)
    .bind(started_at)
    .fetch_optional(pool)
    .await?;

    Ok(matched)
}

async fn update_session_from_summary(
    pool: &PgPool,
    session_id: Uuid,
    existing_source: Option<&str>,
    summary: &ChargeSessionSummaryPayload,
    normalized_charger_type: Option<&str>,
    is_rivian_network: Option<bool>,
) -> Result<()> {
    let next_source = summarize_source(existing_source, true);
    let next_confidence = confidence_for_source(next_source);

    sqlx::query(
        r#"
        UPDATE riviamigo.charge_sessions
        SET
            api_started_at = CASE
                WHEN $2::timestamptz IS NULL THEN api_started_at
                WHEN api_started_at IS NULL THEN $2
                ELSE LEAST(api_started_at, $2)
            END,
            api_ended_at = CASE
                WHEN $3::timestamptz IS NULL THEN api_ended_at
                WHEN api_ended_at IS NULL THEN $3
                ELSE GREATEST(api_ended_at, $3)
            END,
            ended_at = CASE
                WHEN COALESCE(source, '') = 'rivian_api' THEN COALESCE(ended_at, $3)
                ELSE ended_at
            END,
            kwh_added = COALESCE(kwh_added, $4),
            network_vendor = COALESCE(network_vendor, $5),
            range_added_km = COALESCE(range_added_km, $6),
            is_free_session = COALESCE(is_free_session, $7),
            is_rivian_network = COALESCE(is_rivian_network, $8),
            rivian_paid_total = COALESCE(rivian_paid_total, $9),
            is_home = COALESCE(is_home, $10),
            duration_minutes = COALESCE(
                duration_minutes,
                CASE
                    WHEN COALESCE(source, '') = 'rivian_api'
                         AND $3::timestamptz IS NOT NULL
                         AND $2::timestamptz IS NOT NULL
                    THEN EXTRACT(EPOCH FROM ($3::timestamptz - $2::timestamptz))::int / 60
                END
            ),
            charger_type = COALESCE(
                charger_type,
                $11,
                CASE
                    WHEN $10 = true THEN 'ac'
                    WHEN lower(COALESCE($5, '')) = ANY(ARRAY['tesla','rivian','electrify america','evgo']) THEN 'dc'
                END
            ),
            source = $12,
            data_confidence = $13,
            rivian_charger_type = COALESCE(rivian_charger_type, $14),
            currency_code = COALESCE(currency_code, $15),
            rivian_city = COALESCE(rivian_city, $16),
            rivian_vehicle_id = COALESCE(rivian_vehicle_id, $17),
            rivian_vehicle_name = COALESCE(rivian_vehicle_name, $18),
            is_public = COALESCE(is_public, $19),
            rivian_meta = COALESCE(rivian_meta, $20)
        WHERE id = $1
        "#,
    )
    .bind(session_id)
    .bind(summary.start_instant)
    .bind(summary.end_instant)
    .bind(summary.total_energy_kwh)
    .bind(summary.vendor.as_deref())
    .bind(summary.range_added_km)
    .bind(summary.paid_total.map(|total| total == 0.0))
    .bind(is_rivian_network)
    .bind(summary.paid_total)
    .bind(summary.is_home_charger)
    .bind(normalized_charger_type)
    .bind(next_source)
    .bind(next_confidence)
    .bind(summary.charger_type.as_deref())
    .bind(summary.currency_code.as_deref())
    .bind(summary.city.as_deref())
    .bind(summary.vehicle_id.as_deref())
    .bind(summary.vehicle_name.as_deref())
    .bind(summary.is_public)
    .bind(serde_json::to_value(summary).ok())
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_api_only_session(
    pool: &PgPool,
    vehicle_id: Uuid,
    summary: &ChargeSessionSummaryPayload,
    normalized_charger_type: Option<&str>,
    is_rivian_network: Option<bool>,
    preferred_external_id: Option<&str>,
) -> Result<Option<Uuid>> {
    let Some(started_at) = summary.start_instant else {
        return Ok(None);
    };

    let inserted = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO riviamigo.charge_sessions
            (
                vehicle_id,
                started_at,
                ended_at,
                api_started_at,
                api_ended_at,
                kwh_added,
                rivian_session_id,
                network_vendor,
                range_added_km,
                is_free_session,
                is_rivian_network,
                rivian_paid_total,
                is_home,
                charger_type,
                duration_minutes,
                source,
                data_confidence,
                rivian_charger_type,
                currency_code,
                rivian_city,
                rivian_vehicle_id,
                rivian_vehicle_name,
                is_public,
                rivian_meta
            )
        VALUES
            (
                $1,$2,$3,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                'rivian_api',
                'api_only',
                $14,$15,$16,$17,$18,$19,$20
            )
        ON CONFLICT DO NOTHING
        RETURNING id
        "#,
    )
    .bind(vehicle_id)
    .bind(started_at)
    .bind(summary.end_instant)
    .bind(summary.total_energy_kwh)
    .bind(preferred_external_id)
    .bind(summary.vendor.as_deref())
    .bind(summary.range_added_km)
    .bind(summary.paid_total.map(|total| total == 0.0))
    .bind(is_rivian_network)
    .bind(summary.paid_total)
    .bind(summary.is_home_charger)
    .bind(
        normalized_charger_type
            .or_else(|| infer_api_charger_type(summary.vendor.as_deref(), summary.is_home_charger)),
    )
    .bind(
        summary
            .end_instant
            .map(|ended_at| (ended_at - started_at).num_minutes() as i32),
    )
    .bind(summary.charger_type.as_deref())
    .bind(summary.currency_code.as_deref())
    .bind(summary.city.as_deref())
    .bind(summary.vehicle_id.as_deref())
    .bind(summary.vehicle_name.as_deref())
    .bind(summary.is_public)
    .bind(serde_json::to_value(summary).ok())
    .fetch_optional(pool)
    .await?;

    Ok(inserted)
}

pub async fn upsert_external_aliases(
    pool: &PgPool,
    charge_session_id: Uuid,
    aliases: &[ChargeSessionExternalAlias],
    payload_ref: Option<ChargeSessionPayloadRef>,
) -> Result<u64> {
    let mut written = 0u64;
    for alias in aliases {
        let result = sqlx::query(
            r#"
            INSERT INTO riviamigo.charge_session_external_aliases (
                charge_session_id,
                external_id,
                alias_kind,
                transaction_id_grouping_key,
                first_seen_at,
                last_seen_at,
                latest_payload_id,
                latest_payload_captured_at
            )
            VALUES ($1,$2,$3,$4,now(),now(),$5,$6)
            ON CONFLICT (charge_session_id, external_id) DO UPDATE
            SET alias_kind = CASE
                    WHEN riviamigo.charge_session_external_aliases.alias_kind = 'legacy'
                         AND EXCLUDED.alias_kind <> 'legacy'
                    THEN EXCLUDED.alias_kind
                    ELSE riviamigo.charge_session_external_aliases.alias_kind
                END,
                transaction_id_grouping_key = COALESCE(
                    EXCLUDED.transaction_id_grouping_key,
                    riviamigo.charge_session_external_aliases.transaction_id_grouping_key
                ),
                last_seen_at = GREATEST(
                    riviamigo.charge_session_external_aliases.last_seen_at,
                    EXCLUDED.last_seen_at
                ),
                latest_payload_id = COALESCE(EXCLUDED.latest_payload_id, riviamigo.charge_session_external_aliases.latest_payload_id),
                latest_payload_captured_at = COALESCE(
                    EXCLUDED.latest_payload_captured_at,
                    riviamigo.charge_session_external_aliases.latest_payload_captured_at
                ),
                updated_at = now()
            "#,
        )
        .bind(charge_session_id)
        .bind(&alias.external_id)
        .bind(alias.alias_kind.as_str())
        .bind(alias.transaction_id_grouping_key.as_deref())
        .bind(payload_ref.map(|payload| payload.payload_id))
        .bind(payload_ref.map(|payload| payload.captured_at))
        .execute(pool)
        .await?;

        written += result.rows_affected();
    }

    Ok(written)
}

pub async fn finalize_charge_session_aliases(pool: &PgPool, charge_session_id: Uuid) -> Result<()> {
    let alias_rows = sqlx::query_as::<_, AliasRow>(
        r#"
        SELECT external_id, alias_kind
        FROM riviamigo.charge_session_external_aliases
        WHERE charge_session_id = $1
        "#,
    )
    .bind(charge_session_id)
    .fetch_all(pool)
    .await?;

    let Some(best_alias) = alias_rows.into_iter().min_by(|left, right| {
        alias_kind_from_str(&left.alias_kind)
            .rank()
            .cmp(&alias_kind_from_str(&right.alias_kind).rank())
            .then_with(|| left.external_id.cmp(&right.external_id))
    }) else {
        return Ok(());
    };

    // The alias table can temporarily contain an ID that is still stored as
    // the canonical ID on an older API-only row.  Do not let that stale
    // cross-row state turn an otherwise idempotent sync into a transaction
    // failure.  Canonicalization will merge the rows and can promote the
    // preferred ID once the duplicate row is gone.
    sqlx::query(
        "UPDATE riviamigo.charge_sessions
         SET rivian_session_id = $2
         WHERE id = $1
           AND (
               rivian_session_id = $2
               OR NOT EXISTS (
                   SELECT 1
                   FROM riviamigo.charge_sessions existing
                   WHERE existing.rivian_session_id = $2
                     AND existing.id <> $1
               )
           )",
    )
    .bind(charge_session_id)
    .bind(best_alias.external_id)
    .execute(pool)
    .await?;

    Ok(())
}

fn alias_kind_from_str(value: &str) -> ExternalAliasKind {
    match value {
        "cdrs" => ExternalAliasKind::Cdrs,
        "txn" => ExternalAliasKind::Txn,
        "vtxn" => ExternalAliasKind::Vtxn,
        "network_session" => ExternalAliasKind::NetworkSession,
        "legacy" => ExternalAliasKind::Legacy,
        _ => ExternalAliasKind::Unknown,
    }
}

pub async fn backfill_charge_session_sources(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
) -> Result<u64> {
    let result = sqlx::query(
        r#"
        UPDATE riviamigo.charge_sessions
        SET source = COALESCE(source, 'telemetry'),
            data_confidence = CASE
                WHEN COALESCE(source, 'telemetry') = 'telemetry+rivian_api' THEN 'telemetry_enriched'
                WHEN COALESCE(source, 'telemetry') = 'rivian_api' THEN 'api_only'
                ELSE 'telemetry'
            END,
            api_started_at = CASE
                WHEN COALESCE(source, 'telemetry') IN ('rivian_api', 'telemetry+rivian_api')
                THEN COALESCE(api_started_at, started_at)
                ELSE api_started_at
            END,
            api_ended_at = CASE
                WHEN COALESCE(source, 'telemetry') IN ('rivian_api', 'telemetry+rivian_api')
                THEN COALESCE(api_ended_at, ended_at)
                ELSE api_ended_at
            END
        WHERE ($1::uuid IS NULL OR vehicle_id = $1)
          AND (
              source IS NULL
              OR data_confidence IS NULL
              OR (
                  COALESCE(source, 'telemetry') IN ('rivian_api', 'telemetry+rivian_api')
                  AND (api_started_at IS NULL OR api_ended_at IS NULL)
              )
          )
        "#,
    )
    .bind(vehicle_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn backfill_charge_session_aliases_from_rows(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
) -> Result<u64> {
    let rows = sqlx::query_as::<_, BackfillAliasSeedRow>(
        r#"
        SELECT id, rivian_session_id, rivian_meta
        FROM riviamigo.charge_sessions
        WHERE ($1::uuid IS NULL OR vehicle_id = $1)
          AND (rivian_session_id IS NOT NULL OR rivian_meta IS NOT NULL)
        "#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut written = 0u64;
    for row in rows {
        let summary = row.rivian_meta.as_ref().and_then(|value| {
            serde_json::from_value::<ChargeSessionSummaryPayload>(value.clone()).ok()
        });
        let aliases = if let Some(summary) = summary.as_ref() {
            let parsed = parse_summary_aliases(summary);
            if parsed.is_empty() {
                row.rivian_session_id
                    .as_deref()
                    .map(|external_id| {
                        vec![ChargeSessionExternalAlias {
                            external_id: external_id.to_string(),
                            alias_kind: infer_alias_kind_from_id(external_id),
                            transaction_id_grouping_key: None,
                        }]
                    })
                    .unwrap_or_default()
            } else {
                parsed
            }
        } else {
            row.rivian_session_id
                .as_deref()
                .map(|external_id| {
                    vec![ChargeSessionExternalAlias {
                        external_id: external_id.to_string(),
                        alias_kind: infer_alias_kind_from_id(external_id),
                        transaction_id_grouping_key: None,
                    }]
                })
                .unwrap_or_default()
        };

        if aliases.is_empty() {
            continue;
        }

        written += upsert_external_aliases(pool, row.id, &aliases, None).await?;
        finalize_charge_session_aliases(pool, row.id).await?;
    }

    Ok(written)
}

pub async fn reconcile_completed_session_summary(
    pool: &PgPool,
    vehicle_id: Uuid,
    summary: &ChargeSessionSummaryPayload,
    insert_policy: UnmatchedInsertPolicy,
    payload_ref: Option<ChargeSessionPayloadRef>,
) -> Result<Option<Uuid>> {
    let is_rivian_network = infer_is_rivian_network(summary.vendor.as_deref());
    let normalized_charger_type = normalize_api_charger_type(summary.charger_type.as_deref())
        .or_else(|| infer_api_charger_type(summary.vendor.as_deref(), summary.is_home_charger));
    let aliases = parse_summary_aliases(summary);
    let preferred_external_id =
        preferred_external_alias(&aliases).map(|alias| alias.external_id.as_str());
    let grouping_key = normalize_grouping_key(
        summary
            .meta
            .as_ref()
            .and_then(|meta| meta.transaction_id_grouping_key.as_deref()),
    );

    let matched =
        if let Some(existing) = find_session_by_external_alias(pool, vehicle_id, &aliases).await? {
            Some(existing)
        } else if let Some(existing) = find_session_by_grouping_key(
            pool,
            vehicle_id,
            grouping_key.as_deref(),
            summary.start_instant,
        )
        .await?
        {
            Some(existing)
        } else if let Some(existing) =
            find_overlapping_session(pool, vehicle_id, summary.start_instant, summary.end_instant)
                .await?
        {
            Some(existing)
        } else {
            find_time_window_session(pool, vehicle_id, summary.start_instant).await?
        };

    let session_id = if let Some(existing) = matched {
        update_session_from_summary(
            pool,
            existing.id,
            existing.source.as_deref(),
            summary,
            normalized_charger_type,
            is_rivian_network,
        )
        .await?;
        Some(existing.id)
    } else if should_insert_unmatched_session(insert_policy, summary.start_instant) {
        insert_api_only_session(
            pool,
            vehicle_id,
            summary,
            normalized_charger_type,
            is_rivian_network,
            preferred_external_id,
        )
        .await?
    } else {
        None
    };

    if let Some(session_id) = session_id {
        if !aliases.is_empty() {
            upsert_external_aliases(pool, session_id, &aliases, payload_ref).await?;
            finalize_charge_session_aliases(pool, session_id).await?;
        }
    }

    Ok(session_id)
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct ChargeSessionCanonicalizationStats {
    pub source_backfills: u64,
    pub alias_backfills: u64,
    pub payload_reconciliations: u64,
    pub clusters_merged: u64,
    pub duplicate_rows_deleted: u64,
    pub telemetry_restamps: u64,
    pub curve_point_restamps: u64,
    pub payload_restamps: u64,
    pub annotation_restamps: u64,
    pub alias_rows_rehomed: u64,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct ChargeSessionDiagnostics {
    pub alias_duplicate_clusters: i64,
    pub api_telemetry_overlap_pairs: i64,
    pub restart_split_pairs: i64,
    pub unlinked_payloads_inside_telemetry_window: i64,
    pub unlinked_payloads_outside_telemetry_window: i64,
    pub canonical_overlap_pairs: i64,
    pub null_source_rows: i64,
}

#[derive(Debug, Clone, FromRow)]
struct PayloadReplayRow {
    id: Uuid,
    vehicle_id: Uuid,
    captured_at: DateTime<Utc>,
    payload: serde_json::Value,
}

#[derive(Debug, Clone, FromRow)]
struct CanonicalSessionRow {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    api_started_at: Option<DateTime<Utc>>,
    api_ended_at: Option<DateTime<Utc>>,
    source: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct CanonicalAliasRow {
    charge_session_id: Uuid,
    external_id: String,
    alias_kind: String,
    transaction_id_grouping_key: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct RestartSplitPairRow {
    left_id: Uuid,
    right_id: Uuid,
}

#[derive(Debug, Default)]
struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(size: usize) -> Self {
        Self {
            parent: (0..size).collect(),
        }
    }

    fn find(&mut self, index: usize) -> usize {
        if self.parent[index] != index {
            let root = self.find(self.parent[index]);
            self.parent[index] = root;
        }
        self.parent[index]
    }

    fn union(&mut self, left: usize, right: usize) {
        let left_root = self.find(left);
        let right_root = self.find(right);
        if left_root != right_root {
            self.parent[right_root] = left_root;
        }
    }
}

fn is_telemetry_backed(source: Option<&str>) -> bool {
    !matches!(source, Some(CHARGE_SESSION_SOURCE_RIVIAN_API))
}

fn has_api_evidence(session: &CanonicalSessionRow) -> bool {
    matches!(
        session.source.as_deref(),
        Some(CHARGE_SESSION_SOURCE_RIVIAN_API | CHARGE_SESSION_SOURCE_TELEMETRY_AND_API)
    ) || session.api_started_at.is_some()
        || session.api_ended_at.is_some()
}

fn session_window_start(session: &CanonicalSessionRow) -> DateTime<Utc> {
    match session.source.as_deref() {
        Some(CHARGE_SESSION_SOURCE_RIVIAN_API) | Some(CHARGE_SESSION_SOURCE_TELEMETRY_AND_API) => {
            session.api_started_at.unwrap_or(session.started_at)
        }
        _ => session.started_at,
    }
}

fn session_window_end(session: &CanonicalSessionRow) -> DateTime<Utc> {
    let ended_at = session.ended_at.unwrap_or(session.started_at);
    match session.source.as_deref() {
        Some(CHARGE_SESSION_SOURCE_RIVIAN_API) | Some(CHARGE_SESSION_SOURCE_TELEMETRY_AND_API) => {
            session.api_ended_at.unwrap_or(ended_at)
        }
        _ => ended_at,
    }
}

fn alias_rank_from_str(value: &str) -> i32 {
    alias_kind_from_str(value).rank()
}

fn choose_canonical_session<'a>(
    sessions: &'a [CanonicalSessionRow],
    aliases_by_session: &std::collections::HashMap<Uuid, Vec<CanonicalAliasRow>>,
) -> &'a CanonicalSessionRow {
    sessions
        .iter()
        .max_by(|left, right| {
            canonical_priority(left, aliases_by_session)
                .cmp(&canonical_priority(right, aliases_by_session))
                .then_with(|| right.started_at.cmp(&left.started_at))
        })
        .expect("cluster must contain at least one session")
}

fn canonical_priority(
    session: &CanonicalSessionRow,
    aliases_by_session: &std::collections::HashMap<Uuid, Vec<CanonicalAliasRow>>,
) -> (i32, i32) {
    let source_priority = match session.source.as_deref() {
        Some(CHARGE_SESSION_SOURCE_TELEMETRY_AND_API) => 4,
        Some(CHARGE_SESSION_SOURCE_TELEMETRY) | None => 3,
        Some(CHARGE_SESSION_SOURCE_RIVIAN_API) => 1,
        Some(_) => 2,
    };
    let alias_priority = aliases_by_session
        .get(&session.id)
        .and_then(|aliases| {
            aliases
                .iter()
                .map(|alias| -alias_rank_from_str(&alias.alias_kind))
                .max()
        })
        .unwrap_or(0);
    (source_priority, alias_priority)
}

pub async fn replay_charge_payload_summaries(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
    insert_policy: UnmatchedInsertPolicy,
) -> Result<u64> {
    let payloads = sqlx::query_as::<_, PayloadReplayRow>(
        r#"
        SELECT id, vehicle_id, captured_at, payload
        FROM riviamigo.rivian_charge_payloads
        WHERE operation = 'getCompletedSessionSummaries'
          AND ($1::uuid IS NULL OR vehicle_id = $1)
        ORDER BY captured_at ASC, id ASC
        "#,
    )
    .bind(vehicle_id)
    .fetch_all(pool)
    .await?;

    let mut linked = 0u64;
    for payload in payloads {
        let Ok(summary) =
            serde_json::from_value::<ChargeSessionSummaryPayload>(payload.payload.clone())
        else {
            continue;
        };

        let payload_ref = ChargeSessionPayloadRef {
            payload_id: payload.id,
            captured_at: payload.captured_at,
        };
        if let Some(session_id) = reconcile_completed_session_summary(
            pool,
            payload.vehicle_id,
            &summary,
            insert_policy,
            Some(payload_ref),
        )
        .await?
        {
            sqlx::query(
                "UPDATE riviamigo.rivian_charge_payloads
                 SET charge_session_id = $2
                 WHERE id = $1",
            )
            .bind(payload.id)
            .bind(session_id)
            .execute(pool)
            .await?;
            linked += 1;
        }
    }

    Ok(linked)
}

pub async fn diagnose_charge_sessions(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
) -> Result<ChargeSessionDiagnostics> {
    let alias_duplicate_clusters = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)::int8
        FROM (
            SELECT transaction_id_grouping_key
            FROM riviamigo.charge_session_external_aliases
            WHERE transaction_id_grouping_key IS NOT NULL
              AND ($1::uuid IS NULL OR charge_session_id IN (
                    SELECT id FROM riviamigo.charge_sessions WHERE vehicle_id = $1
              ))
            GROUP BY transaction_id_grouping_key
            HAVING COUNT(DISTINCT charge_session_id) > 1
        ) grouped
        "#,
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;

    let api_telemetry_overlap_pairs = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)::int8
        FROM riviamigo.charge_sessions api
        JOIN riviamigo.charge_sessions live
          ON api.vehicle_id = live.vehicle_id
         AND api.id < live.id
         AND api.started_at <= COALESCE(live.ended_at, live.started_at)
         AND COALESCE(api.ended_at, api.started_at) >= live.started_at
        WHERE api.source = 'rivian_api'
          AND COALESCE(live.source, 'telemetry') <> 'rivian_api'
          AND ($1::uuid IS NULL OR api.vehicle_id = $1)
        "#,
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;

    let restart_split_pairs = sqlx::query_scalar::<_, i64>(
        r#"
        WITH transitions AS (
            SELECT
                vehicle_id,
                LAG(charge_session_id) OVER (PARTITION BY vehicle_id ORDER BY ts) AS left_id,
                charge_session_id AS right_id,
                ts,
                LAG(ts) OVER (PARTITION BY vehicle_id ORDER BY ts) AS prev_ts
            FROM timeseries.telemetry
            WHERE charge_session_id IS NOT NULL
              AND ($1::uuid IS NULL OR vehicle_id = $1)
        )
        SELECT COUNT(*)::int8
        FROM (
            SELECT DISTINCT vehicle_id, left_id, right_id
            FROM transitions
            WHERE left_id IS NOT NULL
              AND right_id IS NOT NULL
              AND left_id <> right_id
              AND prev_ts IS NOT NULL
              AND ts - prev_ts <= interval '15 minutes'
        ) deduped
        "#,
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;

    let unlinked_payloads_inside_telemetry_window = sqlx::query_scalar::<_, i64>(
        r#"
        WITH telemetry_window AS (
            SELECT vehicle_id, MIN(ts) AS min_ts, MAX(ts) AS max_ts
            FROM timeseries.telemetry
            GROUP BY vehicle_id
        )
        SELECT COUNT(DISTINCT COALESCE(payload.rivian_transaction_id, payload.payload ->> 'transactionId'))::int8
        FROM riviamigo.rivian_charge_payloads payload
        JOIN telemetry_window tw ON tw.vehicle_id = payload.vehicle_id
        WHERE payload.operation = 'getCompletedSessionSummaries'
          AND payload.charge_session_id IS NULL
          AND ($1::uuid IS NULL OR payload.vehicle_id = $1)
          AND (payload.payload ->> 'startInstant')::timestamptz BETWEEN tw.min_ts AND tw.max_ts
        "#,
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;

    let unlinked_payloads_outside_telemetry_window = sqlx::query_scalar::<_, i64>(
        r#"
        WITH telemetry_window AS (
            SELECT vehicle_id, MIN(ts) AS min_ts, MAX(ts) AS max_ts
            FROM timeseries.telemetry
            GROUP BY vehicle_id
        )
        SELECT COUNT(DISTINCT COALESCE(payload.rivian_transaction_id, payload.payload ->> 'transactionId'))::int8
        FROM riviamigo.rivian_charge_payloads payload
        LEFT JOIN telemetry_window tw ON tw.vehicle_id = payload.vehicle_id
        WHERE payload.operation = 'getCompletedSessionSummaries'
          AND payload.charge_session_id IS NULL
          AND ($1::uuid IS NULL OR payload.vehicle_id = $1)
          AND (
              tw.vehicle_id IS NULL
              OR (payload.payload ->> 'startInstant')::timestamptz < tw.min_ts
              OR (payload.payload ->> 'startInstant')::timestamptz > tw.max_ts
          )
        "#,
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;

    let canonical_overlap_pairs = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)::int8
        FROM riviamigo.charge_sessions a
        JOIN riviamigo.charge_sessions b
          ON a.vehicle_id = b.vehicle_id
         AND a.id < b.id
         AND a.started_at <= COALESCE(b.ended_at, b.started_at)
         AND COALESCE(a.ended_at, a.started_at) >= b.started_at
        WHERE ($1::uuid IS NULL OR a.vehicle_id = $1)
        "#,
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;

    let null_source_rows = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::int8 FROM riviamigo.charge_sessions WHERE ($1::uuid IS NULL OR vehicle_id = $1) AND source IS NULL",
    )
    .bind(vehicle_id)
    .fetch_one(pool)
    .await?;

    Ok(ChargeSessionDiagnostics {
        alias_duplicate_clusters,
        api_telemetry_overlap_pairs,
        restart_split_pairs,
        unlinked_payloads_inside_telemetry_window,
        unlinked_payloads_outside_telemetry_window,
        canonical_overlap_pairs,
        null_source_rows,
    })
}

#[allow(clippy::field_reassign_with_default)]
pub async fn canonicalize_charge_sessions(
    pool: &PgPool,
    vehicle_id: Option<Uuid>,
) -> Result<ChargeSessionCanonicalizationStats> {
    let mut stats = ChargeSessionCanonicalizationStats::default();
    stats.source_backfills = backfill_charge_session_sources(pool, vehicle_id).await?;
    stats.alias_backfills = backfill_charge_session_aliases_from_rows(pool, vehicle_id).await?;
    stats.payload_reconciliations =
        replay_charge_payload_summaries(pool, vehicle_id, UnmatchedInsertPolicy::Always).await?;

    let vehicle_ids = if let Some(vehicle_id) = vehicle_id {
        vec![vehicle_id]
    } else {
        sqlx::query_scalar::<_, Uuid>(
            "SELECT DISTINCT vehicle_id FROM riviamigo.charge_sessions ORDER BY vehicle_id",
        )
        .fetch_all(pool)
        .await?
    };

    for vehicle_id in vehicle_ids {
        let sessions = sqlx::query_as::<_, CanonicalSessionRow>(
            r#"
            SELECT
                id,
                started_at,
                ended_at,
                api_started_at,
                api_ended_at,
                source
            FROM riviamigo.charge_sessions
            WHERE vehicle_id = $1
            ORDER BY started_at, id
            "#,
        )
        .bind(vehicle_id)
        .fetch_all(pool)
        .await?;
        if sessions.len() < 2 {
            continue;
        }

        let aliases = sqlx::query_as::<_, CanonicalAliasRow>(
            r#"
            SELECT charge_session_id, external_id, alias_kind, transaction_id_grouping_key
            FROM riviamigo.charge_session_external_aliases
            WHERE charge_session_id IN (
                SELECT id FROM riviamigo.charge_sessions WHERE vehicle_id = $1
            )
            "#,
        )
        .bind(vehicle_id)
        .fetch_all(pool)
        .await?;

        let restart_pairs = sqlx::query_as::<_, RestartSplitPairRow>(
            r#"
            WITH transitions AS (
                SELECT
                    LAG(charge_session_id) OVER (PARTITION BY vehicle_id ORDER BY ts) AS left_id,
                    charge_session_id AS right_id,
                    ts,
                    LAG(ts) OVER (PARTITION BY vehicle_id ORDER BY ts) AS prev_ts
                FROM timeseries.telemetry
                WHERE vehicle_id = $1
                  AND charge_session_id IS NOT NULL
            )
            SELECT DISTINCT left_id, right_id
            FROM transitions
            WHERE left_id IS NOT NULL
              AND right_id IS NOT NULL
              AND left_id <> right_id
              AND prev_ts IS NOT NULL
              AND ts - prev_ts <= interval '15 minutes'
            "#,
        )
        .bind(vehicle_id)
        .fetch_all(pool)
        .await?;

        let mut session_indexes = std::collections::HashMap::<Uuid, usize>::new();
        for (index, session) in sessions.iter().enumerate() {
            session_indexes.insert(session.id, index);
        }

        let mut union_find = UnionFind::new(sessions.len());
        let mut aliases_by_external = std::collections::HashMap::<String, Vec<Uuid>>::new();
        let mut aliases_by_grouping = std::collections::HashMap::<String, Vec<Uuid>>::new();
        let mut aliases_by_session =
            std::collections::HashMap::<Uuid, Vec<CanonicalAliasRow>>::new();
        for alias in aliases {
            aliases_by_external
                .entry(alias.external_id.clone())
                .or_default()
                .push(alias.charge_session_id);
            if let Some(grouping_key) = alias.transaction_id_grouping_key.clone() {
                aliases_by_grouping
                    .entry(grouping_key)
                    .or_default()
                    .push(alias.charge_session_id);
            }
            aliases_by_session
                .entry(alias.charge_session_id)
                .or_default()
                .push(alias);
        }

        for ids in aliases_by_external.values() {
            if let Some((&first, rest)) = ids.split_first() {
                for &other in rest {
                    union_find.union(session_indexes[&first], session_indexes[&other]);
                }
            }
        }
        for ids in aliases_by_grouping.values() {
            if let Some((&first, rest)) = ids.split_first() {
                for &other in rest {
                    union_find.union(session_indexes[&first], session_indexes[&other]);
                }
            }
        }
        for pair in restart_pairs {
            if let (Some(&left), Some(&right)) = (
                session_indexes.get(&pair.left_id),
                session_indexes.get(&pair.right_id),
            ) {
                union_find.union(left, right);
            }
        }
        for left_index in 0..sessions.len() {
            for right_index in (left_index + 1)..sessions.len() {
                if session_window_start(&sessions[left_index])
                    <= session_window_end(&sessions[right_index])
                    && session_window_start(&sessions[right_index])
                        <= session_window_end(&sessions[left_index])
                {
                    union_find.union(left_index, right_index);
                }
            }
        }

        let mut clusters = std::collections::HashMap::<usize, Vec<CanonicalSessionRow>>::new();
        for session in sessions {
            let root = union_find.find(session_indexes[&session.id]);
            clusters.entry(root).or_default().push(session);
        }

        for cluster_sessions in clusters.into_values() {
            if cluster_sessions.len() < 2 {
                continue;
            }

            let canonical =
                choose_canonical_session(&cluster_sessions, &aliases_by_session).clone();
            let has_telemetry = cluster_sessions
                .iter()
                .any(|session| is_telemetry_backed(session.source.as_deref()));
            let has_api = cluster_sessions.iter().any(has_api_evidence);
            let canonical_started_at = if has_telemetry {
                cluster_sessions
                    .iter()
                    .filter(|session| is_telemetry_backed(session.source.as_deref()))
                    .map(|session| session.started_at)
                    .min()
                    .unwrap_or(canonical.started_at)
            } else {
                cluster_sessions
                    .iter()
                    .map(|session| session.started_at)
                    .min()
                    .unwrap_or(canonical.started_at)
            };
            let canonical_ended_at = if has_telemetry {
                cluster_sessions
                    .iter()
                    .filter(|session| is_telemetry_backed(session.source.as_deref()))
                    .map(|session| session.ended_at.unwrap_or(session.started_at))
                    .max()
                    .or(canonical.ended_at)
            } else {
                cluster_sessions
                    .iter()
                    .map(|session| session.ended_at.unwrap_or(session.started_at))
                    .max()
                    .or(canonical.ended_at)
            };
            let api_started_at = cluster_sessions
                .iter()
                .filter(|session| has_api_evidence(session))
                .map(|session| session.api_started_at.unwrap_or(session.started_at))
                .min();
            let api_ended_at = cluster_sessions
                .iter()
                .filter(|session| has_api_evidence(session))
                .map(|session| {
                    session
                        .api_ended_at
                        .unwrap_or(session.ended_at.unwrap_or(session.started_at))
                })
                .max();
            let source = if has_telemetry && has_api {
                CHARGE_SESSION_SOURCE_TELEMETRY_AND_API
            } else if has_telemetry {
                CHARGE_SESSION_SOURCE_TELEMETRY
            } else {
                CHARGE_SESSION_SOURCE_RIVIAN_API
            };
            let preferred_external_id = cluster_sessions
                .iter()
                .flat_map(|session| aliases_by_session.get(&session.id).into_iter().flatten())
                .min_by(|left, right| {
                    alias_rank_from_str(&left.alias_kind)
                        .cmp(&alias_rank_from_str(&right.alias_kind))
                        .then_with(|| left.external_id.cmp(&right.external_id))
                })
                .map(|alias| alias.external_id.clone());

            for duplicate in cluster_sessions
                .iter()
                .filter(|session| session.id != canonical.id)
            {
                stats.telemetry_restamps += sqlx::query(
                    "UPDATE timeseries.telemetry SET charge_session_id = $1 WHERE charge_session_id = $2",
                )
                .bind(canonical.id)
                .bind(duplicate.id)
                .execute(pool)
                .await?
                .rows_affected();

                stats.curve_point_restamps += sqlx::query(
                    "UPDATE riviamigo.rivian_charge_curve_points SET charge_session_id = $1 WHERE charge_session_id = $2",
                )
                .bind(canonical.id)
                .bind(duplicate.id)
                .execute(pool)
                .await?
                .rows_affected();

                stats.payload_restamps += sqlx::query(
                    "UPDATE riviamigo.rivian_charge_payloads SET charge_session_id = $1 WHERE charge_session_id = $2",
                )
                .bind(canonical.id)
                .bind(duplicate.id)
                .execute(pool)
                .await?
                .rows_affected();

                stats.annotation_restamps += sqlx::query(
                    r#"
                    INSERT INTO riviamigo.charge_session_user_annotations (
                        charge_session_id,
                        user_id,
                        geofence_id,
                        address_id,
                        is_home,
                        cost_profile_id,
                        cost_method,
                        cost_usd,
                        currency_code,
                        computed_at
                    )
                    SELECT
                        $1,
                        user_id,
                        geofence_id,
                        address_id,
                        is_home,
                        cost_profile_id,
                        cost_method,
                        cost_usd,
                        currency_code,
                        computed_at
                    FROM riviamigo.charge_session_user_annotations
                    WHERE charge_session_id = $2
                    ON CONFLICT (charge_session_id, user_id) DO UPDATE
                    SET geofence_id = COALESCE(riviamigo.charge_session_user_annotations.geofence_id, EXCLUDED.geofence_id),
                        address_id = COALESCE(riviamigo.charge_session_user_annotations.address_id, EXCLUDED.address_id),
                        is_home = COALESCE(riviamigo.charge_session_user_annotations.is_home, EXCLUDED.is_home),
                        cost_profile_id = COALESCE(riviamigo.charge_session_user_annotations.cost_profile_id, EXCLUDED.cost_profile_id),
                        cost_method = COALESCE(riviamigo.charge_session_user_annotations.cost_method, EXCLUDED.cost_method),
                        cost_usd = COALESCE(riviamigo.charge_session_user_annotations.cost_usd, EXCLUDED.cost_usd),
                        currency_code = COALESCE(riviamigo.charge_session_user_annotations.currency_code, EXCLUDED.currency_code),
                        computed_at = COALESCE(riviamigo.charge_session_user_annotations.computed_at, EXCLUDED.computed_at),
                        updated_at = now()
                    "#,
                )
                .bind(canonical.id)
                .bind(duplicate.id)
                .execute(pool)
                .await?
                .rows_affected();

                stats.alias_rows_rehomed += sqlx::query(
                    r#"
                    INSERT INTO riviamigo.charge_session_external_aliases (
                        charge_session_id,
                        external_id,
                        alias_kind,
                        transaction_id_grouping_key,
                        first_seen_at,
                        last_seen_at,
                        latest_payload_id,
                        latest_payload_captured_at
                    )
                    SELECT
                        $1,
                        external_id,
                        alias_kind,
                        transaction_id_grouping_key,
                        first_seen_at,
                        last_seen_at,
                        latest_payload_id,
                        latest_payload_captured_at
                    FROM riviamigo.charge_session_external_aliases
                    WHERE charge_session_id = $2
                    ON CONFLICT (charge_session_id, external_id) DO UPDATE
                    SET alias_kind = CASE
                            WHEN riviamigo.charge_session_external_aliases.alias_kind = 'legacy'
                                 AND EXCLUDED.alias_kind <> 'legacy'
                            THEN EXCLUDED.alias_kind
                            ELSE riviamigo.charge_session_external_aliases.alias_kind
                        END,
                        transaction_id_grouping_key = COALESCE(
                            EXCLUDED.transaction_id_grouping_key,
                            riviamigo.charge_session_external_aliases.transaction_id_grouping_key
                        ),
                        first_seen_at = LEAST(
                            riviamigo.charge_session_external_aliases.first_seen_at,
                            EXCLUDED.first_seen_at
                        ),
                        last_seen_at = GREATEST(
                            riviamigo.charge_session_external_aliases.last_seen_at,
                            EXCLUDED.last_seen_at
                        ),
                        latest_payload_id = COALESCE(EXCLUDED.latest_payload_id, riviamigo.charge_session_external_aliases.latest_payload_id),
                        latest_payload_captured_at = COALESCE(
                            EXCLUDED.latest_payload_captured_at,
                            riviamigo.charge_session_external_aliases.latest_payload_captured_at
                        ),
                        updated_at = now()
                    "#,
                )
                .bind(canonical.id)
                .bind(duplicate.id)
                .execute(pool)
                .await?
                .rows_affected();

                sqlx::query(
                    "DELETE FROM riviamigo.charge_session_external_aliases WHERE charge_session_id = $1",
                )
                .bind(duplicate.id)
                .execute(pool)
                .await?;

                sqlx::query(
                    r#"
                    UPDATE riviamigo.charge_sessions canonical
                    SET
                        location_lat = COALESCE(canonical.location_lat, duplicate.location_lat),
                        location_lng = COALESCE(canonical.location_lng, duplicate.location_lng),
                        is_home = COALESCE(canonical.is_home, duplicate.is_home),
                        charger_type = COALESCE(canonical.charger_type, duplicate.charger_type),
                        kwh_added = CASE
                            WHEN canonical.kwh_added IS NULL THEN duplicate.kwh_added
                            WHEN duplicate.kwh_added IS NULL THEN canonical.kwh_added
                            ELSE GREATEST(canonical.kwh_added, duplicate.kwh_added)
                        END,
                        soc_start = COALESCE(canonical.soc_start, duplicate.soc_start),
                        soc_end = COALESCE(canonical.soc_end, duplicate.soc_end),
                        charge_limit = COALESCE(canonical.charge_limit, duplicate.charge_limit),
                        max_charge_rate_kw = CASE
                            WHEN canonical.max_charge_rate_kw IS NULL THEN duplicate.max_charge_rate_kw
                            WHEN duplicate.max_charge_rate_kw IS NULL THEN canonical.max_charge_rate_kw
                            ELSE GREATEST(canonical.max_charge_rate_kw, duplicate.max_charge_rate_kw)
                        END,
                        cost_usd = COALESCE(canonical.cost_usd, duplicate.cost_usd),
                        cost_method = COALESCE(canonical.cost_method, duplicate.cost_method),
                        energy_added_wh = CASE
                            WHEN canonical.energy_added_wh IS NULL THEN duplicate.energy_added_wh
                            WHEN duplicate.energy_added_wh IS NULL THEN canonical.energy_added_wh
                            ELSE GREATEST(canonical.energy_added_wh, duplicate.energy_added_wh)
                        END,
                        energy_used_wh = CASE
                            WHEN canonical.energy_used_wh IS NULL THEN duplicate.energy_used_wh
                            WHEN duplicate.energy_used_wh IS NULL THEN canonical.energy_used_wh
                            ELSE GREATEST(canonical.energy_used_wh, duplicate.energy_used_wh)
                        END,
                        avg_charge_rate_kw = CASE
                            WHEN canonical.avg_charge_rate_kw IS NULL THEN duplicate.avg_charge_rate_kw
                            WHEN duplicate.avg_charge_rate_kw IS NULL THEN canonical.avg_charge_rate_kw
                            ELSE GREATEST(canonical.avg_charge_rate_kw, duplicate.avg_charge_rate_kw)
                        END,
                        network_vendor = COALESCE(canonical.network_vendor, duplicate.network_vendor),
                        range_added_km = CASE
                            WHEN canonical.range_added_km IS NULL THEN duplicate.range_added_km
                            WHEN duplicate.range_added_km IS NULL THEN canonical.range_added_km
                            ELSE GREATEST(canonical.range_added_km, duplicate.range_added_km)
                        END,
                        is_free_session = COALESCE(canonical.is_free_session, duplicate.is_free_session),
                        is_rivian_network = COALESCE(canonical.is_rivian_network, duplicate.is_rivian_network),
                        rivian_paid_total = CASE
                            WHEN canonical.rivian_paid_total IS NULL THEN duplicate.rivian_paid_total
                            WHEN duplicate.rivian_paid_total IS NULL THEN canonical.rivian_paid_total
                            ELSE GREATEST(canonical.rivian_paid_total, duplicate.rivian_paid_total)
                        END,
                        rivian_charger_type = COALESCE(canonical.rivian_charger_type, duplicate.rivian_charger_type),
                        currency_code = COALESCE(canonical.currency_code, duplicate.currency_code),
                        rivian_city = COALESCE(canonical.rivian_city, duplicate.rivian_city),
                        rivian_vehicle_id = COALESCE(canonical.rivian_vehicle_id, duplicate.rivian_vehicle_id),
                        rivian_vehicle_name = COALESCE(canonical.rivian_vehicle_name, duplicate.rivian_vehicle_name),
                        is_public = COALESCE(canonical.is_public, duplicate.is_public),
                        rivian_meta = COALESCE(canonical.rivian_meta, duplicate.rivian_meta),
                        charger_id = COALESCE(canonical.charger_id, duplicate.charger_id),
                        live_current_price = COALESCE(canonical.live_current_price, duplicate.live_current_price),
                        live_current_currency = COALESCE(canonical.live_current_currency, duplicate.live_current_currency),
                        live_total_charged_kwh = COALESCE(canonical.live_total_charged_kwh, duplicate.live_total_charged_kwh),
                        live_range_added_km = COALESCE(canonical.live_range_added_km, duplicate.live_range_added_km),
                        live_power_kw = COALESCE(canonical.live_power_kw, duplicate.live_power_kw),
                        live_charge_rate_kph = COALESCE(canonical.live_charge_rate_kph, duplicate.live_charge_rate_kph)
                    FROM riviamigo.charge_sessions duplicate
                    WHERE canonical.id = $1
                      AND duplicate.id = $2
                    "#,
                )
                .bind(canonical.id)
                .bind(duplicate.id)
                .execute(pool)
                .await?;

                sqlx::query("DELETE FROM riviamigo.charge_sessions WHERE id = $1")
                    .bind(duplicate.id)
                    .execute(pool)
                    .await?;
                stats.duplicate_rows_deleted += 1;
            }

            sqlx::query(
                r#"
                UPDATE riviamigo.charge_sessions
                SET started_at = $2,
                    ended_at = $3,
                    api_started_at = $4,
                    api_ended_at = $5,
                    source = $6,
                    data_confidence = $7,
                    duration_minutes = CASE
                        WHEN $3::timestamptz IS NOT NULL
                        THEN EXTRACT(EPOCH FROM ($3::timestamptz - $2::timestamptz))::int / 60
                        ELSE duration_minutes
                    END,
                    rivian_session_id = COALESCE($8, rivian_session_id)
                WHERE id = $1
                "#,
            )
            .bind(canonical.id)
            .bind(canonical_started_at)
            .bind(canonical_ended_at)
            .bind(api_started_at)
            .bind(api_ended_at)
            .bind(source)
            .bind(confidence_for_source(source))
            .bind(preferred_external_id.as_deref())
            .execute(pool)
            .await?;
            finalize_charge_session_aliases(pool, canonical.id).await?;
            stats.clusters_merged += 1;
        }
    }

    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn normalizes_grouping_keys_stably() {
        assert_eq!(
            normalize_grouping_key(Some("VTXN-2, TXN-1,TXN-1")),
            Some("TXN-1,VTXN-2".to_string())
        );
    }

    #[test]
    fn prefers_txn_alias_over_vtxn_alias() {
        let summary = ChargeSessionSummaryPayload {
            transaction_id: Some("d284".to_string()),
            start_instant: Some(Utc.with_ymd_and_hms(2026, 6, 20, 15, 17, 0).unwrap()),
            end_instant: Some(Utc.with_ymd_and_hms(2026, 6, 20, 16, 1, 0).unwrap()),
            charger_type: Some("dcfc".to_string()),
            currency_code: Some("USD".to_string()),
            total_energy_kwh: Some(45.2),
            range_added_km: Some(120.0),
            city: Some("Austin".to_string()),
            vehicle_id: Some("veh-1".to_string()),
            vehicle_name: Some("R1S".to_string()),
            vendor: Some("Rivian".to_string()),
            paid_total: Some(18.4),
            is_public: Some(true),
            is_home_charger: Some(false),
            is_roaming_network: Some(false),
            meta: Some(ChargeSessionSummaryMeta {
                transaction_id_grouping_key: Some("8fbf,d284".to_string()),
                data_sources: Some(vec![
                    "VTXN:d284".to_string(),
                    "TXN:8fbf".to_string(),
                    "CDRS:USCPI123".to_string(),
                ]),
            }),
        };

        let aliases = parse_summary_aliases(&summary);
        let preferred = preferred_external_alias(&aliases).expect("preferred alias");
        assert_eq!(preferred.alias_kind, ExternalAliasKind::Cdrs);
        assert_eq!(preferred.external_id, "USCPI123");
        assert!(aliases
            .iter()
            .any(|alias| alias.alias_kind == ExternalAliasKind::Txn));
        assert!(aliases
            .iter()
            .any(|alias| alias.alias_kind == ExternalAliasKind::Vtxn));
    }

    #[test]
    fn recent_only_insert_policy_respects_lookback() {
        let now = Utc.with_ymd_and_hms(2026, 6, 21, 12, 0, 0).unwrap();
        assert!(should_insert_unmatched_session(
            UnmatchedInsertPolicy::RecentOnly {
                now,
                lookback_days: 30,
            },
            Some(Utc.with_ymd_and_hms(2026, 6, 10, 12, 0, 0).unwrap()),
        ));
        assert!(!should_insert_unmatched_session(
            UnmatchedInsertPolicy::RecentOnly {
                now,
                lookback_days: 30,
            },
            Some(Utc.with_ymd_and_hms(2026, 4, 10, 12, 0, 0).unwrap()),
        ));
    }
}
