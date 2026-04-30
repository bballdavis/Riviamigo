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
        .route("/charging/:id", get(get_session))
        .route("/charging/sessions", get(list_sessions))
        .route("/charging/sessions/:id", get(get_session))
    .route("/charging/sessions/:id/curve", get(get_session_curve))
        .route("/charging/summary", get(get_summary))
    .route("/vehicles/:vehicle_id/charging-sessions", get(list_sessions_path))
    .route("/vehicles/:vehicle_id/charging-sessions/:id", get(get_session_path))
    .route("/vehicles/:vehicle_id/charging-sessions/:id/curve", get(get_session_curve_path))
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
    is_home: Option<bool>,
    charger_type: Option<String>,
    kwh_added: Option<f64>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    max_charge_rate_kw: Option<f64>,
    duration_minutes: Option<i32>,
    cost_usd: Option<f64>,
}

async fn list_sessions(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<SessionListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(90));
    let to = p.to.unwrap_or_else(Utc::now);
    let limit = p.per_page.or(p.limit).unwrap_or(50).clamp(1, 200);
    let page = p.page.unwrap_or(1).max(1);
    let offset = p.offset.unwrap_or((page - 1) * limit).max(0);

    let rows = sqlx::query_as!(
        SessionRow,
        "SELECT id, started_at, ended_at, location_lat, location_lng, is_home, charger_type, \
                COALESCE(kwh_added, energy_added_wh / 1000.0) AS kwh_added, soc_start, soc_end, \
                COALESCE(max_charge_rate_kw, avg_charge_rate_kw) AS max_charge_rate_kw, duration_minutes, \
                cost_usd \
         FROM riviamigo.charge_sessions \
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3 \
         ORDER BY started_at DESC LIMIT $4 OFFSET $5",
        vid,
        from,
        to,
        limit,
        offset
    )
    .fetch_all(&state.pool)
    .await?;

    let total: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3",
        vid, from, to
    ).fetch_one(&state.pool).await?.unwrap_or(0);

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

async fn get_session(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let session = sqlx::query_as!(
        SessionRow,
        "SELECT id, started_at, ended_at, location_lat, location_lng, is_home, charger_type, \
                COALESCE(kwh_added, energy_added_wh / 1000.0) AS kwh_added, soc_start, soc_end, \
                COALESCE(max_charge_rate_kw, avg_charge_rate_kw) AS max_charge_rate_kw, duration_minutes, cost_usd \
         FROM riviamigo.charge_sessions WHERE id=$1 AND vehicle_id=$2",
        id,
        vid
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    // Charge curve
    let curve = load_curve(&state.pool, vid, session.started_at, session.ended_at).await?;

    Ok(Json(serde_json::json!({
        "session": session,
        "curve":   curve,
    })))
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

    let rows = sqlx::query_as!(
        SessionRow,
        "SELECT id, started_at, ended_at, location_lat, location_lng, is_home, charger_type, \
                COALESCE(kwh_added, energy_added_wh / 1000.0) AS kwh_added, soc_start, soc_end, \
                COALESCE(max_charge_rate_kw, avg_charge_rate_kw) AS max_charge_rate_kw, duration_minutes, \
                cost_usd \
         FROM riviamigo.charge_sessions \
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3 \
         ORDER BY started_at DESC LIMIT $4 OFFSET $5",
        vehicle_id,
        from,
        to,
        limit,
        offset
    )
    .fetch_all(&state.pool)
    .await?;

    let total: i64 = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3",
        vehicle_id,
        from,
        to
    )
    .fetch_one(&state.pool)
    .await?
    .unwrap_or(0);

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

    let session = sqlx::query_as!(
        SessionRow,
        "SELECT id, started_at, ended_at, location_lat, location_lng, is_home, charger_type, \
                COALESCE(kwh_added, energy_added_wh / 1000.0) AS kwh_added, soc_start, soc_end, \
                COALESCE(max_charge_rate_kw, avg_charge_rate_kw) AS max_charge_rate_kw, duration_minutes, cost_usd \
         FROM riviamigo.charge_sessions WHERE id=$1 AND vehicle_id=$2",
        id,
        vehicle_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let curve = load_curve(&state.pool, vehicle_id, session.started_at, session.ended_at).await?;

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

    let session = sqlx::query!(
        "SELECT started_at, ended_at FROM riviamigo.charge_sessions WHERE id=$1 AND vehicle_id=$2",
        id,
        vehicle_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(serde_json::json!(load_curve(&state.pool, vehicle_id, session.started_at, session.ended_at).await?)))
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

    let agg = sqlx::query!(
        "SELECT COALESCE(SUM(COALESCE(kwh_added, energy_added_wh / 1000.0)),0) AS total_kwh,
                COUNT(*) AS session_count,
            COALESCE(SUM(CASE WHEN is_home THEN COALESCE(kwh_added, energy_added_wh / 1000.0) ELSE 0 END),0) AS home_kwh,
            COALESCE(SUM(CASE WHEN NOT COALESCE(is_home,false) THEN COALESCE(kwh_added, energy_added_wh / 1000.0) ELSE 0 END),0) AS away_kwh,
            COALESCE(SUM(CASE WHEN charger_type='ac' THEN COALESCE(kwh_added, energy_added_wh / 1000.0) ELSE 0 END),0) AS ac_kwh,
            COALESCE(SUM(CASE WHEN charger_type='ac_l2' THEN COALESCE(kwh_added, energy_added_wh / 1000.0) ELSE 0 END),0) AS ac_l2_kwh,
            COALESCE(SUM(CASE WHEN charger_type='dc' THEN COALESCE(kwh_added, energy_added_wh / 1000.0) ELSE 0 END),0) AS dc_kwh,
            COALESCE(SUM(cost_usd),0) AS total_cost_usd
         FROM riviamigo.charge_sessions
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3",
        vehicle_id, from, to
    ).fetch_one(&state.pool).await?;

    let weekly = sqlx::query!(
        "SELECT date_trunc('week', started_at) AS week_start,
            COALESCE(SUM(COALESCE(kwh_added, energy_added_wh / 1000.0)),0) AS kwh,
            COALESCE(SUM(cost_usd),0) AS cost_usd,
            COUNT(*) AS sessions
         FROM riviamigo.charge_sessions
         WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
         GROUP BY 1 ORDER BY 1",
        vehicle_id,
        from,
        to
    )
    .fetch_all(&state.pool)
    .await?;

    let total_kwh = agg.total_kwh.unwrap_or(0.0);
    Ok(Json(serde_json::json!({
        "total_kwh":       total_kwh,
        "total_energy_kwh": total_kwh,
        "total_cost_usd":  agg.total_cost_usd,
        "session_count":   agg.session_count,
        "home_kwh":        agg.home_kwh,
        "away_kwh":        agg.away_kwh,
        "by_type": {
            "ac_kwh":   agg.ac_kwh,
            "ac_l2_kwh": agg.ac_l2_kwh,
            "dc_kwh":   agg.dc_kwh,
        },
        "weekly": weekly.iter().map(|r| serde_json::json!({
            "week_start": r.week_start,
            "kwh":        r.kwh,
            "energy_kwh": r.kwh,
            "cost_usd":   r.cost_usd,
            "sessions":   r.sessions,
        })).collect::<Vec<_>>(),
    })))
}

async fn load_curve(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let Some(ended_at) = ended_at else {
        return Ok(vec![]);
    };

    let rows = sqlx::query!(
        r#"WITH samples AS (
               SELECT bucket,
                      avg_soc,
                      max(battery_capacity_wh) OVER () AS cap_wh
               FROM timeseries.telemetry_1min
               WHERE vehicle_id=$1 AND bucket>=$2 AND bucket<=$3
           )
           SELECT EXTRACT(EPOCH FROM (bucket - $2))::float8 / 60.0 AS minutes_elapsed,
                  GREATEST(0.0,
                    60.0 * (avg_soc - LAG(avg_soc) OVER (ORDER BY bucket)) / 100.0
                         * cap_wh / 1000.0
                  ) AS charge_rate_kw,
                  avg_soc AS soc
           FROM samples
           WHERE avg_soc IS NOT NULL
           ORDER BY bucket"#,
        vehicle_id,
        started_at,
        ended_at
    )
    .fetch_all(pool)
    .await?;

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
