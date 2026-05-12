use axum::{
    extract::{Query, State},
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
        .route("/metrics/catalog", get(get_catalog))
        .route("/metrics/value", get(get_value))
        .route("/metrics/series", get(get_series))
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

#[derive(Serialize)]
struct MetricValueResponse {
    metric: String,
    value: Option<f64>,
    unit: Option<&'static str>,
    label: &'static str,
    ts: Option<DateTime<Utc>>,
}

#[derive(Serialize, sqlx::FromRow)]
struct MetricSeriesPoint {
    ts: DateTime<Utc>,
    value: Option<f64>,
}

#[derive(Deserialize)]
struct CatalogParams {}

#[derive(Deserialize)]
struct ValueParams {
    vehicle_id: Option<Uuid>,
    metric: String,
}

#[derive(Deserialize)]
struct SeriesParams {
    vehicle_id: Option<Uuid>,
    metric: String,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    bucket: Option<String>,
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
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let metric = find_metric(&p.metric)?;

    let (value, ts) = match metric.source {
        MetricSource::Summary => summary_value(&state.pool, vid, metric.id).await?,
        MetricSource::Telemetry(column) => latest_telemetry_value(&state.pool, vid, column).await?,
    };

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
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let metric = find_metric(&p.metric)?;
    let from = p
        .from
        .unwrap_or_else(|| Utc::now() - chrono::Duration::days(30));
    let to = p.to.unwrap_or_else(Utc::now);
    let bucket = p.bucket.as_deref().unwrap_or("day");
    if bucket != "day" {
        return Err(AppError::Validation("only day bucket is supported".into()));
    }

    let points = match metric.source {
        MetricSource::Summary => summary_series(&state.pool, vid, metric.id, from, to).await?,
        MetricSource::Telemetry(column) => {
            telemetry_daily_series(
                &state.pool,
                vid,
                column,
                from,
                to,
                metric.default_aggregation,
            )
            .await?
        }
    };

    Ok(Json(points))
}

fn find_metric(id: &str) -> Result<&'static MetricDef, AppError> {
    METRICS
        .iter()
        .find(|metric| metric.id == id)
        .ok_or_else(|| AppError::Validation(format!("unknown metric: {id}")))
}

async fn latest_telemetry_value(
    pool: &sqlx::PgPool,
    vid: Uuid,
    column: &str,
) -> Result<(Option<f64>, Option<DateTime<Utc>>), AppError> {
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
) -> Result<(Option<f64>, Option<DateTime<Utc>>), AppError> {
    let latest_ts: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT max(ts) FROM timeseries.telemetry WHERE vehicle_id = $1")
            .bind(vid)
            .fetch_optional(pool)
            .await?
            .flatten();

    let value = match metric {
        "total_miles" => sqlx::query_scalar(
            "SELECT COALESCE(
                (SELECT odometer_miles FROM timeseries.telemetry WHERE vehicle_id=$1 AND odometer_miles IS NOT NULL ORDER BY ts DESC LIMIT 1),
                (SELECT SUM(distance_miles) FROM riviamigo.trips WHERE vehicle_id=$1)
            )",
        )
        .bind(vid)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "total_trips" => sqlx::query_scalar(
            "SELECT COUNT(*)::float8 FROM riviamigo.trips WHERE vehicle_id=$1",
        )
        .bind(vid)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "trip_miles" => sqlx::query_scalar(
            "SELECT COALESCE(SUM(distance_miles), 0)::float8 FROM riviamigo.trips WHERE vehicle_id=$1",
        )
        .bind(vid)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "energy_charged" => sqlx::query_scalar(
            "SELECT COALESCE(SUM(COALESCE(kwh_added, energy_added_wh / 1000.0)), 0)::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1",
        )
        .bind(vid)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "charging_sessions" => sqlx::query_scalar(
            "SELECT COUNT(*)::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1",
        )
        .bind(vid)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "total_cost" => sqlx::query_scalar(
            "SELECT COALESCE(SUM(cost_usd), 0)::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1",
        )
        .bind(vid)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "avg_session_energy" => sqlx::query_scalar(
            "SELECT AVG(COALESCE(kwh_added, energy_added_wh / 1000.0))::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1",
        )
        .bind(vid)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "avg_efficiency" => sqlx::query_scalar(
            "SELECT CASE WHEN SUM(distance_miles) > 0 THEN SUM(distance_miles * efficiency_wh_per_mile) / SUM(distance_miles) ELSE NULL END FROM riviamigo.trips WHERE vehicle_id=$1",
        )
        .bind(vid)
        .fetch_optional(pool)
        .await?
        .flatten(),
        "avg_trip_duration" => sqlx::query_scalar(
            "SELECT AVG(duration_seconds / 60.0)::float8 FROM riviamigo.trips WHERE vehicle_id=$1 AND duration_seconds IS NOT NULL",
        )
        .bind(vid)
        .fetch_optional(pool)
        .await?
        .flatten(),
        _ => None,
    };

    Ok((value, latest_ts))
}

async fn summary_series(
    pool: &sqlx::PgPool,
    vid: Uuid,
    metric: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Result<Vec<MetricSeriesPoint>, AppError> {
    let sql = match metric {
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
        }
        "total_trips" => {
            "SELECT date_trunc('day', started_at) AS ts, COUNT(*)::float8 AS value
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        }
        "trip_miles" => {
            "SELECT date_trunc('day', started_at) AS ts, SUM(distance_miles)::float8 AS value
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        }
        "energy_charged" => {
            "SELECT date_trunc('day', started_at) AS ts, SUM(COALESCE(kwh_added, energy_added_wh / 1000.0))::float8 AS value
             FROM riviamigo.charge_sessions
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        }
        "charging_sessions" => {
            "SELECT date_trunc('day', started_at) AS ts, COUNT(*)::float8 AS value
             FROM riviamigo.charge_sessions
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        }
        "total_cost" => {
            "SELECT date_trunc('day', started_at) AS ts, SUM(cost_usd)::float8 AS value
             FROM riviamigo.charge_sessions
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        }
        "avg_session_energy" => {
            "SELECT date_trunc('day', started_at) AS ts, AVG(COALESCE(kwh_added, energy_added_wh / 1000.0))::float8 AS value
             FROM riviamigo.charge_sessions
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             GROUP BY 1 ORDER BY 1"
        }
        "avg_efficiency" => {
            "SELECT started_at::date::timestamptz AS ts, AVG(efficiency_wh_per_mile)::float8 AS value
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             AND efficiency_wh_per_mile IS NOT NULL
             GROUP BY 1 ORDER BY 1"
        }
        "avg_trip_duration" => {
            "SELECT started_at::date::timestamptz AS ts, AVG(duration_seconds / 60.0)::float8 AS value
             FROM riviamigo.trips
             WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
             AND duration_seconds IS NOT NULL
             GROUP BY 1 ORDER BY 1"
        }
        _ => return Ok(Vec::new()),
    };

    Ok(sqlx::query_as::<_, MetricSeriesPoint>(sql)
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
) -> Result<Vec<MetricSeriesPoint>, AppError> {
    let aggregate = match aggregation {
        "max" => "MAX",
        "sum" => "SUM",
        _ => "AVG",
    };
    let sql = format!(
        "SELECT date_trunc('day', ts) AS ts, {aggregate}({column})::float8 AS value \
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
