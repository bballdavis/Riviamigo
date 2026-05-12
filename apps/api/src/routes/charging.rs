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
}

#[derive(Debug, sqlx::FromRow)]
struct SessionBoundsRow {
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
}

#[derive(Debug, sqlx::FromRow)]
struct SummaryAggRow {
    total_kwh: Option<f64>,
    session_count: i64,
    home_kwh: Option<f64>,
    away_kwh: Option<f64>,
    ac_kwh: Option<f64>,
    ac_l2_kwh: Option<f64>,
    dc_kwh: Option<f64>,
    typed_session_count: i64,
    max_charge_limit_pct: Option<f64>,
    max_charge_rate_kw: Option<f64>,
    total_energy_used_kwh: Option<f64>,
    total_cost_usd: Option<f64>,
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
                      GREATEST(0.0,
                        60.0 * (avg_soc - LAG(avg_soc) OVER (PARTITION BY session_id ORDER BY bucket)) / 100.0
                             * cap_wh / 1000.0
                      ) AS charge_rate_kw,
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
                cs.cost_usd \
         FROM riviamigo.charge_sessions cs \
         LEFT JOIN riviamigo.geofences g ON g.id = cs.geofence_id \
         LEFT JOIN riviamigo.addresses a ON a.id = cs.address_id \
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
                        WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, \
                            CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) < 12 THEN 'ac' \
                        WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, \
                            CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) < 50 THEN 'ac_l2' \
                        WHEN COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, \
                            CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) IS NOT NULL THEN 'dc' \
                    END \
                ) AS charger_type, \
                COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) AS kwh_added, cs.soc_start, cs.soc_end, \
                COALESCE(cs.max_charge_rate_kw, cs.avg_charge_rate_kw, CASE WHEN cs.duration_minutes > 0 THEN COALESCE(cs.kwh_added, cs.energy_added_wh / 1000.0) / (cs.duration_minutes::float8 / 60.0) END) AS max_charge_rate_kw, cs.duration_minutes, cs.cost_usd \
         FROM riviamigo.charge_sessions cs \
         LEFT JOIN riviamigo.geofences g ON g.id = cs.geofence_id \
         LEFT JOIN riviamigo.addresses a ON a.id = cs.address_id \
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
        session.started_at,
        session.ended_at,
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
        "SELECT started_at, ended_at FROM riviamigo.charge_sessions WHERE id=$1 AND vehicle_id=$2",
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
            session.started_at,
            session.ended_at
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
                charge_limit,
                cost_usd,
                energy_used_wh,
                COALESCE(max_charge_rate_kw, avg_charge_rate_kw,
                    CASE WHEN duration_minutes > 0 THEN COALESCE(kwh_added, energy_added_wh / 1000.0) / (duration_minutes::float8 / 60.0) END
                ) AS rate_kw
            FROM riviamigo.charge_sessions
            WHERE vehicle_id=$1 AND started_at>=$2 AND started_at<=$3
        ),
        typed AS (
            SELECT *,
                COALESCE(charger_type, CASE
                    WHEN rate_kw < 12 THEN 'ac'
                    WHEN rate_kw < 50 THEN 'ac_l2'
                    WHEN rate_kw IS NOT NULL THEN 'dc'
                END) AS derived_type
            FROM normalized
        )
        SELECT COALESCE(SUM(energy_kwh),0) AS total_kwh,
            COUNT(*) AS session_count,
            COALESCE(SUM(CASE WHEN is_home THEN energy_kwh ELSE 0 END),0) AS home_kwh,
            COALESCE(SUM(CASE WHEN NOT COALESCE(is_home,false) THEN energy_kwh ELSE 0 END),0) AS away_kwh,
            COALESCE(SUM(CASE WHEN derived_type='ac' THEN energy_kwh ELSE 0 END),0) AS ac_kwh,
            COALESCE(SUM(CASE WHEN derived_type='ac_l2' THEN energy_kwh ELSE 0 END),0) AS ac_l2_kwh,
            COALESCE(SUM(CASE WHEN derived_type='dc' THEN energy_kwh ELSE 0 END),0) AS dc_kwh,
            COUNT(derived_type) AS typed_session_count,
            MAX(charge_limit) AS max_charge_limit_pct,
            MAX(rate_kw) AS max_charge_rate_kw,
            SUM(GREATEST(energy_kwh, COALESCE(energy_used_wh / 1000.0, 0))) AS total_energy_used_kwh,
            COALESCE(SUM(cost_usd),0) AS total_cost_usd
         FROM typed"
    )
    .bind(vehicle_id)
    .bind(from)
    .bind(to)
    .fetch_one(&state.pool)
    .await?;

    let capacity_kwh: Option<f64> = sqlx::query_scalar::<_, Option<f64>>(
        "SELECT COALESCE(
            (SELECT rated_kwh FROM riviamigo.battery_capacity_snapshots WHERE vehicle_id=$1 AND rated_kwh IS NOT NULL ORDER BY snapshotted_at ASC LIMIT 1),
            (SELECT battery_capacity_wh / 1000.0 FROM timeseries.telemetry WHERE vehicle_id=$1 AND battery_capacity_wh IS NOT NULL ORDER BY ts ASC LIMIT 1)
        )"
    )
    .bind(vehicle_id)
    .fetch_one(&state.pool)
    .await?;

    let weekly = sqlx::query_as::<_, WeeklySummaryRow>(
        "SELECT date_trunc('week', started_at) AS week_start,
            COALESCE(SUM(COALESCE(kwh_added, energy_added_wh / 1000.0)),0) AS kwh,
            COALESCE(SUM(cost_usd),0) AS cost_usd,
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

    let total_kwh = agg.total_kwh.unwrap_or(0.0);
    let total_energy_used_kwh = agg.total_energy_used_kwh.unwrap_or(0.0);
    let charging_cycles = capacity_kwh.and_then(|cap| {
        if cap > 0.0 {
            Some((total_kwh / cap).floor())
        } else {
            None
        }
    });
    let charging_efficiency_pct = if total_energy_used_kwh > 0.0 {
        Some(total_kwh / total_energy_used_kwh * 100.0)
    } else {
        None
    };

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
        "charging_cycles": charging_cycles,
        "charging_efficiency_pct": charging_efficiency_pct,
        "total_energy_used_kwh": total_energy_used_kwh,
        "max_charge_limit_pct": agg.max_charge_limit_pct,
        "max_charge_rate_kw": agg.max_charge_rate_kw,
        "typed_session_count": agg.typed_session_count,
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

    let rows = sqlx::query_as::<_, CurveRow>(
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
    )
    .bind(vehicle_id)
    .bind(started_at)
    .bind(ended_at)
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
