use axum::{
    extract::{Path, Query, State},
    routing::{get, patch},
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use futures::future::try_join_all;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_owned,
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    services::cost::recompute_charge_session_cost,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/charging", get(list_sessions))
        .route("/charging/chart-series", get(get_chart_series))
        .route("/charging/summary", get(get_summary))
        .route("/charging/sessions", get(list_sessions))
        .route("/charging/sessions/:id/curve", get(get_session_curve))
        .route("/charging/sessions/:id", get(get_session))
        .route("/charging/:id/curve", get(get_session_curve))
        .route("/charging/:id", get(get_session))
        .route("/charging/:id", patch(update_session_location))
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
        .route(
            "/vehicles/:vehicle_id/charging-sessions/:id",
            patch(update_session_location_path),
        )
        .route("/vehicles/:vehicle_id/costs", get(get_summary_path))
}

#[derive(Deserialize)]
struct SessionListParams {
    vehicle_id: Option<Uuid>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    lifetime: Option<bool>,
    limit: Option<i64>,
    offset: Option<i64>,
    page: Option<i64>,
    per_page: Option<i64>,
    session_day_local: Option<String>,
}

#[derive(Deserialize)]
struct VehicleParam {
    vehicle_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct SessionLocationUpdate {
    place_id: Option<Uuid>,
}

#[derive(Debug, sqlx::FromRow)]
struct PlaceLookupRow {
    address_id: Option<Uuid>,
    is_home: bool,
    latitude: Option<f64>,
    longitude: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct SessionRow {
    id: Uuid,
    started_at: DateTime<Utc>,
    #[sqlx(default)]
    session_day_local: Option<String>,
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

#[allow(dead_code)]
#[derive(Debug, sqlx::FromRow)]
struct SessionBoundsRow {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    charger_type: Option<String>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
}

#[cfg(test)]
mod timeframe_tests {
    use chrono::{TimeZone, Utc};

    #[test]
    fn lifetime_time_bounds_use_epoch_instead_of_default_window() {
        let to = Utc.with_ymd_and_hms(2026, 7, 2, 12, 0, 0).unwrap();
        let (from, resolved_to) = super::resolve_time_bounds(None, Some(to), true, 365);

        assert_eq!(resolved_to, to);
        assert_eq!(from, chrono::DateTime::<Utc>::from_timestamp(0, 0).unwrap());
    }
}

fn resolve_time_bounds(
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    lifetime: bool,
    default_days: i64,
) -> (DateTime<Utc>, DateTime<Utc>) {
    let resolved_to = to.unwrap_or_else(Utc::now);
    let resolved_from = if lifetime {
        DateTime::<Utc>::from_timestamp(0, 0).unwrap_or(resolved_to - chrono::Duration::days(3650))
    } else {
        from.unwrap_or_else(|| Utc::now() - chrono::Duration::days(default_days))
    };
    (resolved_from, resolved_to)
}

fn build_fallback_curve_samples(
    session_id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    charger_type: Option<&str>,
    soc_start: f64,
    soc_end: f64,
    points: &[RawCurvePointRow],
    cap_kw: f64,
) -> Vec<CurveSampleRow> {
    if points.is_empty() {
        return vec![];
    }

    let span_minutes = (ended_at - started_at).num_seconds().max(1) as f64 / 60.0;
    let point_span_seconds = points
        .first()
        .zip(points.last())
        .map(|(first, last)| (last.ts - first.ts).num_seconds().max(1) as f64)
        .unwrap_or(1.0);
    let first_ts = points.first().map(|point| point.ts).unwrap_or(started_at);

    points
        .iter()
        .map(|row| {
            let elapsed_minutes = (row.ts - started_at).num_seconds() as f64 / 60.0;
            let soc = if points.len() == 1 {
                Some((soc_start + soc_end) / 2.0)
            } else {
                let ratio = ((row.ts - first_ts).num_seconds() as f64 / point_span_seconds)
                    .clamp(0.0, 1.0);
                Some(soc_start + (soc_end - soc_start) * ratio)
            };

            CurveSampleRow {
                session_id,
                minutes_elapsed: elapsed_minutes.clamp(0.0, span_minutes),
                charge_rate_kw: row.power_kw.unwrap_or(0.0).clamp(0.0, cap_kw),
                soc,
                sample_source: "rivian_charge_curve_points",
                charger_type: charger_type.map(ToOwned::to_owned),
            }
        })
        .collect()
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
struct CurveAnalysisSessionRow {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    charger_type: Option<String>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
struct CurveSampleRow {
    session_id: Uuid,
    minutes_elapsed: f64,
    charge_rate_kw: f64,
    soc: Option<f64>,
    sample_source: &'static str,
    charger_type: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct RawCurvePointRow {
    ts: DateTime<Utc>,
    power_kw: Option<f64>,
}

#[allow(dead_code)]
#[derive(Debug, sqlx::FromRow)]
struct CurveAnalysisValueRow {
    ts: DateTime<Utc>,
    minutes_elapsed: f64,
    charge_rate_kw: Option<f64>,
    soc: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct CapacitySourcesRow {
    vehicle_capacity_wh: Option<f64>,
    telemetry_latest_capacity_wh: Option<f64>,
    telemetry_max_capacity_wh: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct ChartSeriesSessionSourceRow {
    session_id: Uuid,
    started_at: DateTime<Utc>,
    #[sqlx(default)]
    session_day_local: Option<String>,
    energy_kwh: Option<f64>,
    location_name: Option<String>,
    charger_type: Option<String>,
    network_vendor: Option<String>,
    peak_power_kw: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
struct ChargeChartSeriesSession {
    session_id: Uuid,
    day_local: String,
    day_start: DateTime<Utc>,
    started_at: DateTime<Utc>,
    energy_added_kwh: Option<f64>,
    charger_type: Option<String>,
    location_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
struct ChargeChartSeriesDay {
    day_local: String,
    day_start: DateTime<Utc>,
    total_energy_kwh: f64,
    session_count: i64,
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

async fn update_session_location(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
    Json(payload): Json<SessionLocationUpdate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vehicle_id = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    update_charge_session_location(&state.pool, auth.user_id, vehicle_id, id, payload.place_id).await?;
    get_session_response(&state, auth.user_id, vehicle_id, id).await
}

async fn update_session_location_path(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<SessionLocationUpdate>,
) -> Result<Json<serde_json::Value>, AppError> {
    update_charge_session_location(&state.pool, auth.user_id, vehicle_id, id, payload.place_id).await?;
    get_session_response(&state, auth.user_id, vehicle_id, id).await
}

async fn update_charge_session_location(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    vehicle_id: Uuid,
    session_id: Uuid,
    place_id: Option<Uuid>,
) -> Result<(), AppError> {
    require_vehicle_owned(pool, user_id, vehicle_id).await?;

    let updated_session_id = if let Some(place_id) = place_id {
        let place = sqlx::query_as::<_, PlaceLookupRow>(
            "SELECT address_id, is_home, latitude, longitude
               FROM riviamigo.geofences
              WHERE id=$1 AND user_id=$2",
        )
        .bind(place_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;

        sqlx::query_scalar::<_, Uuid>(
            "UPDATE riviamigo.charge_sessions
               SET geofence_id=$1,
                   address_id=$2,
                   is_home=$3,
                   location_lat=$4,
                   location_lng=$5
             WHERE id=$6 AND vehicle_id=$7
             RETURNING id",
        )
        .bind(place_id)
        .bind(place.address_id)
        .bind(place.is_home)
        .bind(place.latitude)
        .bind(place.longitude)
        .bind(session_id)
        .bind(vehicle_id)
        .fetch_optional(pool)
        .await?
    } else {
        sqlx::query_scalar::<_, Uuid>(
            "UPDATE riviamigo.charge_sessions
               SET geofence_id=NULL,
                   address_id=NULL,
                   is_home=NULL,
                   location_lat=NULL,
                   location_lng=NULL
             WHERE id=$1 AND vehicle_id=$2
             RETURNING id",
        )
        .bind(session_id)
        .bind(vehicle_id)
        .fetch_optional(pool)
        .await?
    };

    match updated_session_id {
        Some(_) => {
            let recomputed = recompute_charge_session_cost(pool, session_id).await?;
            if recomputed.is_none() {
                return Err(AppError::NotFound);
            }
            Ok(())
        },
        None => Err(AppError::NotFound),
    }
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

async fn get_chart_series(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<SessionListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vehicle_id = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    get_chart_series_response(&state, auth.user_id, vehicle_id, p).await
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
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 365);

    let sessions = sqlx::query_as::<_, CurveAnalysisSessionRow>(
        r#"SELECT
               cs.id,
               cs.started_at,
               cs.ended_at,
               COALESCE(cs.charger_type,
                 CASE
                   WHEN lower(COALESCE(cs.network_vendor, '')) = ANY(ARRAY['tesla','rivian','electrify america','evgo']) THEN 'dc'
                   WHEN COALESCE(
                       cs.max_charge_rate_kw,
                       cs.avg_charge_rate_kw,
                       CASE
                           WHEN cs.duration_minutes > 0
                           THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0)
                       END
                   ) < 20 THEN 'ac'
                   WHEN COALESCE(
                       cs.max_charge_rate_kw,
                       cs.avg_charge_rate_kw,
                       CASE
                           WHEN cs.duration_minutes > 0
                           THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0)
                       END
                   ) < 50 THEN 'ac_l2'
                   WHEN COALESCE(
                       cs.max_charge_rate_kw,
                       cs.avg_charge_rate_kw,
                       CASE
                           WHEN cs.duration_minutes > 0
                           THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0)
                       END
                   ) IS NOT NULL THEN 'dc'
                 END
               ) AS charger_type,
               cs.soc_start,
               cs.soc_end
           FROM riviamigo.charge_sessions cs
           WHERE cs.vehicle_id=$1
             AND cs.started_at >= $2
             AND cs.started_at <= $3
             AND cs.ended_at IS NOT NULL
           ORDER BY cs.started_at ASC, cs.id ASC"#
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await?;

    let curve_rows = try_join_all(
        sessions
            .into_iter()
            .filter(|session| session.charger_type.as_deref() == Some("dc"))
            .map(|session| {
                let charger_type = session.charger_type.clone();
                load_curve_analysis_samples(
                    &state.pool,
                    vehicle_id,
                    session.id,
                    session.started_at,
                    session.ended_at,
                    charger_type,
                    session.soc_start,
                    session.soc_end,
                )
            }),
    )
    .await?
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();

    Ok(Json(serde_json::json!(
        curve_rows
            .iter()
            .map(|row| serde_json::json!({
                "session_id": row.session_id,
                "minutes_elapsed": row.minutes_elapsed,
                "soc_pct": row.soc,
                "charge_rate_kw": row.charge_rate_kw,
                "sample_source": row.sample_source,
                "charger_type": row.charger_type,
            }))
            .collect::<Vec<_>>()
    )))
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

    let mut tx = state.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;

    let rows = sqlx::query_as::<_, SessionRow>(
        "SELECT cs.id, cs.started_at, \
            TO_CHAR(((cs.started_at AT TIME ZONE COALESCE(up.home_timezone, 'UTC')) - INTERVAL '12 hours')::date, 'YYYY-MM-DD') AS session_day_local, \
            cs.ended_at, cs.location_lat, cs.location_lng, \
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
                0::int8 AS telemetry_sample_count \
         FROM riviamigo.charge_sessions cs \
         LEFT JOIN riviamigo.geofences g ON g.id = cs.geofence_id \
         LEFT JOIN riviamigo.addresses a ON a.id = cs.address_id \
            LEFT JOIN riviamigo.user_preferences up ON up.user_id = $6 \
            WHERE cs.vehicle_id=$1 AND cs.started_at>=$2 AND cs.started_at<=$3 \
              AND ($7 IS NULL OR TO_CHAR(((cs.started_at AT TIME ZONE COALESCE(up.home_timezone, 'UTC')) - INTERVAL '12 hours')::date, 'YYYY-MM-DD') = $7) \
            ORDER BY cs.started_at DESC, cs.id DESC LIMIT $4 OFFSET $5"
    )
        .bind(vehicle_id)
        .bind(from)
        .bind(to)
        .bind(limit)
        .bind(offset)
        .bind(user_id)
        .bind(p.session_day_local.clone())
        .fetch_all(&mut *tx)
        .await?;

    let total: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM riviamigo.charge_sessions cs \
         LEFT JOIN riviamigo.user_preferences up ON up.user_id = $4 \
         WHERE cs.vehicle_id=$1 AND cs.started_at>=$2 AND cs.started_at<=$3 \
           AND ($5 IS NULL OR TO_CHAR(((cs.started_at AT TIME ZONE COALESCE(up.home_timezone, 'UTC')) - INTERVAL '12 hours')::date, 'YYYY-MM-DD') = $5)"
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .bind(user_id)
    .bind(p.session_day_local)
    .fetch_one(&mut *tx)
    .await?;

    tx.rollback().await?;

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

async fn get_chart_series_response(
    state: &AppState,
    user_id: Uuid,
    vehicle_id: Uuid,
    p: SessionListParams,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_owned(&state.pool, user_id, vehicle_id).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 90);

    let rows = sqlx::query_as::<_, ChartSeriesSessionSourceRow>(
        "SELECT
            cs.id AS session_id,
            cs.started_at,
            TO_CHAR(((cs.started_at AT TIME ZONE COALESCE(up.home_timezone, 'UTC')) - INTERVAL '12 hours')::date, 'YYYY-MM-DD') AS session_day_local,
            COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) AS energy_kwh,
            COALESCE(g.name, a.display_name, CASE WHEN cs.is_home THEN 'Home' END) AS location_name,
            cs.charger_type,
            cs.network_vendor,
            COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw,
                CASE
                    WHEN cs.duration_minutes > 0
                    THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0)
                END
            ) AS peak_power_kw
         FROM riviamigo.charge_sessions cs
         LEFT JOIN riviamigo.geofences g ON g.id = cs.geofence_id
         LEFT JOIN riviamigo.addresses a ON a.id = cs.address_id
         LEFT JOIN riviamigo.user_preferences up ON up.user_id = $4
         WHERE cs.vehicle_id=$1 AND cs.started_at>=$2 AND cs.started_at<=$3
         ORDER BY cs.started_at ASC, cs.id ASC",
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .bind(user_id)
    .fetch_all(&state.pool)
    .await?;

    let (daily, daily_sessions) = build_charge_chart_series(rows);

    Ok(Json(serde_json::json!({
        "daily": daily.iter().map(|day| serde_json::json!({
            "day_local": day.day_local,
            "day_start": day.day_start,
            "total_energy_kwh": day.total_energy_kwh,
            "session_count": day.session_count,
        })).collect::<Vec<_>>(),
        "daily_sessions": daily_sessions.iter().map(|session| serde_json::json!({
            "session_id": session.session_id,
            "day_local": session.day_local,
            "day_start": session.day_start,
            "started_at": session.started_at,
            "energy_added_kwh": session.energy_added_kwh,
            "charger_type": session.charger_type,
            "location_name": session.location_name,
        })).collect::<Vec<_>>(),
    })))
}

fn build_charge_chart_series(
    rows: Vec<ChartSeriesSessionSourceRow>,
) -> (Vec<ChargeChartSeriesDay>, Vec<ChargeChartSeriesSession>) {
    let mut sessions = rows
        .into_iter()
        .map(|row| {
            let day_local = row
                .session_day_local
                .unwrap_or_else(|| row.started_at.format("%Y-%m-%d").to_string());
            ChargeChartSeriesSession {
                session_id: row.session_id,
                day_start: day_start_from_label(&day_local),
                day_local,
                started_at: row.started_at,
                energy_added_kwh: row.energy_kwh,
                charger_type: normalize_chart_charger_type(
                    row.charger_type.as_deref(),
                    row.network_vendor.as_deref(),
                    row.peak_power_kw,
                ),
                location_name: row.location_name,
            }
        })
        .collect::<Vec<_>>();

    sessions.sort_by(|left, right| {
        left.day_local
            .cmp(&right.day_local)
            .then(left.started_at.cmp(&right.started_at))
            .then(left.session_id.cmp(&right.session_id))
    });

    let mut daily = Vec::<ChargeChartSeriesDay>::new();
    for session in &sessions {
        let energy = session.energy_added_kwh.unwrap_or(0.0).max(0.0);
        if let Some(current) = daily.last_mut() {
            if current.day_local == session.day_local {
                current.total_energy_kwh += energy;
                current.session_count += 1;
                continue;
            }
        }

        daily.push(ChargeChartSeriesDay {
            day_local: session.day_local.clone(),
            day_start: session.day_start,
            total_energy_kwh: energy,
            session_count: 1,
        });
    }

    (daily, sessions)
}

fn day_start_from_label(day_local: &str) -> DateTime<Utc> {
    NaiveDate::parse_from_str(day_local, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map(|date_time| DateTime::<Utc>::from_naive_utc_and_offset(date_time, Utc))
        .unwrap_or_else(Utc::now)
}

fn normalize_chart_charger_type(
    charger_type: Option<&str>,
    network_vendor: Option<&str>,
    peak_power_kw: Option<f64>,
) -> Option<String> {
    let explicit = charger_type.map(|value| value.trim().to_ascii_lowercase());
    match explicit.as_deref() {
        Some("dc") | Some("dcfc") => return Some("DC".to_string()),
        Some("ac") | Some("ac_l2") => return Some("AC".to_string()),
        _ => {}
    }

    let vendor = network_vendor.unwrap_or_default().trim().to_ascii_lowercase();
    if ["tesla", "rivian", "electrify america", "evgo"].contains(&vendor.as_str()) {
        return Some("DC".to_string());
    }

    peak_power_kw.and_then(|value| {
        if !value.is_finite() {
            None
        } else if value < 20.0 {
            Some("AC".to_string())
        } else {
            Some("DC".to_string())
        }
    })
}

async fn get_session_response(
    state: &AppState,
    user_id: Uuid,
    vehicle_id: Uuid,
    id: Uuid,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_owned(&state.pool, user_id, vehicle_id).await?;

    let session = sqlx::query_as::<_, SessionRow>(
        "SELECT cs.id, cs.started_at, \
            TO_CHAR(((cs.started_at AT TIME ZONE COALESCE(up.home_timezone, 'UTC')) - INTERVAL '12 hours')::date, 'YYYY-MM-DD') AS session_day_local, \
            cs.ended_at, cs.location_lat, cs.location_lng, \
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
         LEFT JOIN riviamigo.user_preferences up ON up.user_id = $3 \
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
        .bind(user_id)
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
        "SELECT id, started_at, ended_at, charger_type, soc_start, soc_end FROM riviamigo.charge_sessions WHERE id=$1 AND vehicle_id=$2",
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
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 365);

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
    use super::{build_charge_chart_series, normalize_capacity_kwh, ChartSeriesSessionSourceRow};
    use axum::body::Body;
    use chrono::{TimeZone, Utc};
    use http::{Request, StatusCode};
    use tower::ServiceExt;
    use uuid::Uuid;

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
            vehicle_image_cache_dir: std::env::temp_dir()
                .join("riviamigo-route-test-image-cache")
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
            rate_limit: crate::config::RateLimitConfig::default(),
        };

        let state = AppState {
            pool,
            redis,
            jwt_keys,
            age_key: "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ"
                .to_string(),
            config,
            nominatim_cache: std::sync::Arc::new(tokio::sync::RwLock::new(
                std::collections::HashMap::new(),
            )),
            supervisor: crate::ingestion::supervisor::SupervisorHandle::noop(),
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
    async fn charging_chart_series_requires_auth() {
        let app = make_app().await;
        let status = get_unauthenticated(app, "/v1/charging/chart-series").await;
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

    #[test]
    fn chart_series_rolls_up_multiple_sessions_under_one_local_day() {
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let (daily, sessions) = build_charge_chart_series(vec![
            ChartSeriesSessionSourceRow {
                session_id: first,
                started_at: Utc.with_ymd_and_hms(2026, 6, 20, 18, 0, 0).unwrap(),
                session_day_local: Some("2026-06-20".into()),
                energy_kwh: Some(18.5),
                location_name: Some("Home".into()),
                charger_type: Some("ac".into()),
                network_vendor: None,
                peak_power_kw: Some(11.2),
            },
            ChartSeriesSessionSourceRow {
                session_id: second,
                started_at: Utc.with_ymd_and_hms(2026, 6, 20, 22, 30, 0).unwrap(),
                session_day_local: Some("2026-06-20".into()),
                energy_kwh: Some(24.0),
                location_name: Some("Office".into()),
                charger_type: Some("dc".into()),
                network_vendor: None,
                peak_power_kw: Some(105.0),
            },
        ]);

        assert_eq!(daily.len(), 1);
        assert_eq!(daily[0].day_local, "2026-06-20");
        assert!((daily[0].total_energy_kwh - 42.5).abs() < f64::EPSILON);
        assert_eq!(daily[0].session_count, 2);
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].session_id, first);
        assert_eq!(sessions[1].session_id, second);
    }

    #[test]
    fn chart_series_uses_local_charge_day_for_day_boundaries() {
        let session = Uuid::new_v4();
        let (daily, sessions) = build_charge_chart_series(vec![ChartSeriesSessionSourceRow {
            session_id: session,
            started_at: Utc.with_ymd_and_hms(2026, 6, 21, 6, 0, 0).unwrap(),
            session_day_local: Some("2026-06-20".into()),
            energy_kwh: Some(12.0),
            location_name: Some("Road Trip".into()),
            charger_type: None,
            network_vendor: Some("tesla".into()),
            peak_power_kw: Some(148.0),
        }]);

        assert_eq!(daily[0].day_local, "2026-06-20");
        assert_eq!(sessions[0].day_local, "2026-06-20");
        assert_eq!(sessions[0].charger_type.as_deref(), Some("DC"));
    }

    #[test]
    fn chart_series_includes_more_than_two_hundred_sessions_without_pagination() {
        let rows = (0..205)
            .map(|index| ChartSeriesSessionSourceRow {
                session_id: Uuid::new_v4(),
                started_at: Utc.with_ymd_and_hms(2026, 6, 1 + (index / 10) as u32, (index % 24) as u32, 0, 0).unwrap(),
                session_day_local: Some(format!("2026-06-{:02}", 1 + (index / 10))),
                energy_kwh: Some(1.0),
                location_name: None,
                charger_type: Some("ac".into()),
                network_vendor: None,
                peak_power_kw: Some(9.6),
            })
            .collect::<Vec<_>>();

        let (daily, sessions) = build_charge_chart_series(rows);

        assert_eq!(sessions.len(), 205);
        assert_eq!(daily.iter().map(|day| day.session_count).sum::<i64>(), 205);
    }

    #[test]
    fn fallback_curve_samples_fill_soc_using_session_bounds() {
        let session_id = Uuid::new_v4();
        let started_at = Utc.with_ymd_and_hms(2026, 6, 1, 8, 0, 0).unwrap();
        let ended_at = Utc.with_ymd_and_hms(2026, 6, 1, 8, 20, 0).unwrap();
        let points = vec![
            super::RawCurvePointRow {
                ts: Utc.with_ymd_and_hms(2026, 6, 1, 8, 2, 0).unwrap(),
                power_kw: Some(160.0),
            },
            super::RawCurvePointRow {
                ts: Utc.with_ymd_and_hms(2026, 6, 1, 8, 10, 0).unwrap(),
                power_kw: Some(120.0),
            },
        ];

        let rows = super::build_fallback_curve_samples(
            session_id,
            started_at,
            ended_at,
            Some("dc"),
            18.0,
            76.0,
            &points,
            300.0,
        );

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].session_id, session_id);
        assert_eq!(rows[0].sample_source, "rivian_charge_curve_points");
        assert!((rows[0].soc.unwrap_or_default() - 18.0).abs() < 0.01);
        assert!((rows[1].soc.unwrap_or_default() - 76.0).abs() < 0.01);
        assert!(rows.iter().all(|row| row.charge_rate_kw > 0.0));
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

    let linked_sample_count = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*)::int8
           FROM timeseries.telemetry
           WHERE vehicle_id=$1
             AND charge_session_id=$2
             AND ts >= $3
             AND ts <= $4"#,
    )
    .bind(vehicle_id)
    .bind(session_id)
    .bind(started_at)
    .bind(ended_at)
    .fetch_one(pool)
    .await?;

    let rows = if linked_sample_count >= 2 {
        sqlx::query_as::<_, CurveRow>(
            r#"WITH cap AS (
                   SELECT COALESCE(
                       (SELECT battery_capacity_wh
                        FROM riviamigo.vehicles
                        WHERE id=$1
                          AND battery_capacity_wh IS NOT NULL
                        LIMIT 1),
                       (SELECT max(battery_capacity_wh)
                        FROM timeseries.telemetry
                        WHERE vehicle_id=$1
                          AND battery_capacity_wh IS NOT NULL)
                   ) AS default_cap_wh
               ),
               samples AS (
                   SELECT time_bucket('1 minute', t.ts) AS bucket,
                          avg(t.battery_level) AS avg_soc,
                          avg(ABS(t.power_kw)) FILTER (WHERE t.power_kw IS NOT NULL) AS avg_power_kw,
                          max(t.battery_capacity_wh) AS bucket_cap_wh
                   FROM timeseries.telemetry t
                   WHERE t.vehicle_id=$1
                     AND t.charge_session_id=$2
                     AND t.ts >= $3
                     AND t.ts <= $4
                   GROUP BY 1
               )
               SELECT EXTRACT(EPOCH FROM (bucket - $3))::float8 / 60.0 AS minutes_elapsed,
                      LEAST(
                          CASE WHEN $5 THEN 300.0 ELSE 22.0 END,
                          GREATEST(
                              0.0,
                              COALESCE(
                                  avg_power_kw,
                                  60.0 * (avg_soc - LAG(avg_soc) OVER (ORDER BY bucket)) / 100.0
                                      * COALESCE(bucket_cap_wh, cap.default_cap_wh) / 1000.0
                              )
                          )
                      ) AS charge_rate_kw,
                      avg_soc AS soc
               FROM samples
               CROSS JOIN cap
               WHERE avg_soc IS NOT NULL
               ORDER BY bucket"#,
        )
        .bind(vehicle_id)
        .bind(session_id)
        .bind(started_at)
        .bind(ended_at)
        .bind(is_dc)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, CurveRow>(
            r#"WITH cap AS (
                   SELECT COALESCE(
                       (SELECT battery_capacity_wh
                        FROM riviamigo.vehicles
                        WHERE id=$1
                          AND battery_capacity_wh IS NOT NULL
                        LIMIT 1),
                       (SELECT max(battery_capacity_wh)
                        FROM timeseries.telemetry
                        WHERE vehicle_id=$1
                          AND battery_capacity_wh IS NOT NULL)
                   ) AS default_cap_wh
               ),
               samples AS (
                   SELECT bucket,
                          avg_soc,
                          avg_power_kw,
                          battery_capacity_wh
                   FROM timeseries.telemetry_1min
                   WHERE vehicle_id=$1
                     AND bucket >= $2
                     AND bucket <= $3
               )
               SELECT EXTRACT(EPOCH FROM (bucket - $2))::float8 / 60.0 AS minutes_elapsed,
                      LEAST(
                          CASE WHEN $4 THEN 300.0 ELSE 22.0 END,
                          GREATEST(
                              0.0,
                              COALESCE(
                                  ABS(avg_power_kw),
                                  60.0 * (avg_soc - LAG(avg_soc) OVER (ORDER BY bucket)) / 100.0
                                      * COALESCE(battery_capacity_wh, cap.default_cap_wh) / 1000.0
                              )
                          )
                      ) AS charge_rate_kw,
                      avg_soc AS soc
               FROM samples
               CROSS JOIN cap
               WHERE avg_soc IS NOT NULL
               ORDER BY bucket"#,
        )
        .bind(vehicle_id)
        .bind(started_at)
        .bind(ended_at)
        .bind(is_dc)
        .fetch_all(pool)
        .await?
    };

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

async fn load_curve_analysis_samples(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    session_id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    charger_type: Option<String>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
) -> Result<Vec<CurveSampleRow>, AppError> {
    let Some(ended_at) = ended_at else {
        return Ok(vec![]);
    };

    let is_dc = charger_type.as_deref() == Some("dc");
    let cap_kw = if is_dc { 300.0 } else { 22.0 };

    let linked_sample_count = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*)::int8
           FROM timeseries.telemetry
           WHERE vehicle_id=$1
             AND charge_session_id=$2
             AND ts >= $3
             AND ts <= $4"#,
    )
    .bind(vehicle_id)
    .bind(session_id)
    .bind(started_at)
    .bind(ended_at)
    .fetch_one(pool)
    .await?;

    let primary_rows = if linked_sample_count >= 2 {
        sqlx::query_as::<_, CurveAnalysisValueRow>(
            r#"WITH cap AS (
                   SELECT COALESCE(
                       (SELECT battery_capacity_wh
                        FROM riviamigo.vehicles
                        WHERE id=$1
                          AND battery_capacity_wh IS NOT NULL
                        LIMIT 1),
                       (SELECT max(battery_capacity_wh)
                        FROM timeseries.telemetry
                        WHERE vehicle_id=$1
                          AND battery_capacity_wh IS NOT NULL)
                   ) AS default_cap_wh
               ),
               samples AS (
                   SELECT time_bucket('1 minute', t.ts) AS bucket,
                          avg(t.battery_level) AS avg_soc,
                          avg(ABS(t.power_kw)) FILTER (WHERE t.power_kw IS NOT NULL) AS avg_power_kw,
                          max(t.battery_capacity_wh) AS bucket_cap_wh
                   FROM timeseries.telemetry t
                   WHERE t.vehicle_id=$1
                     AND t.charge_session_id=$2
                     AND t.ts >= $3
                     AND t.ts <= $4
                   GROUP BY 1
               )
               SELECT bucket AS ts,
                      EXTRACT(EPOCH FROM (bucket - $3))::float8 / 60.0 AS minutes_elapsed,
                      LEAST(
                          CASE WHEN $5 THEN 300.0 ELSE 22.0 END,
                          GREATEST(
                              0.0,
                              COALESCE(
                                  avg_power_kw,
                                  60.0 * (avg_soc - LAG(avg_soc) OVER (ORDER BY bucket)) / 100.0
                                      * COALESCE(bucket_cap_wh, cap.default_cap_wh) / 1000.0
                              )
                          )
                      ) AS charge_rate_kw,
                      avg_soc AS soc
               FROM samples
               CROSS JOIN cap
               WHERE avg_soc IS NOT NULL
               ORDER BY bucket"#,
        )
        .bind(vehicle_id)
        .bind(session_id)
        .bind(started_at)
        .bind(ended_at)
        .bind(is_dc)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };

    if primary_rows.len() >= 2 {
        return Ok(primary_rows
            .into_iter()
            .map(|row| CurveSampleRow {
                session_id,
                minutes_elapsed: row.minutes_elapsed,
                charge_rate_kw: row.charge_rate_kw.unwrap_or(0.0),
                soc: row.soc,
                sample_source: "telemetry",
                charger_type: charger_type.clone(),
            })
            .collect());
    }

    let minute_sample_count = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*)::int8
           FROM timeseries.telemetry_1min
           WHERE vehicle_id=$1
             AND bucket >= $2
             AND bucket <= $3
             AND avg_soc IS NOT NULL"#,
    )
    .bind(vehicle_id)
    .bind(started_at)
    .bind(ended_at)
    .fetch_one(pool)
    .await?;

    let minute_rows = if minute_sample_count >= 2 {
        sqlx::query_as::<_, CurveAnalysisValueRow>(
            r#"WITH cap AS (
                   SELECT COALESCE(
                       (SELECT battery_capacity_wh
                        FROM riviamigo.vehicles
                        WHERE id=$1
                          AND battery_capacity_wh IS NOT NULL
                        LIMIT 1),
                       (SELECT max(battery_capacity_wh)
                        FROM timeseries.telemetry
                        WHERE vehicle_id=$1
                          AND battery_capacity_wh IS NOT NULL)
                   ) AS default_cap_wh
               ),
               samples AS (
                   SELECT bucket,
                          avg_soc,
                          avg_power_kw,
                          battery_capacity_wh
                   FROM timeseries.telemetry_1min
                   WHERE vehicle_id=$1
                     AND bucket >= $2
                     AND bucket <= $3
               )
               SELECT bucket AS ts,
                      EXTRACT(EPOCH FROM (bucket - $2))::float8 / 60.0 AS minutes_elapsed,
                      LEAST(
                          CASE WHEN $4 THEN 300.0 ELSE 22.0 END,
                          GREATEST(
                              0.0,
                              COALESCE(
                                  ABS(avg_power_kw),
                                  60.0 * (avg_soc - LAG(avg_soc) OVER (ORDER BY bucket)) / 100.0
                                      * COALESCE(battery_capacity_wh, cap.default_cap_wh) / 1000.0
                              )
                          )
                      ) AS charge_rate_kw,
                      avg_soc AS soc
               FROM samples
               CROSS JOIN cap
               WHERE avg_soc IS NOT NULL
               ORDER BY bucket"#,
        )
        .bind(vehicle_id)
        .bind(started_at)
        .bind(ended_at)
        .bind(is_dc)
        .fetch_all(pool)
        .await?
    } else {
        Vec::new()
    };

    if minute_rows.len() >= 2 {
        return Ok(minute_rows
            .into_iter()
            .map(|row| CurveSampleRow {
                session_id,
                minutes_elapsed: row.minutes_elapsed,
                charge_rate_kw: row.charge_rate_kw.unwrap_or(0.0),
                soc: row.soc,
                sample_source: "telemetry_1min",
                charger_type: charger_type.clone(),
            })
            .collect());
    }

    let fallback = sqlx::query_as::<_, RawCurvePointRow>(
        r#"SELECT ts, power_kw
           FROM riviamigo.rivian_charge_curve_points
           WHERE vehicle_id=$1
             AND charge_session_id=$2
             AND power_kw IS NOT NULL
             AND power_kw > 0
           ORDER BY ts"#,
    )
    .bind(vehicle_id)
    .bind(session_id)
    .fetch_all(pool)
    .await?;

    let Some((soc_start, soc_end)) = soc_start.zip(soc_end) else {
        return Ok(vec![]);
    };
    if fallback.is_empty() {
        return Ok(vec![]);
    }

    Ok(build_fallback_curve_samples(
        session_id,
        started_at,
        ended_at,
        charger_type.as_deref(),
        soc_start,
        soc_end,
        &fallback,
        cap_kw,
    ))
}



