//! Grafana SimpleJSON datasource for Riviamigo telemetry.
//!
//! Implements the Grafana SimpleJSON protocol:
//! <https://grafana.com/grafana/plugins/grafana-simple-json-datasource/>
//!
//! Endpoints:
//!   GET  /v1/grafana          — health check
//!   POST /v1/grafana/search   — list available metrics
//!   POST /v1/grafana/query    — time series data
//!   POST /v1/grafana/annotations — stub (empty)
//!   POST /v1/grafana/tag-keys — stub (empty)
//!   POST /v1/grafana/tag-values — stub (empty)

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_owned,
    errors::AppError,
    middleware::auth::{require_vehicle_access, AppState, AuthUser},
};

/// All telemetry columns that Grafana can request.
/// IMPORTANT: This is a security allowlist. Never interpolate column names
/// into SQL without checking against this list first.
const ALLOWED_METRICS: &[&str] = &[
    "battery_level",
    "battery_capacity_wh",
    "power_kw",
    "regen_power_kw",
    "speed_mph",
    "outside_temp_c",
    "cabin_temp_c",
    "odometer_miles",
];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/grafana", get(health_check))
        .route("/grafana/search", post(search))
        .route("/grafana/query", post(query))
        .route("/grafana/annotations", post(annotations))
        .route("/grafana/tag-keys", post(tag_keys))
        .route("/grafana/tag-values", post(tag_values))
}

/// Grafana health check — returns 200 OK with empty body.
async fn health_check(_auth: AuthUser) -> impl IntoResponse {
    (StatusCode::OK, "")
}

// ── Search ────────────────────────────────────────────────────────────────────

/// Returns the list of available metric names.
async fn search(_auth: AuthUser) -> Json<Vec<&'static str>> {
    Json(ALLOWED_METRICS.to_vec())
}

// ── Query ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GrafanaQueryBody {
    range: GrafanaRange,
    targets: Vec<GrafanaTarget>,
    #[serde(rename = "maxDataPoints")]
    max_data_points: Option<i64>,
}

#[derive(Deserialize)]
struct GrafanaRange {
    from: DateTime<Utc>,
    to: DateTime<Utc>,
}

#[derive(Deserialize)]
struct GrafanaTarget {
    /// Metric name (must be in ALLOWED_METRICS).
    target: String,
    /// Vehicle UUID — required to scope the query.
    #[serde(rename = "vehicleId")]
    vehicle_id: Option<Uuid>,
}

#[derive(Serialize)]
struct TimeSeriesResult {
    target: String,
    datapoints: Vec<[f64; 2]>,
}

#[derive(Deserialize)]
struct VehicleIdQuery {
    vehicle_id: Option<Uuid>,
}

async fn query(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(qp): Query<VehicleIdQuery>,
    Json(body): Json<GrafanaQueryBody>,
) -> Result<Json<Vec<TimeSeriesResult>>, AppError> {
    let max_points = body.max_data_points.unwrap_or(1000).clamp(1, 10_000);
    let mut results = Vec::with_capacity(body.targets.len());

    for target in &body.targets {
        // Validate metric name against allowlist.
        let column = ALLOWED_METRICS
            .iter()
            .find(|&&m| m == target.target.as_str())
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "unknown metric '{}'; valid metrics: {}",
                    target.target,
                    ALLOWED_METRICS.join(", ")
                ))
            })?;

        // Vehicle ID: prefer target-level, fall back to query param.
        let vehicle_id = target
            .vehicle_id
            .or(qp.vehicle_id)
            .ok_or_else(|| AppError::Validation("vehicleId is required".to_string()))?;

        require_vehicle_access(&auth, vehicle_id)?;
        // Verify the vehicle belongs to the authenticated user.
        require_vehicle_owned(&state.pool, auth.user_id, vehicle_id).await?;

        // Query with time-bucketing to respect maxDataPoints.
        // We use a simple approach: fetch all rows in range, client-side limited.
        // For large ranges, Grafana will send maxDataPoints < total rows.
        let sql = format!(
            r#"
            SELECT
                extract(epoch FROM ts) * 1000.0 AS ts_ms,
                {column}::float8 AS value
            FROM timeseries.telemetry
            WHERE vehicle_id = $1
              AND ts BETWEEN $2 AND $3
              AND {column} IS NOT NULL
            ORDER BY ts
            LIMIT $4
            "#
        );

        let rows = sqlx::query_as::<_, (f64, f64)>(&sql)
            .bind(vehicle_id)
            .bind(body.range.from)
            .bind(body.range.to)
            .bind(max_points)
            .fetch_all(&state.pool)
            .await
            .map_err(AppError::from)?;

        let datapoints: Vec<[f64; 2]> = rows.into_iter().map(|(ts_ms, val)| [val, ts_ms]).collect();

        results.push(TimeSeriesResult {
            target: target.target.clone(),
            datapoints,
        });
    }

    Ok(Json(results))
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

async fn annotations(_auth: AuthUser) -> Json<serde_json::Value> {
    Json(serde_json::json!([]))
}

async fn tag_keys(_auth: AuthUser) -> Json<serde_json::Value> {
    Json(serde_json::json!([]))
}

async fn tag_values(_auth: AuthUser) -> Json<serde_json::Value> {
    Json(serde_json::json!([]))
}
