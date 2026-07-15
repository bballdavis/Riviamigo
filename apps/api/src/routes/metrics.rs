use axum::{
    extract::{Query, State},
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
    routes::efficiency_math::weighted_average_from_totals,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/metrics/catalog", get(get_catalog))
        .route("/metrics/value", get(get_value))
        .route("/metrics/series", get(get_series))
        .route("/metrics/batch", post(get_batch))
}

#[derive(Clone, Copy)]
enum MetricSource {
    Summary,
    Telemetry(&'static str),
}

#[derive(Clone, Copy)]
struct MetricDef {
    id: &'static str,
    label: &'static str,
    unit: Option<&'static str>,
    kind: &'static str,
    source_label: &'static str,
    supports_series: bool,
    default_aggregation: &'static str,
    source: MetricSource,
}

#[derive(Serialize)]
struct MetricCatalogEntry {
    id: &'static str,
    label: &'static str,
    unit: Option<&'static str>,
    kind: &'static str,
    source: &'static str,
    supports_series: bool,
    default_aggregation: &'static str,
}

#[derive(Clone, Serialize)]
struct MetricValueResponse {
    metric: String,
    value: Option<f64>,
    unit: Option<&'static str>,
    label: &'static str,
    ts: Option<DateTime<Utc>>,
}

#[derive(Clone, Serialize, sqlx::FromRow)]
struct MetricSeriesPoint {
    ts: DateTime<Utc>,
    value: Option<f64>,
}

#[derive(Serialize, sqlx::FromRow)]
struct WeightedEfficiencyRow {
    ts: DateTime<Utc>,
    total_distance_miles: Option<f64>,
    weighted_efficiency_wh_mi: Option<f64>,
}

#[derive(Deserialize)]
struct CatalogParams {}

#[derive(Deserialize)]
struct ValueParams {
    vehicle_id: Option<Uuid>,
    metric: String,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    lifetime: Option<bool>,
}

#[derive(Deserialize)]
struct SeriesParams {
    vehicle_id: Option<Uuid>,
    metric: String,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    lifetime: Option<bool>,
    bucket: Option<String>,
}

/// A dashboard-oriented metric request. The singular metric routes remain the
/// public compatibility surface; this route avoids one HTTP request per sensor
/// chip when a dashboard needs several values and sparklines.
#[derive(Deserialize)]
struct MetricBatchRequest {
    vehicle_id: Uuid,
    metrics: Vec<MetricBatchMetricRequest>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    lifetime: Option<bool>,
    bucket: Option<String>,
    /// `full` returns every retained source point in the selected range. The
    /// compact default preserves the legacy bounded-sparkline behavior for
    /// external callers that have not opted into full density.
    density: Option<String>,
    max_points: Option<usize>,
}

#[derive(Deserialize)]
struct MetricBatchMetricRequest {
    metric: String,
    #[serde(default = "default_true")]
    include_latest: bool,
    #[serde(default = "default_true")]
    include_series: bool,
}

#[derive(Serialize)]
struct MetricBatchSeriesResponse {
    metric: String,
    points: Vec<MetricSeriesPoint>,
}

#[derive(Serialize)]
struct MetricBatchResponse {
    values: Vec<MetricValueResponse>,
    series: Vec<MetricBatchSeriesResponse>,
    bucket: String,
    density: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_points: Option<usize>,
}

const DASHBOARD_METRIC_MAX_POINTS: usize = 96;

fn default_true() -> bool {
    true
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

fn resolve_bucket(
    requested: Option<&str>,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<&'static str, AppError> {
    match requested.unwrap_or("auto") {
        "auto" => {
            let minutes = (to - from).num_minutes();
            if minutes <= 60 {
                Ok("minute")
            } else if minutes <= 6 * 60 {
                Ok("5min")
            } else if minutes <= 24 * 60 {
                Ok("15min")
            } else if minutes <= 7 * 24 * 60 {
                Ok("hour")
            } else {
                Ok("day")
            }
        }
        "minute" | "1min" => Ok("minute"),
        "5min" => Ok("5min"),
        "15min" => Ok("15min"),
        "hour" | "1h" => Ok("hour"),
        "day" | "1d" => Ok("day"),
        "raw" | "full" => Ok("raw"),
        other => Err(AppError::Validation(format!("unsupported bucket: {other}"))),
    }
}

fn resolve_batch_density(
    density: Option<&str>,
    requested_bucket: Option<&str>,
    requested_max_points: Option<usize>,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<(&'static str, &'static str, Option<usize>), AppError> {
    match density.unwrap_or("compact") {
        "full" => Ok(("full", "raw", None)),
        "compact" => Ok((
            "compact",
        resolve_bucket(requested_bucket, from, to)?,
        Some(
            requested_max_points
                .unwrap_or(DASHBOARD_METRIC_MAX_POINTS)
                .clamp(2, DASHBOARD_METRIC_MAX_POINTS),
        ),
        )),
        other => Err(AppError::Validation(format!("unsupported density: {other}"))),
    }
}

const METRICS: &[MetricDef] = &[
    MetricDef {
        id: "total_miles",
        label: "Total Miles",
        unit: Some("mi"),
        kind: "distance",
        source_label: "summary",
        supports_series: true,
        default_aggregation: "latest",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "trip_miles",
        label: "Trip Miles",
        unit: Some("mi"),
        kind: "distance",
        source_label: "trips",
        supports_series: true,
        default_aggregation: "sum",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "total_trips",
        label: "Total Trips",
        unit: None,
        kind: "number",
        source_label: "summary",
        supports_series: true,
        default_aggregation: "sum",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "energy_charged",
        label: "Energy Charged",
        unit: Some("kWh"),
        kind: "energy",
        source_label: "charging",
        supports_series: true,
        default_aggregation: "sum",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "charging_sessions",
        label: "Charging Sessions",
        unit: None,
        kind: "number",
        source_label: "charging",
        supports_series: true,
        default_aggregation: "sum",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "total_cost",
        label: "Total Cost",
        unit: Some("USD"),
        kind: "currency",
        source_label: "charging",
        supports_series: true,
        default_aggregation: "sum",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "avg_session_energy",
        label: "Avg Session Energy",
        unit: Some("kWh"),
        kind: "energy",
        source_label: "charging",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "avg_efficiency",
        label: "Avg Efficiency",
        unit: Some("Wh/mi"),
        kind: "number",
        source_label: "trips",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "avg_gross_efficiency",
        label: "Avg Gross Efficiency",
        unit: Some("Wh/mi"),
        kind: "number",
        source_label: "trips",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "avg_outside_temp_c",
        label: "Avg Outside (estimated)",
        unit: Some("C"),
        kind: "temperature",
        source_label: "trips",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "avg_trip_duration",
        label: "Avg Trip Duration",
        unit: Some("min"),
        kind: "number",
        source_label: "trips",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Summary,
    },
    MetricDef {
        id: "battery_level",
        label: "Battery Level",
        unit: Some("%"),
        kind: "percent",
        source_label: "telemetry",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Telemetry("battery_level"),
    },
    MetricDef {
        id: "range_miles",
        label: "Estimated Range",
        unit: Some("mi"),
        kind: "distance",
        source_label: "telemetry",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Telemetry("distance_to_empty_mi"),
    },
    MetricDef {
        id: "odometer_miles",
        label: "Odometer",
        unit: Some("mi"),
        kind: "distance",
        source_label: "telemetry",
        supports_series: true,
        default_aggregation: "max",
        source: MetricSource::Telemetry("odometer_miles"),
    },
    MetricDef {
        id: "outside_temp_c",
        label: "Outside Temp",
        unit: Some("C"),
        kind: "temperature",
        source_label: "telemetry",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Telemetry("outside_temp_c"),
    },
    MetricDef {
        id: "speed_mph",
        label: "Speed",
        unit: Some("mph"),
        kind: "speed",
        source_label: "telemetry",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Telemetry("speed_mph"),
    },
    MetricDef {
        id: "power_kw",
        label: "Power",
        unit: Some("kW"),
        kind: "number",
        source_label: "telemetry",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Telemetry("power_kw"),
    },
    MetricDef {
        id: "tire_fl_psi",
        label: "Front Left Tire",
        unit: Some("psi"),
        kind: "pressure",
        source_label: "telemetry",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Telemetry("tire_fl_psi"),
    },
    MetricDef {
        id: "tire_fr_psi",
        label: "Front Right Tire",
        unit: Some("psi"),
        kind: "pressure",
        source_label: "telemetry",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Telemetry("tire_fr_psi"),
    },
    MetricDef {
        id: "tire_rl_psi",
        label: "Rear Left Tire",
        unit: Some("psi"),
        kind: "pressure",
        source_label: "telemetry",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Telemetry("tire_rl_psi"),
    },
    MetricDef {
        id: "tire_rr_psi",
        label: "Rear Right Tire",
        unit: Some("psi"),
        kind: "pressure",
        source_label: "telemetry",
        supports_series: true,
        default_aggregation: "avg",
        source: MetricSource::Telemetry("tire_rr_psi"),
    },
];

async fn get_catalog(
    _auth: AuthUser,
    Query(_p): Query<CatalogParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let metrics: Vec<MetricCatalogEntry> = METRICS
        .iter()
        .map(|m| MetricCatalogEntry {
            id: m.id,
            label: m.label,
            unit: m.unit,
            kind: m.kind,
            source: m.source_label,
            supports_series: m.supports_series,
            default_aggregation: m.default_aggregation,
        })
        .collect();
    Ok(Json(serde_json::json!({ "metrics": metrics })))
}

async fn get_value(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<ValueParams>,
) -> Result<Json<MetricValueResponse>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let metric = find_metric(&p.metric)?;

    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 30);
    let (value, ts) = metric_value(&state.pool, vid, metric, from, to).await?;

    Ok(Json(MetricValueResponse {
        metric: metric.id.to_string(),
        value,
        unit: metric.unit,
        label: metric.label,
        ts,
    }))
}

async fn get_series(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<SeriesParams>,
) -> Result<Json<Vec<MetricSeriesPoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let metric = find_metric(&p.metric)?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 30);
    let bucket = resolve_bucket(p.bucket.as_deref(), from, to)?;

    let points = match metric.source {
        MetricSource::Summary => {
            summary_series(&state.pool, vid, metric.id, from, to, bucket).await?
        }
        MetricSource::Telemetry(column) => {
            telemetry_daily_series(
                &state.pool,
                vid,
                column,
                from,
                to,
                metric.default_aggregation,
                bucket,
            )
            .await?
        }
    };

    Ok(Json(points))
}

async fn get_batch(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(p): Json<MetricBatchRequest>,
) -> Result<Json<MetricBatchResponse>, AppError> {
    if p.metrics.is_empty() {
        return Err(AppError::Validation(
            "at least one metric is required".into(),
        ));
    }
    if p.metrics.len() > 32 {
        return Err(AppError::Validation(
            "at most 32 metrics may be requested".into(),
        ));
    }

    // Validate and coalesce before touching the database.  A custom dashboard
    // can contain the same sensor more than once; it should never multiply
    // either authorization work or the metric queries behind this endpoint.
    let mut requested: Vec<(&'static MetricDef, bool, bool)> = Vec::new();
    for item in p.metrics {
        let metric = find_metric(&item.metric)?;
        if let Some((_, include_latest, include_series)) = requested
            .iter_mut()
            .find(|(existing, _, _)| existing.id == metric.id)
        {
            *include_latest |= item.include_latest;
            *include_series |= item.include_series;
        } else {
            requested.push((metric, item.include_latest, item.include_series));
        }
    }

    require_vehicle_access(&auth, p.vehicle_id)?;
    require_vehicle_owned(&state.pool, auth.user_id, p.vehicle_id).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 30);
    let (density, bucket, max_points) = resolve_batch_density(
        p.density.as_deref(),
        p.bucket.as_deref(),
        p.max_points,
        from,
        to,
    )?;

    let mut values = Vec::new();
    let mut series = Vec::new();
    for (metric, include_latest, include_series) in requested {
        if include_latest {
            let (value, ts) = metric_value(&state.pool, p.vehicle_id, metric, from, to).await?;
            values.push(MetricValueResponse {
                metric: metric.id.to_string(),
                value,
                unit: metric.unit,
                label: metric.label,
                ts,
            });
        }
        if include_series {
            let points = metric_series(&state.pool, p.vehicle_id, metric, from, to, bucket).await?;
            series.push(MetricBatchSeriesResponse {
                metric: metric.id.to_string(),
                points: max_points.map_or(points.clone(), |limit| cap_metric_points(points, limit)),
            });
        }
    }

    Ok(Json(MetricBatchResponse {
        values,
        series,
        bucket: bucket.to_string(),
        density: density.to_string(),
        max_points,
    }))
}

async fn metric_value(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    metric: &MetricDef,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<(Option<f64>, Option<DateTime<Utc>>), AppError> {
    match metric.source {
        MetricSource::Summary => summary_value(pool, vehicle_id, metric.id, from, to).await,
        MetricSource::Telemetry(column) => latest_telemetry_value(pool, vehicle_id, column).await,
    }
}

async fn metric_series(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    metric: &MetricDef,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    bucket: &str,
) -> Result<Vec<MetricSeriesPoint>, AppError> {
    match metric.source {
        MetricSource::Summary => {
            summary_series(pool, vehicle_id, metric.id, from, to, bucket).await
        }
        MetricSource::Telemetry(column) => {
            telemetry_daily_series(
                pool,
                vehicle_id,
                column,
                from,
                to,
                metric.default_aggregation,
                bucket,
            )
            .await
        }
    }
}

fn cap_metric_points(points: Vec<MetricSeriesPoint>, max_points: usize) -> Vec<MetricSeriesPoint> {
    if points.len() <= max_points {
        return points;
    }

    let last_index = points.len() - 1;
    (0..max_points)
        .map(|index| {
            let source_index = index * last_index / (max_points - 1);
            points[source_index].clone()
        })
        .collect()
}

fn find_metric(id: &str) -> Result<&'static MetricDef, AppError> {
    METRICS
        .iter()
        .find(|metric| metric.id == id)
        .ok_or_else(|| AppError::Validation(format!("unknown metric: {id}")))
}

const ALLOWED_TELEMETRY_COLUMNS: &[&str] = &[
    "battery_level",
    "distance_to_empty_mi",
    "odometer_miles",
    "outside_temp_c",
    "speed_mph",
    "power_kw",
    "tire_fl_psi",
    "tire_fr_psi",
    "tire_rl_psi",
    "tire_rr_psi",
];

async fn latest_telemetry_value(
    pool: &sqlx::PgPool,
    vid: Uuid,
    column: &str,
) -> Result<(Option<f64>, Option<DateTime<Utc>>), AppError> {
    if !ALLOWED_TELEMETRY_COLUMNS.contains(&column) {
        return Err(AppError::Validation(format!(
            "unknown telemetry column: {column}"
        )));
    }
    let sql = format!(
        "SELECT {column}::float8 AS value, ts FROM timeseries.telemetry \
         WHERE vehicle_id = $1 AND {column} IS NOT NULL ORDER BY ts DESC LIMIT 1"
    );
    let row = sqlx::query_as::<_, MetricSeriesPoint>(&sql)
        .bind(vid)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| (r.value, Some(r.ts))).unwrap_or((None, None)))
}

async fn summary_value(
    pool: &sqlx::PgPool,
    vid: Uuid,
    metric: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<(Option<f64>, Option<DateTime<Utc>>), AppError> {
    let value = match metric {
        "total_miles" => sqlx::query_scalar(
            "SELECT COALESCE(SUM(distance_miles), 0)::float8
             FROM riviamigo.trips
             WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3
               AND distance_miles > 0",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "total_trips" => sqlx::query_scalar(
            "SELECT COUNT(*)::float8 FROM riviamigo.trips WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "trip_miles" => sqlx::query_scalar(
            "SELECT COALESCE(SUM(distance_miles), 0)::float8 FROM riviamigo.trips
             WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3
               AND distance_miles > 0",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "energy_charged" => sqlx::query_scalar(
            "SELECT COALESCE(SUM(COALESCE(kwh_added, energy_added_wh / 1000.0)), 0)::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "charging_sessions" => sqlx::query_scalar(
            "SELECT COUNT(*)::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "total_cost" => sqlx::query_scalar(
            "SELECT COALESCE(SUM(cost_usd), 0)::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "avg_session_energy" => sqlx::query_scalar(
            "SELECT AVG(COALESCE(kwh_added, energy_added_wh / 1000.0))::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "avg_efficiency" => sqlx::query_as::<_, WeightedEfficiencyRow>(
            "SELECT
                $3 AS ts,
                SUM(distance_miles)::float8 AS total_distance_miles,
                SUM(distance_miles * efficiency_wh_per_mile)::float8 AS weighted_efficiency_wh_mi
             FROM riviamigo.trips
              WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3
               AND efficiency_wh_per_mile IS NOT NULL
               AND distance_miles > 0",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .and_then(|row| {
            weighted_average_from_totals(
                row.total_distance_miles,
                row.weighted_efficiency_wh_mi,
            )
        }),
        "avg_gross_efficiency" => sqlx::query_scalar(
            "SELECT CASE WHEN SUM(distance_miles) > 0 THEN SUM(energy_wh + COALESCE(regen_wh, 0)) / SUM(distance_miles) ELSE NULL END FROM riviamigo.trips WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3 AND energy_wh IS NOT NULL AND distance_miles > 0",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "avg_outside_temp_c" => sqlx::query_scalar(
            "SELECT CASE WHEN SUM(duration_seconds) > 0
                    THEN SUM(outside_temp_c * duration_seconds) / SUM(duration_seconds)
                    ELSE NULL END::float8
             FROM riviamigo.trips
             WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3
               AND outside_temp_c IS NOT NULL AND duration_seconds > 0",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "avg_trip_duration" => sqlx::query_scalar(
            "SELECT AVG(duration_seconds / 60.0)::float8 FROM riviamigo.trips WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3 AND duration_seconds IS NOT NULL",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(pool)
        .await?
        .flatten(),
        _ => None,
    };

    Ok((value, Some(to)))
}

async fn summary_series(
    pool: &sqlx::PgPool,
    vid: Uuid,
    metric: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    bucket: &str,
) -> Result<Vec<MetricSeriesPoint>, AppError> {
    if bucket == "raw" {
        let sql = match metric {
            "total_miles" | "trip_miles" =>
                "SELECT started_at AS ts, distance_miles::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 ORDER BY started_at",
            "total_trips" =>
                "SELECT started_at AS ts, 1.0::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 ORDER BY started_at",
            "energy_charged" | "avg_session_energy" =>
                "SELECT started_at AS ts, COALESCE(kwh_added, energy_added_wh / 1000.0)::float8 AS value
                 FROM riviamigo.charge_sessions
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 ORDER BY started_at",
            "charging_sessions" =>
                "SELECT started_at AS ts, 1.0::float8 AS value
                 FROM riviamigo.charge_sessions
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 ORDER BY started_at",
            "total_cost" =>
                "SELECT started_at AS ts, cost_usd::float8 AS value
                 FROM riviamigo.charge_sessions
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 ORDER BY started_at",
            "avg_efficiency" =>
                "SELECT started_at AS ts, efficiency_wh_per_mile::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 AND efficiency_wh_per_mile IS NOT NULL AND distance_miles > 0
                 ORDER BY started_at",
            "avg_gross_efficiency" =>
                "SELECT started_at AS ts,
                        (energy_wh + COALESCE(regen_wh, 0)) / NULLIF(distance_miles, 0)::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 AND energy_wh IS NOT NULL AND distance_miles > 0
                 ORDER BY started_at",
            "avg_outside_temp_c" =>
                "SELECT started_at AS ts, outside_temp_c::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 AND outside_temp_c IS NOT NULL
                 ORDER BY started_at",
            "avg_trip_duration" =>
                "SELECT started_at AS ts, (duration_seconds / 60.0)::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 AND duration_seconds IS NOT NULL
                 ORDER BY started_at",
            _ => return Ok(Vec::new()),
        };
        return Ok(sqlx::query_as::<_, MetricSeriesPoint>(sql)
            .bind(vid)
            .bind(from)
            .bind(to)
            .fetch_all(pool)
            .await?);
    }

    let summary_bucket_expr = match bucket {
        "minute" => "date_trunc('minute', started_at)",
        "5min" => "time_bucket(INTERVAL '5 minutes', started_at)",
        "15min" => "time_bucket(INTERVAL '15 minutes', started_at)",
        "hour" => "date_trunc('hour', started_at)",
        _ => "date_trunc('day', started_at)",
    };

    let sql: String = match metric {
        "total_miles" => {
            "SELECT day AS ts, miles_driven::float8 AS value
             FROM timeseries.odometer_daily
             WHERE vehicle_id = $1 AND day >= $2 AND day <= $3
             UNION ALL
             SELECT date_trunc('day', started_at) AS ts, SUM(distance_miles)::float8 AS value
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             AND NOT EXISTS (
               SELECT 1 FROM timeseries.odometer_daily
               WHERE vehicle_id = $1 AND day >= $2 AND day <= $3
             )
             GROUP BY 1
             ORDER BY 1"
                .to_string()
        }
        "total_trips" => format!(
            "SELECT {summary_bucket_expr} AS ts, COUNT(*)::float8 AS value
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        ),
        "trip_miles" => format!(
            "SELECT {summary_bucket_expr} AS ts, SUM(distance_miles)::float8 AS value
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        ),
        "energy_charged" => format!(
            "SELECT {summary_bucket_expr} AS ts, SUM(COALESCE(kwh_added, energy_added_wh / 1000.0))::float8 AS value
             FROM riviamigo.charge_sessions
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        ),
        "charging_sessions" => format!(
            "SELECT {summary_bucket_expr} AS ts, COUNT(*)::float8 AS value
             FROM riviamigo.charge_sessions
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        ),
        "total_cost" => format!(
            "SELECT {summary_bucket_expr} AS ts, SUM(cost_usd)::float8 AS value
             FROM riviamigo.charge_sessions
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        ),
        "avg_session_energy" => format!(
            "SELECT {summary_bucket_expr} AS ts, AVG(COALESCE(kwh_added, energy_added_wh / 1000.0))::float8 AS value
             FROM riviamigo.charge_sessions
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        ),
        "avg_efficiency" => format!(
            "SELECT {summary_bucket_expr} AS ts,
                    SUM(distance_miles)::float8 AS total_distance_miles,
                    SUM(distance_miles * efficiency_wh_per_mile)::float8 AS weighted_efficiency_wh_mi
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             AND efficiency_wh_per_mile IS NOT NULL
             AND distance_miles > 0
             GROUP BY 1 ORDER BY 1"
        ),
        "avg_gross_efficiency" => format!(
            "SELECT {summary_bucket_expr} AS ts,
                    (SUM(energy_wh + COALESCE(regen_wh, 0)) / NULLIF(SUM(distance_miles), 0))::float8 AS value
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             AND energy_wh IS NOT NULL AND distance_miles > 0
             GROUP BY 1 ORDER BY 1"
        ),
        "avg_outside_temp_c" => format!(
            "SELECT {summary_bucket_expr} AS ts,
                    CASE WHEN SUM(duration_seconds) > 0
                         THEN SUM(outside_temp_c * duration_seconds) / SUM(duration_seconds)
                         ELSE NULL END::float8 AS value
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             AND outside_temp_c IS NOT NULL AND duration_seconds > 0
             GROUP BY 1 ORDER BY 1"
        ),
        "avg_trip_duration" => format!(
            "SELECT {summary_bucket_expr} AS ts, AVG(duration_seconds / 60.0)::float8 AS value
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             AND duration_seconds IS NOT NULL
             GROUP BY 1 ORDER BY 1"
        ),
        _ => return Ok(Vec::new()),
    };

    if metric == "avg_efficiency" {
        let rows = sqlx::query_as::<_, WeightedEfficiencyRow>(&sql)
            .bind(vid)
            .bind(from)
            .bind(to)
            .fetch_all(pool)
            .await?;

        return Ok(rows
            .into_iter()
            .map(|row| MetricSeriesPoint {
                ts: row.ts,
                value: weighted_average_from_totals(
                    row.total_distance_miles,
                    row.weighted_efficiency_wh_mi,
                ),
            })
            .collect());
    }

    Ok(sqlx::query_as::<_, MetricSeriesPoint>(&sql)
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_all(pool)
        .await?)
}

async fn telemetry_daily_series(
    pool: &sqlx::PgPool,
    vid: Uuid,
    column: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    aggregation: &str,
    bucket: &str,
) -> Result<Vec<MetricSeriesPoint>, AppError> {
    if !ALLOWED_TELEMETRY_COLUMNS.contains(&column) {
        return Err(AppError::Validation(format!(
            "unknown telemetry column: {column}"
        )));
    }
    if bucket == "raw" {
        let sql = format!(
            "SELECT ts, {column}::float8 AS value \
             FROM timeseries.telemetry \
             WHERE vehicle_id = $1 AND ts >= $2 AND ts <= $3 AND {column} IS NOT NULL \
             ORDER BY ts"
        );
        return Ok(sqlx::query_as::<_, MetricSeriesPoint>(&sql)
            .bind(vid)
            .bind(from)
            .bind(to)
            .fetch_all(pool)
            .await?);
    }
    let aggregate = match aggregation {
        "avg" | "mean" => "AVG",
        "max" => "MAX",
        "sum" => "SUM",
        other => {
            return Err(AppError::Validation(format!(
                "unknown aggregation: {other}"
            )))
        }
    };
    let bucket_expr = match bucket {
        "minute" => "date_trunc('minute', ts)",
        "5min" => "time_bucket(INTERVAL '5 minutes', ts)",
        "15min" => "time_bucket(INTERVAL '15 minutes', ts)",
        "hour" => "date_trunc('hour', ts)",
        _ => "date_trunc('day', ts)",
    };

    let sql = format!(
        "SELECT {bucket_expr} AS ts, {aggregate}({column})::float8 AS value \
         FROM timeseries.telemetry \
         WHERE vehicle_id = $1 AND ts >= $2 AND ts <= $3 AND {column} IS NOT NULL \
         GROUP BY 1 ORDER BY 1"
    );
    Ok(sqlx::query_as::<_, MetricSeriesPoint>(&sql)
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_all(pool)
        .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every `MetricSource::Telemetry(column)` in the METRICS registry must
    /// appear in `ALLOWED_TELEMETRY_COLUMNS` — otherwise the `get_value` and
    /// `get_series` handlers would always return a validation error for that
    /// metric, silently making it unavailable.
    #[test]
    fn all_telemetry_metric_columns_are_in_allowlist() {
        let unguarded: Vec<&str> = METRICS
            .iter()
            .filter_map(|m| {
                if let MetricSource::Telemetry(col) = m.source {
                    if !ALLOWED_TELEMETRY_COLUMNS.contains(&col) {
                        Some(col)
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .collect();

        assert!(
            unguarded.is_empty(),
            "MetricDef::Telemetry columns missing from ALLOWED_TELEMETRY_COLUMNS: {unguarded:?}"
        );
    }

    /// `ALLOWED_TELEMETRY_COLUMNS` must not contain duplicate entries — a
    /// duplicate would be a sign of a copy-paste error with no runtime impact,
    /// but catches future refactoring mistakes.
    #[test]
    fn allowed_telemetry_columns_has_no_duplicates() {
        let mut seen = std::collections::HashSet::new();
        for col in ALLOWED_TELEMETRY_COLUMNS {
            assert!(
                seen.insert(*col),
                "duplicate column in ALLOWED_TELEMETRY_COLUMNS: {col}"
            );
        }
    }

    /// Metric IDs must be unique — duplicate IDs would cause `find_metric` to
    /// always return the first match, silently shadowing the later definition.
    #[test]
    fn metric_ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for m in METRICS {
            assert!(seen.insert(m.id), "duplicate metric id: {}", m.id);
        }
    }

    #[test]
    fn compact_batch_point_cap_keeps_the_first_and_last_samples() {
        let start = Utc::now();
        let points = (0..200)
            .map(|offset| MetricSeriesPoint {
                ts: start + chrono::Duration::seconds(offset),
                value: Some(offset as f64),
            })
            .collect();

        let capped = cap_metric_points(points, DASHBOARD_METRIC_MAX_POINTS);
        assert_eq!(capped.len(), DASHBOARD_METRIC_MAX_POINTS);
        assert_eq!(capped.first().and_then(|point| point.value), Some(0.0));
        assert_eq!(capped.last().and_then(|point| point.value), Some(199.0));
    }

    #[test]
    fn batch_limit_never_exceeds_the_dashboard_budget() {
        assert_eq!(
            128usize.clamp(2, DASHBOARD_METRIC_MAX_POINTS),
            DASHBOARD_METRIC_MAX_POINTS
        );
    }

    #[test]
    fn full_batch_density_selects_raw_rows_without_a_point_cap() {
        let to = Utc::now();
        let from = to - chrono::Duration::days(365);
        let (density, bucket, max_points) =
            resolve_batch_density(Some("full"), Some("day"), Some(2), from, to).unwrap();

        assert_eq!(density, "full");
        assert_eq!(bucket, "raw");
        assert_eq!(max_points, None);
    }

    #[test]
    fn raw_bucket_is_available_to_the_singular_series_endpoint() {
        let to = Utc::now();
        let from = to - chrono::Duration::days(30);
        assert_eq!(resolve_bucket(Some("raw"), from, to).unwrap(), "raw");
    }
}
