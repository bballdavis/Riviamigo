use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_owned,
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/charging", get(list_sessions))
        .route("/charging/summary", get(get_summary))
        .route("/charging/sessions", get(list_sessions))
        .route("/charging/sessions/:id/curve", get(get_session_curve))
        .route("/charging/sessions/:id", get(get_session))
        .route("/charging/:id/curve", get(get_session_curve))
        .route("/charging/:id", get(get_session))
        .route("/charging/curve-analysis", get(get_curve_analysis))
        .route(
            "/vehicles/:vehicle_id/charging-sessions",
            get(list_sessions_path),
        )
        .route(
            "/vehicles/:vehicle_id/charging-sessions/:id/curve",
            get(get_session_curve_path),
        )
        .route(
            "/vehicles/:vehicle_id/charging-sessions/:id",
            get(get_session_path),
        )
        .route("/vehicles/:vehicle_id/costs", get(get_summary_path))
}

#[derive(Deserialize)]
struct SessionListParams {
    vehicle_id: Option<Uuid>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    limit: Option<i64>,
    offset: Option<i64>,
    page: Option<i64>,
    per_page: Option<i64>,
}

#[derive(Deserialize)]
struct VehicleParam {
    vehicle_id: Option<Uuid>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct SessionRow {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    location_lat: Option<f64>,
    location_lng: Option<f64>,
    location_name: Option<String>,
    is_home: Option<bool>,
    charger_type: Option<String>,
    kwh_added: Option<f64>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    max_charge_rate_kw: Option<f64>,
    duration_minutes: Option<i32>,
    cost_usd: Option<f64>,
    // Enrichment fields (migration 0024)
    network_vendor: Option<String>,
    range_added_km: Option<f64>,
    is_free_session: Option<bool>,
    is_rivian_network: Option<bool>,
    rivian_paid_total: Option<f64>,
    source: Option<String>,
    telemetry_sample_count: i64,
    rivian_charger_type: Option<String>,
    currency_code: Option<String>,
    rivian_city: Option<String>,
    is_public: Option<bool>,
    charger_id: Option<String>,
    live_current_price: Option<f64>,
    live_current_currency: Option<String>,
    live_total_charged_kwh: Option<f64>,
    live_range_added_km: Option<f64>,
    live_power_kw: Option<f64>,
    live_charge_rate_kph: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct NetworkBreakdownRow {
    network_vendor: Option<String>,
    session_count: i64,
    energy_kwh: Option<f64>,
    cost_usd: Option<f64>,
    free_sessions: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct SessionBoundsRow {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    charger_type: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct SummaryAggRow {
    total_kwh: Option<f64>,
    session_count: i64,
    home_kwh: Option<f64>,
    away_kwh: Option<f64>,
    unknown_location_kwh: Option<f64>,
    ac_kwh: Option<f64>,
    ac_l2_kwh: Option<f64>,
    dc_kwh: Option<f64>,
    typed_session_count: i64,
    max_charge_limit_pct: Option<f64>,
    max_charge_rate_kw: Option<f64>,
    total_energy_used_kwh: Option<f64>,
    total_cost_usd: Option<f64>,
    known_cost_session_count: i64,
    unknown_cost_session_count: i64,
    // Enrichment fields (migration 0024)
    free_session_count: i64,
    total_range_added_km: Option<f64>,
    rivian_paid_total_usd: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct WeeklySummaryRow {
    week_start: Option<DateTime<Utc>>,
    kwh: Option<f64>,
    cost_usd: Option<f64>,
    sessions: i64,
}

#[derive(Debug, sqlx::FromRow)]
struct CurveRow {
    minutes_elapsed: Option<f64>,
    charge_rate_kw: Option<f64>,
    soc: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct CurveAnalysisRow {
    soc: Option<f64>,
    charge_rate_kw: Option<f64>,
    charger_type: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct CapacitySourcesRow {
    vehicle_capacity_wh: Option<f64>,
    telemetry_latest_capacity_wh: Option<f64>,
    telemetry_max_capacity_wh: Option<f64>,
}

fn normalize_capacity_kwh(raw: f64) -> Option<f64> {
    if !raw.is_finite() || raw <= 0.0 {
        return None;
    }

    // Some sources report capacity in Wh while others report kWh.
    let kwh = if raw > 1_000.0 { raw / 1000.0 } else { raw };
    if (40.0..=300.0).contains(&kwh) {
        Some(kwh)
    } else {
        None
    }
}

async fn list_sessions(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<SessionListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vehicle_id = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    list_sessions_response(&state, auth.user_id, vehicle_id, p).await
}

async fn get_session(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vehicle_id = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    get_session_response(&state, auth.user_id, vehicle_id, id).await
}

async fn get_session_curve(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    get_session_curve_response(&state, auth.user_id, vid, id).await
}

async fn list_sessions_path(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
    Query(p): Query<SessionListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    list_sessions_response(&state, auth.user_id, vehicle_id, p).await
}

async fn get_session_path(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    get_session_response(&state, auth.user_id, vehicle_id, id).await
}

async fn get_session_curve_path(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    get_session_curve_response(&state, auth.user_id, vehicle_id, id).await
}

async fn get_summary_path(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
    Query(p): Query<SessionListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    get_summary_response(&state, auth.user_id, vehicle_id, p).await
}

async fn get_summary(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<SessionListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vehicle_id = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    get_summary_response(&state, auth.user_id, vehicle_id, p).await
}

async fn get_curve_analysis(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<SessionListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vehicle_id = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vehicle_id).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
    let to = p.to.unwrap_or_else(Utc::now);

    let rows = sqlx::query_as::<_, CurveAnalysisRow>(
        r#"WITH session_windows AS (
               SELECT cs.id,
                      cs.started_at,
                      cs.ended_at,
                      COALESCE(cs.charger_type,
                        CASE
                          WHEN lower(COALESCE(cs.network_vendor, '')) = ANY(ARRAY['tesla','rivian','electrify america','evgo']) THEN 'dc'
                          WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw) < 12 THEN 'ac'
                          WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw) < 50 THEN 'ac_l2'
                          WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw) IS NOT NULL THEN 'dc'
                        END
                      ) AS charger_type
               FROM riviamigo.charge_sessions cs
               WHERE cs.vehicle_id=$1
                 AND cs.started_at >= $2
                 AND cs.started_at <= $3
                 AND cs.ended_at IS NOT NULL
           ),
           samples AS (
               SELECT sw.id AS session_id,
                      sw.charger_type,
                      t.bucket,
                      t.avg_soc,
                      max(t.battery_capacity_wh) OVER (PARTITION BY sw.id) AS cap_wh
               FROM session_windows sw
               JOIN timeseries.telemetry_1min t
                 ON t.vehicle_id=$1
                AND t.bucket >= sw.started_at
                AND t.bucket <= sw.ended_at
               WHERE t.avg_soc IS NOT NULL
           ),
           rates AS (
               SELECT avg_soc AS soc,
                      -- Context-aware cap: same two-tier logic as load_curve.
                      -- DC sessions allow up to 300 kW; AC/unknown capped at 22 kW
                      -- to prevent SOC-gap spikes from offline periods corrupting
                      -- the aggregate charge-curve scatter plot.
                      LEAST(CASE WHEN charger_type = 'dc' THEN 300.0 ELSE 22.0 END,
                            GREATEST(0.0,
                              60.0 * (avg_soc - LAG(avg_soc) OVER (PARTITION BY session_id ORDER BY bucket)) / 100.0
                                   * cap_wh / 1000.0
                      )) AS charge_rate_kw,
                      charger_type
               FROM samples
           )
           SELECT soc, charge_rate_kw, charger_type
           FROM rates
           WHERE charge_rate_kw IS NOT NULL
             AND charge_rate_kw > 0
             AND soc IS NOT NULL
           ORDER BY soc ASC
           LIMIT 12000"#
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(rows
        .iter()
        .map(|r| serde_json::json!({
            "soc_pct": r.soc,
            "charge_rate_kw": r.charge_rate_kw,
            "charger_type": r.charger_type,
        }))
        .collect::<Vec<_>>())))
}

async fn list_sessions_response(
    state: &AppState,
    user_id: Uuid,
    vehicle_id: Uuid,
    p: SessionListParams,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_owned(&state.pool, user_id, vehicle_id).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(90));
    let to = p.to.unwrap_or_else(Utc::now);
    let limit = p.per_page.or(p.limit).unwrap_or(50).clamp(1, 200);
    let page = p.page.unwrap_or(1).max(1);
    let offset = p.offset.unwrap_or((page - 1) * limit).max(0);

    let rows = sqlx::query_as::<_, SessionRow>(
        "SELECT cs.id, cs.started_at, cs.ended_at, cs.location_lat, cs.location_lng, \
                COALESCE(g.name, a.display_name, CASE WHEN cs.is_home THEN 'Home' END) AS location_name, \
                cs.is_home, COALESCE(cs.charger_type, \
                    CASE \
                        WHEN lower(COALESCE(cs.network_vendor, '')) = ANY(ARRAY['tesla','rivian','electrify america','evgo']) THEN 'dc' \
                        WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, \
                            CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) < 12 THEN 'ac' \
                        WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, \
                            CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) < 50 THEN 'ac_l2' \
                        WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, \
                            CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) IS NOT NULL THEN 'dc' \
                    END \
                ) AS charger_type, \
                COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) AS kwh_added, cs.soc_start, cs.soc_end, \
                COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) AS max_charge_rate_kw, cs.duration_minutes, \
                cs.cost_usd AS cost_usd, cs.network_vendor, cs.range_added_km, cs.is_free_session, \
                cs.is_rivian_network, cs.rivian_paid_total, cs.source, \
                cs.rivian_charger_type, cs.currency_code, cs.rivian_city, cs.is_public, cs.charger_id, \
                cs.live_current_price, cs.live_current_currency, cs.live_total_charged_kwh, \
                cs.live_range_added_km, cs.live_power_kw, cs.live_charge_rate_kph, \
                COALESCE(telem.sample_count, 0)::int8 AS telemetry_sample_count \
         FROM riviamigo.charge_sessions cs \
         LEFT JOIN riviamigo.geofences g ON g.id = cs.geofence_id \
         LEFT JOIN riviamigo.addresses a ON a.id = cs.address_id \
         LEFT JOIN LATERAL ( \
             SELECT COUNT(*)::int8 AS sample_count \
             FROM timeseries.telemetry t \
             WHERE t.vehicle_id = cs.vehicle_id \
               AND t.ts BETWEEN cs.started_at \
                            AND COALESCE(cs.ended_at, cs.started_at) \
         ) telem ON true \
         WHERE cs.vehicle_id=$1 AND cs.started_at>=$2 AND cs.started_at<=$3 \
         ORDER BY cs.started_at DESC LIMIT $4 OFFSET $5"
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .bind(limit)
    .bind(offset)
    .fetch_all(&state.pool)
    .await?;

    let total: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3"
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "data": rows,
        "items": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "page": (offset / limit) + 1,
        "per_page": limit
    })))
}

async fn get_session_response(
    state: &AppState,
    user_id: Uuid,
    vehicle_id: Uuid,
    id: Uuid,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_owned(&state.pool, user_id, vehicle_id).await?;

    let session = sqlx::query_as::<_, SessionRow>(
        "SELECT cs.id, cs.started_at, cs.ended_at, cs.location_lat, cs.location_lng, \
                COALESCE(g.name, a.display_name, CASE WHEN cs.is_home THEN 'Home' END) AS location_name, \
                cs.is_home, COALESCE(cs.charger_type, \
                    CASE \
                        WHEN lower(COALESCE(cs.network_vendor, '')) = ANY(ARRAY['tesla','rivian','electrify america','evgo']) THEN 'dc' \
                        WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, \
                            CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) < 12 THEN 'ac' \
                        WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, \
                            CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) < 50 THEN 'ac_l2' \
                        WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, \
                            CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) IS NOT NULL THEN 'dc' \
                    END \
                ) AS charger_type, \
                COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) AS kwh_added, cs.soc_start, cs.soc_end, \
                COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) AS max_charge_rate_kw, cs.duration_minutes, cs.cost_usd AS cost_usd, \
                cs.network_vendor, cs.range_added_km, cs.is_free_session, \
                cs.is_rivian_network, cs.rivian_paid_total, cs.source, \
                cs.rivian_charger_type, cs.currency_code, cs.rivian_city, cs.is_public, cs.charger_id, \
                cs.live_current_price, cs.live_current_currency, cs.live_total_charged_kwh, \
                cs.live_range_added_km, cs.live_power_kw, cs.live_charge_rate_kph, \
                COALESCE(telem.sample_count, 0)::int8 AS telemetry_sample_count \
         FROM riviamigo.charge_sessions cs \
         LEFT JOIN riviamigo.geofences g ON g.id = cs.geofence_id \
         LEFT JOIN riviamigo.addresses a ON a.id = cs.address_id \
         LEFT JOIN LATERAL ( \
             SELECT COUNT(*)::int8 AS sample_count \
             FROM timeseries.telemetry t \
             WHERE t.vehicle_id = cs.vehicle_id \
               AND t.ts BETWEEN cs.started_at \
                            AND COALESCE(cs.ended_at, cs.started_at) \
         ) telem ON true \
            WHERE cs.id=$1 AND cs.vehicle_id=$2"
    )
        .bind(id)
        .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let curve = load_curve(
        &state.pool,
        vehicle_id,
        session.id,
        session.started_at,
        session.ended_at,
        session.charger_type.as_deref(),
    )
    .await?;

    Ok(Json(serde_json::json!({
        "session": session,
        "curve": curve,
    })))
}

async fn get_session_curve_response(
    state: &AppState,
    user_id: Uuid,
    vehicle_id: Uuid,
    id: Uuid,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_owned(&state.pool, user_id, vehicle_id).await?;

    let session = sqlx::query_as::<_, SessionBoundsRow>(
        "SELECT id, started_at, ended_at, charger_type FROM riviamigo.charge_sessions WHERE id=$1 AND vehicle_id=$2",
    )
    .bind(id)
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(serde_json::json!(
        load_curve(
            &state.pool,
            vehicle_id,
            session.id,
            session.started_at,
            session.ended_at,
            session.charger_type.as_deref(),
        )
        .await?
    )))
}

async fn get_summary_response(
    state: &AppState,
    user_id: Uuid,
    vehicle_id: Uuid,
    p: SessionListParams,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_owned(&state.pool, user_id, vehicle_id).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(365));
    let to = p.to.unwrap_or_else(Utc::now);

    let agg = sqlx::query_as::<_, SummaryAggRow>(
        "WITH normalized AS (
            SELECT
                COALESCE(kwh_added, energy_added_wh / 1000.0) AS energy_kwh,
                is_home,
                charger_type,
                network_vendor,
                charge_limit,
                cost_usd,
                energy_used_wh,
                is_free_session,
                range_added_km,
                rivian_paid_total,
                COALESCE(max_charge_rate_kw, avg_charge_rate_kw,
                    CASE WHEN duration_minutes > 0 THEN COALESCE(kwh_added, energy_added_wh / 1000.0) / (duration_minutes::float8 / 60.0) END
                ) AS rate_kw
            FROM riviamigo.charge_sessions
            WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
        ),
        typed AS (
            SELECT *,
                COALESCE(charger_type, CASE
                    WHEN lower(COALESCE(network_vendor, '')) = ANY(ARRAY['tesla','rivian','electrify america','evgo']) THEN 'dc'
                    WHEN rate_kw < 12 THEN 'ac'
                    WHEN rate_kw < 50 THEN 'ac_l2'
                    WHEN rate_kw IS NOT NULL THEN 'dc'
                END) AS derived_type
            FROM normalized
        )
        SELECT COALESCE(SUM(energy_kwh),0) AS total_kwh,
            COUNT(*) AS session_count,
            COALESCE(SUM(CASE WHEN is_home THEN energy_kwh ELSE 0 END),0) AS home_kwh,
            COALESCE(SUM(CASE WHEN is_home = false THEN energy_kwh ELSE 0 END),0) AS away_kwh,
            COALESCE(SUM(CASE WHEN is_home IS NULL THEN energy_kwh ELSE 0 END),0) AS unknown_location_kwh,
            COALESCE(SUM(CASE WHEN derived_type='ac' THEN energy_kwh ELSE 0 END),0) AS ac_kwh,
            COALESCE(SUM(CASE WHEN derived_type='ac_l2' THEN energy_kwh ELSE 0 END),0) AS ac_l2_kwh,
            COALESCE(SUM(CASE WHEN derived_type='dc' THEN energy_kwh ELSE 0 END),0) AS dc_kwh,
            COUNT(derived_type) AS typed_session_count,
            MAX(charge_limit) AS max_charge_limit_pct,
            MAX(rate_kw) AS max_charge_rate_kw,
            SUM(GREATEST(energy_kwh, COALESCE(energy_used_wh / 1000.0, 0))) AS total_energy_used_kwh,
            SUM(cost_usd) AS total_cost_usd,
            COUNT(cost_usd) AS known_cost_session_count,
            COUNT(*) FILTER (WHERE cost_usd IS NULL) AS unknown_cost_session_count,
            COUNT(*) FILTER (WHERE is_free_session) AS free_session_count,
            SUM(range_added_km) AS total_range_added_km,
            SUM(rivian_paid_total) AS rivian_paid_total_usd
         FROM typed"
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .fetch_one(&state.pool)
    .await?;

    let capacity_sources = sqlx::query_as::<_, CapacitySourcesRow>(
        "SELECT
            (SELECT battery_capacity_wh
             FROM riviamigo.vehicles
             WHERE id=$1 AND battery_capacity_wh IS NOT NULL
             LIMIT 1) AS vehicle_capacity_wh,
            (SELECT battery_capacity_wh
             FROM timeseries.telemetry
             WHERE vehicle_id=$1 AND battery_capacity_wh IS NOT NULL
             ORDER BY ts DESC
             LIMIT 1) AS telemetry_latest_capacity_wh,
            (SELECT max(battery_capacity_wh)
             FROM timeseries.telemetry
             WHERE vehicle_id=$1 AND battery_capacity_wh IS NOT NULL) AS telemetry_max_capacity_wh",
    )
    .bind(vehicle_id)
    .fetch_one(&state.pool)
    .await?;
    let capacity_kwh = capacity_sources
        .vehicle_capacity_wh
        .and_then(normalize_capacity_kwh)
        .or_else(|| {
            capacity_sources
                .telemetry_latest_capacity_wh
                .and_then(normalize_capacity_kwh)
        })
        .or_else(|| {
            capacity_sources
                .telemetry_max_capacity_wh
                .and_then(normalize_capacity_kwh)
        });

    let weekly = sqlx::query_as::<_, WeeklySummaryRow>(
        "SELECT date_trunc('week', started_at) AS week_start,
            COALESCE(SUM(COALESCE(kwh_added, energy_added_wh / 1000.0)),0) AS kwh,
            SUM(cost_usd) AS cost_usd,
            COUNT(*) AS sessions
         FROM riviamigo.charge_sessions
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
         GROUP BY 1 ORDER BY 1",
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await?;

    let network_breakdown = sqlx::query_as::<_, NetworkBreakdownRow>(
        "SELECT
                CASE
                    WHEN is_home = true THEN 'Home Charging'
                    WHEN network_vendor IS NOT NULL THEN network_vendor
                    WHEN charger_type IN ('ac', 'ac_l2') THEN 'Other AC'
                    ELSE NULL
                END AS network_vendor,
                COUNT(*) AS session_count,
                SUM(COALESCE(kwh_added, energy_added_wh / 1000.0)) AS energy_kwh,
                SUM(cost_usd) AS cost_usd,
                COUNT(*) FILTER (WHERE is_free_session) AS free_sessions
         FROM riviamigo.charge_sessions
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
           AND (
               is_home = true
               OR network_vendor IS NOT NULL
               OR charger_type IN ('ac', 'ac_l2')
           )
         GROUP BY 1
         ORDER BY energy_kwh DESC NULLS LAST",
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let total_kwh = agg.total_kwh.unwrap_or(0.0);
    let total_energy_used_kwh = agg.total_energy_used_kwh.unwrap_or(0.0);
    let charging_cycles = capacity_kwh.and_then(|cap| {
        if cap > 0.0 {
            Some((total_kwh / cap).floor())
        } else {
            None
        }
    });
    if let (Some(cycles), Some(cap)) = (charging_cycles, capacity_kwh) {
        if cycles >= 500.0 {
            tracing::warn!(
                %vehicle_id,
                total_kwh,
                capacity_kwh = cap,
                charging_cycles = cycles,
                "charging summary cycles unusually high"
            );
        }
    }
    let charging_efficiency_pct = if total_energy_used_kwh > 0.0 {
        Some(total_kwh / total_energy_used_kwh * 100.0)
    } else {
        None
    };

    Ok(Json(serde_json::json!({
        "total_kwh":       total_kwh,
        "total_energy_kwh": total_kwh,
        "total_cost_usd":  if agg.session_count == 0 { Some(0.0) } else { agg.total_cost_usd },
        "session_count":   agg.session_count,
        "home_kwh":        agg.home_kwh,
        "away_kwh":        agg.away_kwh,
        "unknown_location_kwh": agg.unknown_location_kwh,
        "by_type": {
            "ac_kwh":   agg.ac_kwh,
            "ac_l2_kwh": agg.ac_l2_kwh,
            "dc_kwh":   agg.dc_kwh,
        },
        "charging_cycles": charging_cycles,
        "charging_efficiency_pct": charging_efficiency_pct,
        "total_energy_used_kwh": total_energy_used_kwh,
        "max_charge_limit_pct": agg.max_charge_limit_pct,
        "max_charge_rate_kw": agg.max_charge_rate_kw,
        "typed_session_count": agg.typed_session_count,
        "known_cost_session_count": agg.known_cost_session_count,
        "unknown_cost_session_count": agg.unknown_cost_session_count,
        "free_session_count": agg.free_session_count,
        "total_range_added_km": agg.total_range_added_km,
        "rivian_paid_total_usd": agg.rivian_paid_total_usd,
        "network_breakdown": network_breakdown.iter().map(|r| serde_json::json!({
            "network_vendor": r.network_vendor,
            "session_count":  r.session_count,
            "energy_kwh":     r.energy_kwh,
            "cost_usd":       r.cost_usd,
            "free_sessions":  r.free_sessions,
        })).collect::<Vec<_>>(),
        "weekly": weekly.iter().map(|r| serde_json::json!({
            "week_start": r.week_start,
            "kwh":        r.kwh,
            "energy_kwh": r.kwh,
            "cost_usd":   r.cost_usd,
            "sessions":   r.sessions,
        })).collect::<Vec<_>>(),
    })))
}

#[cfg(test)]
mod tests {
    use super::normalize_capacity_kwh;
    use axum::body::Body;
    use http::{Request, StatusCode};
    use tower::ServiceExt;

    #[test]
    fn normalizes_capacity_values_in_kwh_and_wh() {
        assert_eq!(normalize_capacity_kwh(135.0), Some(135.0));
        assert_eq!(normalize_capacity_kwh(135_000.0), Some(135.0));
    }

    #[test]
    fn rejects_unrealistic_capacity_values() {
        assert_eq!(normalize_capacity_kwh(0.13), None);
        assert_eq!(normalize_capacity_kwh(600.0), None);
        assert_eq!(normalize_capacity_kwh(-50.0), None);
    }

    // ── Integration tests (require DATABASE_URL) ──────────────────────────────
    // Run with: cargo test -- --ignored

    async fn make_app() -> axum::Router {
        use crate::middleware::auth::{AppState, JwtKeys};
        use rsa::{
            pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding},
            RsaPrivateKey,
        };
        use std::sync::Arc;

        let database_url =
            std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");
        let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into());

        let pool = crate::db::pool::create_pool(&database_url)
            .await
            .expect("create_pool");
        let redis = redis::Client::open(redis_url).expect("redis client");

        let mut rng = rand::thread_rng();
        let priv_key = RsaPrivateKey::new(&mut rng, 2048).expect("rsa key");
        let pub_key = priv_key.to_public_key();
        let private_pem = priv_key
            .to_pkcs8_pem(LineEnding::LF)
            .expect("pem")
            .to_string();
        let public_pem = pub_key.to_public_key_pem(LineEnding::LF).expect("pem");
        let jwt_keys = Arc::new(JwtKeys::new(&private_pem, &public_pem).expect("jwt keys"));

        let config = crate::config::Config {
            database_url: database_url.clone(),
            redis_url: "redis://127.0.0.1/".into(),
            jwt_secret: None,
            jwt_public_key: None,
            age_encryption_key: None,
            port: 3001,
            allowed_origins: vec!["http://localhost:3000".into()],
            s3_endpoint: None,
            s3_access_key: None,
            s3_secret_key: None,
            backup_artifact_dir: std::env::temp_dir()
                .join("riviamigo-route-test-backups")
                .to_string_lossy()
                .into_owned(),
            backup_driver: "json".into(),
            backup_poll_interval_seconds: 60,
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: true,
            rivian_suppress_duplicate_telemetry: true,
            riviamigo_env: None,
            cookie_insecure: None,
        };

        let state = AppState {
            pool,
            redis,
            jwt_keys,
            age_key: "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
                .to_string(),
            config,
            nominatim_next_call: std::sync::Arc::new(tokio::sync::Mutex::new(
                std::time::Instant::now(),
            )),
            nominatim_cache: std::sync::Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
        };

        crate::routes::build_router(state)
    }

    async fn get_unauthenticated(app: axum::Router, uri: &str) -> http::StatusCode {
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        app.oneshot(req).await.unwrap().status()
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn list_sessions_requires_auth() {
        let app = make_app().await;
        let status = get_unauthenticated(app, "/v1/charging/sessions").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn session_detail_requires_auth() {
        let app = make_app().await;
        let status = get_unauthenticated(
            app,
            &format!("/v1/charging/sessions/{}", uuid::Uuid::new_v4()),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn charging_summary_requires_auth() {
        let app = make_app().await;
        let status = get_unauthenticated(app, "/v1/charging/summary").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn session_detail_invalid_uuid() {
        // Without auth header, 401 takes precedence over UUID parse error.
        // This documents the auth-first ordering in the middleware stack.
        let app = make_app().await;
        let status = get_unauthenticated(app, "/v1/charging/sessions/not-a-uuid").await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}

async fn load_curve(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    session_id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    charger_type: Option<&str>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let Some(ended_at) = ended_at else {
        return Ok(vec![]);
    };

    // Context-aware cap: DC fast chargers can peak ~220 kW on a Rivian so we
    // allow up to 300 kW.  AC sessions (L1 or L2) are hard-limited by circuit
    // amperage — even a 80A/240V L2 circuit tops out around 19 kW.  We cap at
    // 22 kW to give a comfortable margin without letting SOC-gap spikes (from
    // offline periods) corrupt the curve.  Unknown/null types get the AC cap as
    // a conservative default; misclassifying a DC session as AC is unlikely
    // since the charge_detector's AC-spike filter already screens those.
    let is_dc = charger_type == Some("dc");

    let rows = sqlx::query_as::<_, CurveRow>(
        r#"WITH samples AS (
               SELECT bucket,
                      avg_soc,
                      max(battery_capacity_wh) OVER () AS cap_wh
               FROM timeseries.telemetry_1min
               WHERE vehicle_id=$1 AND bucket>=$2 AND bucket<=$3
           )
           SELECT EXTRACT(EPOCH FROM (bucket - $2))::float8 / 60.0 AS minutes_elapsed,
                  -- Context-aware cap: DC sessions allow up to 300 kW; AC/unknown
                  -- sessions cap at 22 kW to eliminate SOC-gap spikes from offline
                  -- periods that make home charging appear to run at 200-300 kW.
                  LEAST(CASE WHEN $4 THEN 300.0 ELSE 22.0 END, GREATEST(0.0,
                    60.0 * (avg_soc - LAG(avg_soc) OVER (ORDER BY bucket)) / 100.0
                         * cap_wh / 1000.0
                  )) AS charge_rate_kw,
                  avg_soc AS soc
           FROM samples
           WHERE avg_soc IS NOT NULL
            ORDER BY bucket"#,
    )
    .bind(vehicle_id)
    .bind(started_at)
    .bind(ended_at)
    .bind(is_dc)
    .fetch_all(pool)
    .await?;

    if rows.len() < 2 {
        // Fallback: use Rivian live-session history points stored during active
        // polling.  Filter strictly by charge_session_id — querying by time
        // window would pull in DC fast-charge data from other sessions that
        // happen to overlap this session's timestamps, producing wildly
        // inflated power readings on home AC sessions.  Apply the same
        // context-aware cap as the primary path.
        let fallback = sqlx::query_as::<_, CurveRow>(
            r#"SELECT EXTRACT(EPOCH FROM (ts - $2))::float8 / 60.0 AS minutes_elapsed,
                      LEAST(CASE WHEN $4 THEN 300.0 ELSE 22.0 END,
                            GREATEST(0.0, power_kw)) AS charge_rate_kw,
                      NULL::float8 AS soc
               FROM riviamigo.rivian_charge_curve_points
               WHERE charge_session_id = $3
                 AND power_kw IS NOT NULL
                 AND power_kw > 0
               ORDER BY ts"#,
        )
        .bind(vehicle_id)
        .bind(started_at)
        .bind(session_id)
        .bind(is_dc)
        .fetch_all(pool)
        .await?;
        if !fallback.is_empty() {
            return Ok(fallback
                .iter()
                .map(|r| {
                    serde_json::json!({
                        "minutes_elapsed": r.minutes_elapsed,
                        "charge_rate_kw": r.charge_rate_kw,
                        "soc": r.soc,
                    })
                })
                .collect());
        }
    }

    Ok(rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "minutes_elapsed": r.minutes_elapsed,
                "charge_rate_kw": r.charge_rate_kw,
                "soc": r.soc,
            })
        })
        .collect())
}
