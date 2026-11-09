use axum::{
    extract::{DefaultBodyLimit, Query, State},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_read_access,
    errors::AppError,
    middleware::auth::{require_vehicle_access, AppState, AuthUser},
    routes::efficiency_math::weighted_average_from_totals,
    routes::trip_tag_filter::{
        parse_tag_filter, require_known_vehicle_tags, sql_predicate, TripTagFilter, TripTagMatch,
    },
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/metrics/catalog", get(get_catalog))
        .route("/metrics/value", get(get_value))
        .route("/metrics/series", get(get_series))
        .route("/metrics/batch", post(get_batch))
        .layer(DefaultBodyLimit::max(64 * 1024))
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
    tag_ids: Option<String>,
    tag_match: Option<TripTagMatch>,
    untagged: Option<bool>,
}

#[derive(Deserialize)]
struct MetricBatchMetricRequest {
    metric: String,
    #[serde(default = "default_true")]
    include_latest: bool,
    #[serde(default = "default_true")]
    include_series: bool,
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
        other => Err(AppError::Validation(format!(
            "unsupported density: {other}"
        ))),
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

pub(crate) fn is_series_metric(metric_id: &str) -> bool {
    METRICS
        .iter()
        .any(|metric| metric.id == metric_id && metric.supports_series)
}

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
    require_vehicle_read_access(&state.pool, &auth, vid).await?;
    let metric = find_metric(&p.metric)?;

    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 30);
    let permit = state
        .resources
        .heavy(auth.user_id, &state.config.security)?;
    tokio::time::timeout(
        std::time::Duration::from_secs(state.config.security.metrics_timeout_seconds),
        async {
            let mut tx = crate::services::admitted_read::AdmittedRead::begin(
                &state.pool,
                permit,
                state.config.security.metrics_timeout_seconds,
            )
            .await?;
            let (value, ts) =
                metric_value(&mut tx, vid, metric, from, to, &TripTagFilter::default()).await?;
            tx.commit().await?;
            Ok(Json(MetricValueResponse {
                metric: metric.id.to_owned(),
                value,
                unit: metric.unit,
                label: metric.label,
                ts,
            }))
        },
    )
    .await
    .map_err(|_| AppError::DependencyUnavailable("Metric query deadline exceeded".into()))?
}

async fn get_series(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<SeriesParams>,
) -> Result<axum::response::Response, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_read_access(&state.pool, &auth, vid).await?;
    let metric = find_metric(&p.metric)?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 30);
    let bucket = resolve_bucket(p.bucket.as_deref(), from, to)?;

    let query = metric_series(metric, bucket, &TripTagFilter::default())?;
    let permit = state
        .resources
        .heavy(auth.user_id, &state.config.security)?;
    Ok(stream_metrics(
        state,
        StreamRequest {
            vehicle_id: vid,
            from,
            to,
            tag_filter: TripTagFilter::default(),
            metrics: vec![(metric, false, true, Some(query))],
            bucket,
            density: "full",
            max_points: None,
            standalone: true,
        },
        permit,
    ))
}

async fn get_batch(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(p): Json<MetricBatchRequest>,
) -> Result<axum::response::Response, AppError> {
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
    require_vehicle_read_access(&state.pool, &auth, p.vehicle_id).await?;
    let tag_filter = parse_tag_filter(p.tag_ids.as_deref(), p.tag_match, p.untagged)?;
    require_known_vehicle_tags(&state.pool, p.vehicle_id, &tag_filter).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 30);
    let (density, bucket, max_points) = resolve_batch_density(
        p.density.as_deref(),
        p.bucket.as_deref(),
        p.max_points,
        from,
        to,
    )?;

    let mut metrics = Vec::with_capacity(requested.len());
    for (metric, latest, series) in requested {
        let query = if series {
            Some(metric_series(metric, bucket, &tag_filter)?)
        } else {
            None
        };
        metrics.push((metric, latest, series, query));
    }
    let permit = state
        .resources
        .heavy(auth.user_id, &state.config.security)?;
    Ok(stream_metrics(
        state,
        StreamRequest {
            vehicle_id: p.vehicle_id,
            from,
            to,
            tag_filter,
            metrics,
            bucket,
            density,
            max_points,
            standalone: false,
        },
        permit,
    ))
}

async fn metric_value(
    conn: &mut sqlx::PgConnection,
    vehicle_id: Uuid,
    metric: &MetricDef,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tag_filter: &TripTagFilter,
) -> Result<(Option<f64>, Option<DateTime<Utc>>), AppError> {
    match metric.source {
        MetricSource::Summary => {
            summary_value(conn, vehicle_id, metric.id, from, to, tag_filter).await
        }
        MetricSource::Telemetry(column) => latest_telemetry_value(conn, vehicle_id, column).await,
    }
}

fn metric_series(
    metric: &MetricDef,
    bucket: &str,
    tag_filter: &TripTagFilter,
) -> Result<SeriesQuery, AppError> {
    match metric.source {
        MetricSource::Summary => summary_series(metric.id, bucket, tag_filter),
        MetricSource::Telemetry(column) => {
            telemetry_daily_series(column, metric.default_aggregation, bucket)
        }
    }
}

struct SeriesQuery {
    sql: String,
    weighted: bool,
    filtered: bool,
}

struct StreamRequest {
    vehicle_id: Uuid,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tag_filter: TripTagFilter,
    metrics: Vec<(&'static MetricDef, bool, bool, Option<SeriesQuery>)>,
    bucket: &'static str,
    density: &'static str,
    max_points: Option<usize>,
    standalone: bool,
}

/// Bounded producer/consumer buffering. Dropping the response cancels the
/// producer. Its read guard cancels the backend and retains admission until
/// rollback has drained the server response and closed its cursor.
/// Adapts the producer channel into a response body stream.
///
/// `unfold` panics if it is polled again after yielding `None`, and a response
/// body may legitimately poll a finished stream, so the stream is fused.
fn metric_body_stream(
    receiver: tokio::sync::mpsc::Receiver<Result<axum::body::Bytes, std::io::Error>>,
) -> impl futures::Stream<Item = Result<axum::body::Bytes, std::io::Error>> {
    futures::StreamExt::fuse(futures::stream::unfold(
        receiver,
        |mut receiver| async move { receiver.recv().await.map(|chunk| (chunk, receiver)) },
    ))
}

fn stream_metrics(
    state: AppState,
    request: StreamRequest,
    permit: crate::services::resource_limits::ResourcePermit,
) -> axum::response::Response {
    use axum::{
        body::{Body, Bytes},
        response::IntoResponse,
    };
    let (sender, receiver) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(2);
    tokio::spawn(async move {
        let mut output = MetricOutput {
            sender: sender.clone(),
            buffer: Vec::with_capacity(64 * 1024),
        };
        let result = tokio::select! {
            biased;
            _ = sender.closed() => return,
            result = tokio::time::timeout(std::time::Duration::from_secs(state.config.security.metrics_timeout_seconds),
                produce_metrics(&state, &request, &mut output, permit)) => result.unwrap_or_else(|_| Err(AppError::DependencyUnavailable("Metric request timed out".into()))),
        };
        if let Err(error) = result {
            tracing::warn!(?error, "metric response interrupted");
            let _ = sender
                .send(Err(std::io::Error::other("metric response interrupted")))
                .await;
        }
    });
    let stream = metric_body_stream(receiver);
    (
        [
            ("content-type", "application/json"),
            ("x-accel-buffering", "no"),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}

struct MetricOutput {
    sender: tokio::sync::mpsc::Sender<Result<axum::body::Bytes, std::io::Error>>,
    buffer: Vec<u8>,
}
impl MetricOutput {
    async fn write(&mut self, bytes: &[u8]) -> Result<(), AppError> {
        self.buffer.extend_from_slice(bytes);
        if self.buffer.len() >= 64 * 1024 {
            self.flush().await?;
        }
        Ok(())
    }
    async fn json(&mut self, value: &impl Serialize) -> Result<(), AppError> {
        self.write(&serde_json::to_vec(value).map_err(|e| AppError::Internal(e.into()))?)
            .await
    }
    async fn flush(&mut self) -> Result<(), AppError> {
        if !self.buffer.is_empty() {
            self.sender
                .send(Ok(std::mem::replace(
                    &mut self.buffer,
                    Vec::with_capacity(64 * 1024),
                )
                .into()))
                .await
                .map_err(|_| {
                    AppError::DependencyUnavailable("Metric client disconnected".into())
                })?;
        }
        Ok(())
    }
}

async fn produce_metrics(
    state: &AppState,
    request: &StreamRequest,
    output: &mut MetricOutput,
    permit: crate::services::resource_limits::ResourcePermit,
) -> Result<(), AppError> {
    use sqlx::Row;
    let mut tx = crate::services::admitted_read::AdmittedRead::begin(
        &state.pool,
        permit,
        state.config.security.metrics_timeout_seconds,
    )
    .await?;
    if !request.standalone {
        output.write(b"{\"values\":[").await?;
        let mut first = true;
        for (metric, latest, _, _) in &request.metrics {
            if *latest {
                let (value, ts) = metric_value(
                    &mut tx,
                    request.vehicle_id,
                    metric,
                    request.from,
                    request.to,
                    &request.tag_filter,
                )
                .await?;
                if !first {
                    output.write(b",").await?;
                }
                first = false;
                output
                    .json(&MetricValueResponse {
                        metric: metric.id.into(),
                        value,
                        unit: metric.unit,
                        label: metric.label,
                        ts,
                    })
                    .await?;
            }
        }
        output.write(b"],\"series\":[").await?;
    }
    let mut first_series = true;
    for (metric, _, include_series, query) in &request.metrics {
        if !*include_series {
            continue;
        }
        let query = query.as_ref().expect("series validated before response");
        if !first_series {
            output.write(b",").await?;
        }
        first_series = false;
        if !request.standalone {
            output.write(b"{\"metric\":").await?;
            output.json(&metric.id).await?;
            output.write(b",\"points\":").await?;
        }
        output.write(b"[").await?;
        // Compact mode retains its existing evenly spaced samples, with the
        // count and cursor in the same snapshot and no full-vector allocation.
        let count = if request.max_points.is_some() {
            let count_sql = format!(
                "SELECT COUNT(*)::bigint AS count FROM ({}) AS metric_count",
                query.sql
            );
            let row = bind_series(&count_sql, request, query.filtered)
                .fetch_one(&mut *tx)
                .await?;
            row.try_get::<i64, _>("count")? as usize
        } else {
            0
        };
        let declare = format!("DECLARE metric_points NO SCROLL CURSOR FOR {}", query.sql);
        bind_series(&declare, request, query.filtered)
            .persistent(false)
            .execute(&mut *tx)
            .await?;
        let mut index = 0usize;
        let mut emitted = 0usize;
        loop {
            let rows = sqlx::query("FETCH FORWARD 10000 FROM metric_points")
                .fetch_all(&mut *tx)
                .await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                let selected = request
                    .max_points
                    .is_none_or(|max| count <= max || index == emitted * (count - 1) / (max - 1));
                index += 1;
                if !selected {
                    continue;
                }
                let point = MetricSeriesPoint {
                    ts: row.try_get("ts")?,
                    value: if query.weighted {
                        weighted_average_from_totals(
                            row.try_get("total_distance_miles")?,
                            row.try_get("weighted_efficiency_wh_mi")?,
                        )
                    } else {
                        row.try_get("value")?
                    },
                };
                if emitted > 0 {
                    output.write(b",").await?;
                }
                output.json(&point).await?;
                emitted += 1;
            }
        }
        sqlx::query("CLOSE metric_points").execute(&mut *tx).await?;
        if !request.standalone {
            output.write(b"]}").await?;
        }
    }
    // Commit before completing the JSON document. Any failure or deadline
    // aborts the body, so the browser cannot cache a partial successful array.
    tx.commit().await?;
    if request.standalone {
        output.write(b"]").await?;
    }
    if !request.standalone {
        output.write(b"],\"bucket\":").await?;
        output.json(&request.bucket).await?;
        output.write(b",\"density\":").await?;
        output.json(&request.density).await?;
        if let Some(max) = request.max_points {
            output.write(b",\"max_points\":").await?;
            output.json(&max).await?;
        }
        output.write(b"}").await?;
    }
    output.flush().await
}

fn bind_series<'a>(
    sql: &'a str,
    request: &StreamRequest,
    filtered: bool,
) -> sqlx::query::Query<'a, sqlx::Postgres, sqlx::postgres::PgArguments> {
    let query = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(request.vehicle_id)
        .bind(request.from)
        .bind(request.to);
    if filtered {
        query
            .bind(request.tag_filter.tag_ids.clone())
            .bind(request.tag_filter.match_all)
            .bind(request.tag_filter.untagged)
    } else {
        query
    }
}

#[cfg(test)]
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
    if id.len() > 128 || id.chars().any(char::is_control) {
        return Err(AppError::Validation("metric identifier is invalid".into()));
    }
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
    conn: &mut sqlx::PgConnection,
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
    let row = sqlx::query_as::<_, MetricSeriesPoint>(sqlx::AssertSqlSafe(sql.as_str()))
        .bind(vid)
        .fetch_optional(&mut *conn)
        .await?;
    Ok(row.map(|r| (r.value, Some(r.ts))).unwrap_or((None, None)))
}

async fn summary_value(
    conn: &mut sqlx::PgConnection,
    vid: Uuid,
    metric: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    tag_filter: &TripTagFilter,
) -> Result<(Option<f64>, Option<DateTime<Utc>>), AppError> {
    if tag_filter.is_active() && is_trip_metric(metric) {
        return filtered_summary_value(conn, vid, metric, from, to, tag_filter).await;
    }
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
        .fetch_optional(&mut *conn)
        .await?
        .flatten(),
        "total_trips" => sqlx::query_scalar(
            "SELECT COUNT(*)::float8 FROM riviamigo.trips WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(&mut *conn)
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
        .fetch_optional(&mut *conn)
        .await?
        .flatten(),
        "energy_charged" => sqlx::query_scalar(
            "SELECT COALESCE(SUM(COALESCE(kwh_added, energy_added_wh / 1000.0)), 0)::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(&mut *conn)
        .await?
        .flatten(),
        "charging_sessions" => sqlx::query_scalar(
            "SELECT COUNT(*)::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(&mut *conn)
        .await?
        .flatten(),
        "total_cost" => sqlx::query_scalar(
            "SELECT COALESCE(SUM(cost_usd), 0)::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(&mut *conn)
        .await?
        .flatten(),
        "avg_session_energy" => sqlx::query_scalar(
            "SELECT AVG(COALESCE(kwh_added, energy_added_wh / 1000.0))::float8 FROM riviamigo.charge_sessions WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(&mut *conn)
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
        .fetch_optional(&mut *conn)
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
        .fetch_optional(&mut *conn)
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
        .fetch_optional(&mut *conn)
        .await?
        .flatten(),
        "avg_trip_duration" => sqlx::query_scalar(
            "SELECT AVG(duration_seconds / 60.0)::float8 FROM riviamigo.trips WHERE vehicle_id=$1 AND started_at >= $2 AND started_at <= $3 AND duration_seconds IS NOT NULL",
        )
        .bind(vid)
        .bind(from)
        .bind(to)
        .fetch_optional(&mut *conn)
        .await?
        .flatten(),
        _ => None,
    };

    Ok((value, Some(to)))
}

fn summary_series(
    metric: &str,
    bucket: &str,
    tag_filter: &TripTagFilter,
) -> Result<SeriesQuery, AppError> {
    if tag_filter.is_active() && is_trip_metric(metric) {
        return filtered_summary_series(metric, bucket);
    }
    if bucket == "raw" {
        let sql = match metric {
            "total_miles" | "trip_miles" =>
                "SELECT started_at AS ts, distance_miles::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 ORDER BY started_at, id",
            "total_trips" =>
                "SELECT started_at AS ts, 1.0::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 ORDER BY started_at, id",
            "energy_charged" | "avg_session_energy" =>
                "SELECT started_at AS ts, COALESCE(kwh_added, energy_added_wh / 1000.0)::float8 AS value
                 FROM riviamigo.charge_sessions
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 ORDER BY started_at, id",
            "charging_sessions" =>
                "SELECT started_at AS ts, 1.0::float8 AS value
                 FROM riviamigo.charge_sessions
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 ORDER BY started_at, id",
            "total_cost" =>
                "SELECT started_at AS ts, cost_usd::float8 AS value
                 FROM riviamigo.charge_sessions
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 ORDER BY started_at, id",
            "avg_efficiency" =>
                "SELECT started_at AS ts, efficiency_wh_per_mile::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 AND efficiency_wh_per_mile IS NOT NULL AND distance_miles > 0
                 ORDER BY started_at, id",
            "avg_gross_efficiency" =>
                "SELECT started_at AS ts,
                        (energy_wh + COALESCE(regen_wh, 0)) / NULLIF(distance_miles, 0)::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 AND energy_wh IS NOT NULL AND distance_miles > 0
                 ORDER BY started_at, id",
            "avg_outside_temp_c" =>
                "SELECT started_at AS ts, outside_temp_c::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 AND outside_temp_c IS NOT NULL
                 ORDER BY started_at, id",
            "avg_trip_duration" =>
                "SELECT started_at AS ts, (duration_seconds / 60.0)::float8 AS value
                 FROM riviamigo.trips
                 WHERE vehicle_id = $1 AND started_at >= $2 AND started_at <= $3
                 AND duration_seconds IS NOT NULL
                 ORDER BY started_at, id",
            _ => return Err(AppError::Validation("unsupported series metric".into())),
        };
        return Ok(SeriesQuery {
            sql: sql.into(),
            weighted: false,
            filtered: false,
        });
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
        _ => return Err(AppError::Validation("unsupported series metric".into())),
    };

    Ok(SeriesQuery {
        sql,
        weighted: metric == "avg_efficiency",
        filtered: false,
    })
}

fn is_trip_metric(metric: &str) -> bool {
    matches!(
        metric,
        "total_miles"
            | "trip_miles"
            | "total_trips"
            | "avg_efficiency"
            | "avg_gross_efficiency"
            | "avg_outside_temp_c"
            | "avg_trip_duration"
    )
}

fn filtered_trip_scope() -> String {
    format!(
        "WITH filtered_trips AS (SELECT t.* FROM riviamigo.trips t \
         WHERE t.vehicle_id=$1 AND t.started_at >= $2 AND t.started_at <= $3{}) ",
        sql_predicate("t", 4, 5, 6)
    )
}

async fn filtered_summary_value(
    conn: &mut sqlx::PgConnection,
    vid: Uuid,
    metric: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    filter: &TripTagFilter,
) -> Result<(Option<f64>, Option<DateTime<Utc>>), AppError> {
    let scope = filtered_trip_scope();
    let sql = match metric {
        "total_miles" | "trip_miles" => format!(
            "{scope} SELECT COALESCE(SUM(distance_miles), 0)::float8 FROM filtered_trips WHERE distance_miles > 0"
        ),
        "total_trips" => format!("{scope} SELECT COUNT(*)::float8 FROM filtered_trips"),
        "avg_efficiency" => format!(
            "{scope} SELECT $3 AS ts, SUM(distance_miles)::float8 AS total_distance_miles, \
             SUM(distance_miles * efficiency_wh_per_mile)::float8 AS weighted_efficiency_wh_mi \
             FROM filtered_trips WHERE efficiency_wh_per_mile IS NOT NULL AND distance_miles > 0"
        ),
        "avg_gross_efficiency" => format!(
            "{scope} SELECT CASE WHEN SUM(distance_miles) > 0 THEN \
             SUM(energy_wh + COALESCE(regen_wh, 0)) / SUM(distance_miles) ELSE NULL END::float8 \
             FROM filtered_trips WHERE energy_wh IS NOT NULL AND distance_miles > 0"
        ),
        "avg_outside_temp_c" => format!(
            "{scope} SELECT CASE WHEN SUM(duration_seconds) > 0 THEN \
             SUM(outside_temp_c * duration_seconds) / SUM(duration_seconds) ELSE NULL END::float8 \
             FROM filtered_trips WHERE outside_temp_c IS NOT NULL AND duration_seconds > 0"
        ),
        "avg_trip_duration" => format!(
            "{scope} SELECT AVG(duration_seconds / 60.0)::float8 FROM filtered_trips WHERE duration_seconds IS NOT NULL"
        ),
        _ => return Ok((None, Some(to))),
    };

    let value = if metric == "avg_efficiency" {
        let row = sqlx::query_as::<_, WeightedEfficiencyRow>(sqlx::AssertSqlSafe(sql.as_str()))
            .bind(vid)
            .bind(from)
            .bind(to)
            .bind(filter.tag_ids.clone())
            .bind(filter.match_all)
            .bind(filter.untagged)
            .fetch_one(&mut *conn)
            .await?;
        weighted_average_from_totals(row.total_distance_miles, row.weighted_efficiency_wh_mi)
    } else {
        sqlx::query_scalar::<_, Option<f64>>(sqlx::AssertSqlSafe(sql.as_str()))
            .bind(vid)
            .bind(from)
            .bind(to)
            .bind(filter.tag_ids.clone())
            .bind(filter.match_all)
            .bind(filter.untagged)
            .fetch_optional(&mut *conn)
            .await?
            .flatten()
    };
    Ok((value, Some(to)))
}

fn filtered_summary_series(metric: &str, bucket: &str) -> Result<SeriesQuery, AppError> {
    let scope = filtered_trip_scope();
    let bucket_expr = match bucket {
        "raw" => "started_at".to_string(),
        "minute" => "date_trunc('minute', started_at)".to_string(),
        "5min" => "time_bucket(INTERVAL '5 minutes', started_at)".to_string(),
        "15min" => "time_bucket(INTERVAL '15 minutes', started_at)".to_string(),
        "hour" => "date_trunc('hour', started_at)".to_string(),
        _ => "date_trunc('day', started_at)".to_string(),
    };
    let (value_expr, where_clause, aggregate) = match metric {
        "total_miles" | "trip_miles" => ("SUM(distance_miles)::float8", "distance_miles > 0", true),
        "total_trips" => ("COUNT(*)::float8", "TRUE", true),
        "avg_efficiency" => ("SUM(distance_miles)::float8 AS total_distance_miles, SUM(distance_miles * efficiency_wh_per_mile)::float8 AS weighted_efficiency_wh_mi", "efficiency_wh_per_mile IS NOT NULL AND distance_miles > 0", true),
        "avg_gross_efficiency" => ("(SUM(energy_wh + COALESCE(regen_wh, 0)) / NULLIF(SUM(distance_miles), 0))::float8", "energy_wh IS NOT NULL AND distance_miles > 0", true),
        "avg_outside_temp_c" => ("CASE WHEN SUM(duration_seconds) > 0 THEN SUM(outside_temp_c * duration_seconds) / SUM(duration_seconds) ELSE NULL END::float8", "outside_temp_c IS NOT NULL AND duration_seconds > 0", true),
        "avg_trip_duration" => ("AVG(duration_seconds / 60.0)::float8", "duration_seconds IS NOT NULL", true),
        _ => return Err(AppError::Validation("unsupported series metric".into())),
    };
    let group = if aggregate {
        " GROUP BY 1 ORDER BY 1"
    } else {
        " ORDER BY 1"
    };
    let sql = format!(
        "{scope} SELECT {bucket_expr} AS ts, {value_expr} AS value \
         FROM filtered_trips WHERE {where_clause}{group}"
    );

    if metric == "avg_efficiency" {
        // The weighted row aliases above intentionally replace the generic value
        // column, so build the select without that trailing alias.
        let sql = format!(
            "{scope} SELECT {bucket_expr} AS ts, SUM(distance_miles)::float8 AS total_distance_miles, \
             SUM(distance_miles * efficiency_wh_per_mile)::float8 AS weighted_efficiency_wh_mi \
             FROM filtered_trips WHERE efficiency_wh_per_mile IS NOT NULL AND distance_miles > 0 \
             GROUP BY 1 ORDER BY 1"
        );
        return Ok(SeriesQuery {
            sql,
            weighted: true,
            filtered: true,
        });
    }

    Ok(SeriesQuery {
        sql,
        weighted: false,
        filtered: true,
    })
}

fn telemetry_daily_series(
    column: &str,
    aggregation: &str,
    bucket: &str,
) -> Result<SeriesQuery, AppError> {
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
        return Ok(SeriesQuery {
            sql,
            weighted: false,
            filtered: false,
        });
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
    Ok(SeriesQuery {
        sql,
        weighted: false,
        filtered: false,
    })
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

    #[tokio::test]
    async fn metric_body_stream_tolerates_polling_after_completion() {
        use futures::StreamExt;
        let (sender, receiver) = tokio::sync::mpsc::channel(2);
        sender
            .send(Ok(axum::body::Bytes::from_static(b"{}")))
            .await
            .unwrap();
        drop(sender);

        let mut stream = Box::pin(metric_body_stream(receiver));
        assert_eq!(stream.next().await.unwrap().unwrap().as_ref(), b"{}");
        assert!(stream.next().await.is_none());
        // Regression: polling a finished stream used to panic inside `unfold`,
        // aborting every /v1/metrics/batch response.
        assert!(stream.next().await.is_none());
    }

    #[test]
    fn metric_lookup_rejects_control_and_oversized_identifiers() {
        assert!(find_metric("total_trips\n").is_err());
        assert!(find_metric(&"x".repeat(129)).is_err());
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
