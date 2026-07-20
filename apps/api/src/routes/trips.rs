use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use tracing::debug;
use uuid::Uuid;

use crate::{
    db::vehicles::require_vehicle_owned,
    errors::AppError,
    middleware::auth::{require_vehicle_access, AppState, AuthUser},
    services::trip_routes::build_route_preview,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/trips", get(list_trips))
        .route("/trips/{id}", get(get_trip))
        .route("/trips/{id}/detail", get(get_trip_detail))
        .route("/trips/{id}/track", get(get_track))
        .route("/trips/{id}/speed", get(get_speed_profile))
        .route("/trips/{id}/elevation", get(get_elevation_profile))
        .route("/trips/{id}/power", get(get_power_profile))
        .route("/trips/{id}/series", get(get_trip_series))
        .route("/trips/map", get(get_trip_map))
        .route(
            "/vehicles/{vehicle_id}/drives/{id}/power",
            get(get_power_profile_path),
        )
}

#[derive(Deserialize)]
struct TripListParams {
    vehicle_id: Option<Uuid>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
    lifetime: Option<bool>,
    limit: Option<i64>,
    offset: Option<i64>,
    page: Option<i64>,
    per_page: Option<i64>,
    search: Option<String>,
}

#[cfg(test)]
mod timeframe_tests {
    use chrono::{TimeZone, Utc};

    #[test]
    fn lifetime_time_bounds_use_epoch_instead_of_default_window() {
        let to = Utc.with_ymd_and_hms(2026, 7, 2, 12, 0, 0).unwrap();
        let (from, resolved_to) = super::resolve_time_bounds(None, Some(to), true, 90);

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

#[derive(Deserialize)]
struct VehicleParam {
    vehicle_id: Option<Uuid>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct TripRow {
    id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    duration_seconds: Option<i32>,
    distance_miles: Option<f64>,
    efficiency_wh_per_mile: Option<f64>,
    max_speed_mph: Option<f64>,
    drive_mode: Option<String>,
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    start_lat: Option<f64>,
    start_lng: Option<f64>,
    end_lat: Option<f64>,
    end_lng: Option<f64>,
    start_place: Option<String>,
    end_place: Option<String>,
    start_address: Option<String>,
    end_address: Option<String>,
    outside_temp_c: Option<f64>,
    outside_temp_source: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct TripMapRow {
    id: Uuid,
    vehicle_id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    route_preview: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize, sqlx::FromRow)]
struct TrackPoint {
    ts: DateTime<Utc>,
    lat: Option<f64>,
    lng: Option<f64>,
    speed_mph: Option<f64>,
    altitude_m: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct TripWindowRow {
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    duration_seconds: Option<i32>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct SpeedProfileRow {
    elapsed_s: f64,
    speed_mph: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ElevationPointRow {
    ts: DateTime<Utc>,
    value: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct PowerProfileRow {
    ts: DateTime<Utc>,
    power_kw: Option<f64>,
    regen_power_kw: Option<f64>,
    speed_mph: Option<f64>,
    battery_level: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct TripPowerTelemetryRow {
    ts: DateTime<Utc>,
    battery_level: Option<f64>,
    battery_capacity_wh: Option<f64>,
    power_kw: Option<f64>,
    regen_power_kw: Option<f64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TripPowerSource {
    Direct,
    EstimatedSoc,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TripPowerMetadata {
    source: TripPowerSource,
    sample_count: usize,
    median_interval_seconds: Option<f64>,
    p90_interval_seconds: Option<f64>,
    coverage_percent: Option<f64>,
}

#[derive(Debug, Clone)]
struct TripPowerInterval {
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    net_power_kw: f64,
}

#[derive(Debug, Clone)]
struct TripPowerData {
    metadata: TripPowerMetadata,
    intervals: Vec<TripPowerInterval>,
}

impl TripPowerData {
    fn estimated_at(&self, ts: DateTime<Utc>) -> Option<f64> {
        if !matches!(self.metadata.source, TripPowerSource::EstimatedSoc) {
            return None;
        }
        self.intervals
            .iter()
            .find(|interval| ts >= interval.started_at && ts < interval.ended_at)
            .map(|interval| interval.net_power_kw)
    }

    fn source(&self) -> TripPowerSource {
        self.metadata.source
    }
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct TripSeriesRow {
    ts: DateTime<Utc>,
    speed_mph: Option<f64>,
    power_kw: Option<f64>,
    regen_power_kw: Option<f64>,
    battery_level: Option<f64>,
    outside_temp_c: Option<f64>,
    cabin_temp_c: Option<f64>,
    driver_temp_c: Option<f64>,
    hvac_active: Option<bool>,
    tire_fl_psi: Option<f64>,
    tire_fr_psi: Option<f64>,
    tire_rl_psi: Option<f64>,
    tire_rr_psi: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct TripDetailSamples {
    elapsed_s: Vec<i32>,
    lat: Vec<Option<f64>>,
    lng: Vec<Option<f64>>,
    altitude_m: Vec<Option<f64>>,
    speed_mph: Vec<Option<f64>>,
    power_kw: Vec<Option<f64>>,
    regen_power_kw: Vec<Option<f64>>,
    estimated_net_power_kw: Vec<Option<f64>>,
    battery_level: Vec<Option<f64>>,
    outside_temp_c: Vec<Option<f64>>,
    cabin_temp_c: Vec<Option<f64>>,
    driver_temp_c: Vec<Option<f64>>,
    hvac_active: Vec<Option<bool>>,
    tire_fl_psi: Vec<Option<f64>>,
    tire_fr_psi: Vec<Option<f64>>,
    tire_rl_psi: Vec<Option<f64>>,
    tire_rr_psi: Vec<Option<f64>>,
}

#[derive(Debug, Serialize)]
struct TripDetailResponse {
    trip: TripRow,
    sample_interval_seconds: i32,
    samples: TripDetailSamples,
    power: TripPowerMetadata,
    outside_temperature: OutsideTemperatureResponse,
}

#[derive(Debug, Serialize, Deserialize)]
struct TripDetailCachePayload {
    samples: TripDetailSamples,
    power: TripPowerMetadata,
}

#[derive(Debug, Serialize)]
struct OutsideTemperatureResponse {
    source: String,
    attribution: Option<OutsideTemperatureAttribution>,
    samples: Vec<OutsideTemperatureSample>,
}

#[derive(Debug, Serialize)]
struct OutsideTemperatureAttribution {
    name: &'static str,
    url: &'static str,
}

#[derive(Debug, Serialize)]
struct OutsideTemperatureSample {
    elapsed_s: i32,
    ts: DateTime<Utc>,
    temperature_c: f64,
    source: &'static str,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct TripWeatherRow {
    sampled_at: DateTime<Utc>,
    elapsed_seconds: i32,
    temperature_c: f64,
}

#[derive(Debug, Serialize)]
struct TripMapRoute {
    trip_id: Uuid,
    coordinates: Vec<[f64; 2]>,
}

#[derive(Debug, Serialize)]
struct TripMapResponse {
    vehicle_id: Uuid,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    total_trips: usize,
    missing_route_count: usize,
    routes: Vec<TripMapRoute>,
}

#[derive(Debug, sqlx::FromRow)]
struct DetailSampleRow {
    bucket_ts: DateTime<Utc>,
    elapsed_s: i32,
    lat: Option<f64>,
    lng: Option<f64>,
    altitude_m: Option<f64>,
    speed_mph: Option<f64>,
    power_kw: Option<f64>,
    regen_power_kw: Option<f64>,
    battery_level: Option<f64>,
    outside_temp_c: Option<f64>,
    cabin_temp_c: Option<f64>,
    driver_temp_c: Option<f64>,
    hvac_active: Option<bool>,
    tire_fl_psi: Option<f64>,
    tire_fr_psi: Option<f64>,
    tire_rl_psi: Option<f64>,
    tire_rr_psi: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct RouteTelemetryRow {
    trip_id: Uuid,
    lat: f64,
    lng: f64,
}

fn finite_value(value: Option<f64>) -> Option<f64> {
    value.filter(|candidate| candidate.is_finite())
}

fn normalize_capacity_wh(value: Option<f64>) -> Option<f64> {
    let value = finite_value(value)?;
    if (40.0..=250.0).contains(&value) {
        Some(value * 1_000.0)
    } else if (40_000.0..=250_000.0).contains(&value) {
        Some(value)
    } else {
        None
    }
}

fn percentile(values: &[f64], percentile: f64) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    if sorted.len() == 1 {
        return sorted.first().copied();
    }
    let position = percentile.clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    if lower == upper {
        return sorted.get(lower).copied();
    }
    let fraction = position - lower as f64;
    Some(sorted[lower] + (sorted[upper] - sorted[lower]) * fraction)
}

fn derive_soc_power(rows: &[TripPowerTelemetryRow], trip_duration_seconds: i32) -> TripPowerData {
    let direct_sample_count = rows
        .iter()
        .filter(|row| {
            finite_value(row.power_kw).is_some() || finite_value(row.regen_power_kw).is_some()
        })
        .count();
    if direct_sample_count >= 2 {
        return TripPowerData {
            metadata: TripPowerMetadata {
                source: TripPowerSource::Direct,
                sample_count: direct_sample_count,
                median_interval_seconds: None,
                p90_interval_seconds: None,
                coverage_percent: None,
            },
            intervals: Vec::new(),
        };
    }

    let capacity_wh = percentile(
        &rows
            .iter()
            .filter_map(|row| normalize_capacity_wh(row.battery_capacity_wh))
            .collect::<Vec<_>>(),
        0.5,
    );
    let Some(capacity_wh) = capacity_wh else {
        return TripPowerData {
            metadata: TripPowerMetadata {
                source: TripPowerSource::Unavailable,
                sample_count: 0,
                median_interval_seconds: None,
                p90_interval_seconds: None,
                coverage_percent: None,
            },
            intervals: Vec::new(),
        };
    };

    let mut soc_points = Vec::<(DateTime<Utc>, f64)>::new();
    for row in rows {
        let Some(soc) =
            finite_value(row.battery_level).filter(|value| (0.0..=100.0).contains(value))
        else {
            continue;
        };
        if soc_points
            .last()
            .map(|(_, previous)| (soc - *previous).abs() > 1e-6)
            .unwrap_or(true)
        {
            soc_points.push((row.ts, soc));
        }
    }

    let mut intervals = Vec::new();
    let mut interval_seconds = Vec::new();
    for pair in soc_points.windows(2) {
        let (started_at, start_soc) = pair[0];
        let (ended_at, end_soc) = pair[1];
        let elapsed_seconds = (ended_at - started_at).num_milliseconds() as f64 / 1_000.0;
        let soc_delta = start_soc - end_soc;
        if !(2.0..=300.0).contains(&elapsed_seconds) || !(0.05..=0.5).contains(&soc_delta.abs()) {
            continue;
        }
        let net_power_kw =
            (soc_delta / 100.0 * capacity_wh) / (elapsed_seconds / 3_600.0) / 1_000.0;
        if !net_power_kw.is_finite() || net_power_kw.abs() > 750.0 {
            continue;
        }
        intervals.push(TripPowerInterval {
            started_at,
            ended_at,
            net_power_kw,
        });
        interval_seconds.push(elapsed_seconds);
    }

    if intervals.is_empty() {
        return TripPowerData {
            metadata: TripPowerMetadata {
                source: TripPowerSource::Unavailable,
                sample_count: 0,
                median_interval_seconds: None,
                p90_interval_seconds: None,
                coverage_percent: None,
            },
            intervals,
        };
    }

    let covered_seconds = interval_seconds.iter().sum::<f64>();
    let duration_seconds = f64::from(trip_duration_seconds.max(1));
    TripPowerData {
        metadata: TripPowerMetadata {
            source: TripPowerSource::EstimatedSoc,
            sample_count: intervals.len(),
            median_interval_seconds: percentile(&interval_seconds, 0.5),
            p90_interval_seconds: percentile(&interval_seconds, 0.9),
            coverage_percent: Some((covered_seconds / duration_seconds * 100.0).clamp(0.0, 100.0)),
        },
        intervals,
    }
}

async fn load_trip_power_data(
    pool: &sqlx::PgPool,
    vehicle_id: Uuid,
    trip_id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    duration_seconds: i32,
) -> Result<TripPowerData, AppError> {
    let rows = sqlx::query_as::<_, TripPowerTelemetryRow>(
        r#"SELECT ts, battery_level, battery_capacity_wh, power_kw, regen_power_kw
           FROM timeseries.telemetry
           WHERE vehicle_id=$1 AND ts>=$3 AND ts<=$4
             AND (trip_id=$2 OR trip_id IS NULL)
           ORDER BY ts"#,
    )
    .bind(vehicle_id)
    .bind(trip_id)
    .bind(started_at)
    .bind(ended_at)
    .fetch_all(pool)
    .await?;

    Ok(derive_soc_power(&rows, duration_seconds))
}

async fn list_trips(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<TripListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 90);
    let limit = p.per_page.or(p.limit).unwrap_or(50).clamp(1, 200);
    let page = p.page.unwrap_or(1).max(1);
    let offset = p.offset.unwrap_or((page - 1) * limit).max(0);
    let search = p
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|v| v.replace('%', "\\%").replace('_', "\\_"));

    let mut tx = state.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;

    let rows = sqlx::query_as::<_, TripRow>(
        "SELECT t.id, t.started_at, t.ended_at, t.duration_seconds, t.distance_miles, \
                t.efficiency_wh_per_mile, t.max_speed_mph, t.drive_mode, t.soc_start, t.soc_end, \
                t.start_lat, t.start_lng, t.end_lat, t.end_lng, \
                COALESCE(sg.name, NULLIF(CONCAT_WS(', ', sa.road, sa.city), '')) AS start_place, \
                COALESCE(eg.name, NULLIF(CONCAT_WS(', ', ea.road, ea.city), '')) AS end_place, \
                sa.display_name AS start_address, ea.display_name AS end_address, \
                t.outside_temp_c AS outside_temp_c, t.outside_temp_source AS outside_temp_source \
         FROM riviamigo.trips t \
         LEFT JOIN riviamigo.trip_user_annotations tua ON tua.trip_id = t.id AND tua.user_id = $7 \
         LEFT JOIN riviamigo.geofences sg ON sg.id = COALESCE(tua.start_geofence_id, t.start_geofence_id) \
         LEFT JOIN riviamigo.geofences eg ON eg.id = COALESCE(tua.end_geofence_id, t.end_geofence_id) \
         LEFT JOIN riviamigo.addresses sa ON sa.id = COALESCE(tua.start_address_id, t.start_address_id) \
         LEFT JOIN riviamigo.addresses ea ON ea.id = COALESCE(tua.end_address_id, t.end_address_id) \
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3 \
         AND ($6::text IS NULL OR \
              COALESCE(sg.name, '') ILIKE '%' || $6 || '%' ESCAPE '\\' OR \
              COALESCE(eg.name, '') ILIKE '%' || $6 || '%' ESCAPE '\\' OR \
              COALESCE(sa.display_name, '') ILIKE '%' || $6 || '%' ESCAPE '\\' OR \
              COALESCE(ea.display_name, '') ILIKE '%' || $6 || '%' ESCAPE '\\' OR \
              COALESCE(CONCAT_WS(', ', sa.road, sa.city), '') ILIKE '%' || $6 || '%' ESCAPE '\\' OR \
              COALESCE(CONCAT_WS(', ', ea.road, ea.city), '') ILIKE '%' || $6 || '%' ESCAPE '\\') \
         ORDER BY t.started_at DESC LIMIT $4 OFFSET $5",
    )
    .bind(vid)
    .bind(from)
    .bind(to)
    .bind(limit)
    .bind(offset)
    .bind(search.as_deref())
    .bind(auth.user_id)
    .fetch_all(&mut *tx)
    .await?;

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) \
         FROM riviamigo.trips t \
         LEFT JOIN riviamigo.trip_user_annotations tua ON tua.trip_id = t.id AND tua.user_id = $5 \
         LEFT JOIN riviamigo.geofences sg ON sg.id = COALESCE(tua.start_geofence_id, t.start_geofence_id) \
         LEFT JOIN riviamigo.geofences eg ON eg.id = COALESCE(tua.end_geofence_id, t.end_geofence_id) \
         LEFT JOIN riviamigo.addresses sa ON sa.id = COALESCE(tua.start_address_id, t.start_address_id) \
         LEFT JOIN riviamigo.addresses ea ON ea.id = COALESCE(tua.end_address_id, t.end_address_id) \
         WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3 \
         AND ($4::text IS NULL OR \
              COALESCE(sg.name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR \
              COALESCE(eg.name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR \
              COALESCE(sa.display_name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR \
              COALESCE(ea.display_name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR \
              COALESCE(CONCAT_WS(', ', sa.road, sa.city), '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR \
              COALESCE(CONCAT_WS(', ', ea.road, ea.city), '') ILIKE '%' || $4 || '%' ESCAPE '\\')",
    )
    .bind(vid)
    .bind(from)
    .bind(to)
    .bind(search.as_deref())
    .bind(auth.user_id)
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

async fn get_trip(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<TripRow>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let row = sqlx::query_as::<_, TripRow>(
        "SELECT t.id, t.started_at, t.ended_at, t.duration_seconds, t.distance_miles, \
                t.efficiency_wh_per_mile, t.max_speed_mph, t.drive_mode, t.soc_start, t.soc_end, \
                t.start_lat, t.start_lng, t.end_lat, t.end_lng, \
                COALESCE(sg.name, NULLIF(CONCAT_WS(', ', sa.road, sa.city), '')) AS start_place, \
                COALESCE(eg.name, NULLIF(CONCAT_WS(', ', ea.road, ea.city), '')) AS end_place, \
                sa.display_name AS start_address, ea.display_name AS end_address, \
                t.outside_temp_c AS outside_temp_c, t.outside_temp_source AS outside_temp_source \
         FROM riviamigo.trips t \
         LEFT JOIN riviamigo.trip_user_annotations tua ON tua.trip_id = t.id AND tua.user_id = $3 \
         LEFT JOIN riviamigo.geofences sg ON sg.id = COALESCE(tua.start_geofence_id, t.start_geofence_id) \
         LEFT JOIN riviamigo.geofences eg ON eg.id = COALESCE(tua.end_geofence_id, t.end_geofence_id) \
         LEFT JOIN riviamigo.addresses sa ON sa.id = COALESCE(tua.start_address_id, t.start_address_id) \
         LEFT JOIN riviamigo.addresses ea ON ea.id = COALESCE(tua.end_address_id, t.end_address_id) \
            WHERE t.id=$1 AND t.vehicle_id=$2",
    )
    .bind(id)
    .bind(vid)
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(row))
}

async fn get_trip_map(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(p): Query<TripListParams>,
) -> Result<Json<TripMapResponse>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;
    let (from, to) = resolve_time_bounds(p.from, p.to, p.lifetime.unwrap_or(false), 90);
    let search = p
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|v| v.replace('%', "\\%").replace('_', "\\_"));

    let rows = sqlx::query_as::<_, TripMapRow>(
        r#"SELECT t.id, t.vehicle_id, t.started_at, t.ended_at, t.route_preview
           FROM riviamigo.trips t
           LEFT JOIN riviamigo.trip_user_annotations tua ON tua.trip_id = t.id AND tua.user_id = $5
           LEFT JOIN riviamigo.geofences sg ON sg.id = COALESCE(tua.start_geofence_id, t.start_geofence_id)
           LEFT JOIN riviamigo.geofences eg ON eg.id = COALESCE(tua.end_geofence_id, t.end_geofence_id)
           LEFT JOIN riviamigo.addresses sa ON sa.id = COALESCE(tua.start_address_id, t.start_address_id)
           LEFT JOIN riviamigo.addresses ea ON ea.id = COALESCE(tua.end_address_id, t.end_address_id)
           WHERE t.vehicle_id=$1 AND t.started_at>=$2 AND t.started_at<=$3
             AND ($4::text IS NULL OR
                  COALESCE(sg.name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR
                  COALESCE(eg.name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR
                  COALESCE(sa.display_name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR
                  COALESCE(ea.display_name, '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR
                  COALESCE(CONCAT_WS(', ', sa.road, sa.city), '') ILIKE '%' || $4 || '%' ESCAPE '\\' OR
                  COALESCE(CONCAT_WS(', ', ea.road, ea.city), '') ILIKE '%' || $4 || '%' ESCAPE '\\')
           ORDER BY t.started_at DESC"#,
    )
    .bind(vid)
    .bind(from)
    .bind(to)
    .bind(search.as_deref())
    .bind(auth.user_id)
    .fetch_all(&state.pool)
    .await?;

    let mut route_by_id = std::collections::HashMap::<Uuid, Vec<[f64; 2]>>::new();
    let mut missing = Vec::new();
    for row in &rows {
        match row
            .route_preview
            .as_ref()
            .and_then(|value| serde_json::from_value::<Vec<[f64; 2]>>(value.clone()).ok())
            .filter(|points| points.len() > 1)
        {
            Some(points) => {
                route_by_id.insert(row.id, points);
            }
            None => missing.push(row.id),
        }
    }

    if !missing.is_empty() {
        let missing_ids = missing
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>();
        let linked = sqlx::query_as::<_, RouteTelemetryRow>(
            r#"SELECT trip_id, latitude AS lat, longitude AS lng
               FROM timeseries.telemetry
               WHERE trip_id = ANY($1)
                 AND latitude IS NOT NULL AND longitude IS NOT NULL
                 AND NOT (latitude = 0 AND longitude = 0)
               ORDER BY trip_id, ts"#,
        )
        .bind(&missing)
        .fetch_all(&state.pool)
        .await?;

        let mut points_by_id = std::collections::HashMap::<Uuid, Vec<(f64, f64)>>::new();
        for point in linked {
            points_by_id
                .entry(point.trip_id)
                .or_default()
                .push((point.lat, point.lng));
        }

        for row in rows.iter().filter(|row| missing_ids.contains(&row.id)) {
            let mut points = points_by_id.remove(&row.id).unwrap_or_default();
            if points.len() < 2 {
                let fallback = sqlx::query_as::<_, (f64, f64)>(
                    r#"SELECT latitude, longitude
                       FROM timeseries.telemetry
                       WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$3
                         AND latitude IS NOT NULL AND longitude IS NOT NULL
                         AND NOT (latitude = 0 AND longitude = 0)
                       ORDER BY ts LIMIT 5000"#,
                )
                .bind(row.vehicle_id)
                .bind(row.started_at)
                .bind(row.ended_at)
                .fetch_all(&state.pool)
                .await?;
                points = fallback;
            }

            let preview = build_route_preview(&points);
            if preview.len() > 1 {
                route_by_id.insert(row.id, preview.clone());
                let preview_json = serde_json::to_value(&preview)
                    .map_err(|error| AppError::Internal(anyhow::anyhow!(error)))?;
                sqlx::query(
                    "UPDATE riviamigo.trips SET route_preview=$2, route_preview_version=1 WHERE id=$1",
                )
                .bind(row.id)
                .bind(preview_json)
                .execute(&state.pool)
                .await?;
            }
        }
    }

    let routes = rows
        .iter()
        .filter_map(|row| {
            route_by_id.remove(&row.id).map(|coordinates| TripMapRoute {
                trip_id: row.id,
                coordinates,
            })
        })
        .collect::<Vec<_>>();
    let missing_route_count = rows.len().saturating_sub(routes.len());

    debug!(
        vehicle_id = %vid,
        total_trips = rows.len(),
        route_count = routes.len(),
        missing_route_count,
        "trips.map_data"
    );

    Ok(Json(TripMapResponse {
        vehicle_id: vid,
        from,
        to,
        total_trips: rows.len(),
        missing_route_count,
        routes,
    }))
}

async fn get_trip_detail(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<TripDetailResponse>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let trip = sqlx::query_as::<_, TripRow>(
        "SELECT t.id, t.started_at, t.ended_at, t.duration_seconds, t.distance_miles, \
                t.efficiency_wh_per_mile, t.max_speed_mph, t.drive_mode, t.soc_start, t.soc_end, \
                t.start_lat, t.start_lng, t.end_lat, t.end_lng, \
                COALESCE(sg.name, NULLIF(CONCAT_WS(', ', sa.road, sa.city), '')) AS start_place, \
                COALESCE(eg.name, NULLIF(CONCAT_WS(', ', ea.road, ea.city), '')) AS end_place, \
                sa.display_name AS start_address, ea.display_name AS end_address, \
                t.outside_temp_c AS outside_temp_c, t.outside_temp_source AS outside_temp_source \
         FROM riviamigo.trips t \
         LEFT JOIN riviamigo.trip_user_annotations tua ON tua.trip_id = t.id AND tua.user_id = $3 \
         LEFT JOIN riviamigo.geofences sg ON sg.id = COALESCE(tua.start_geofence_id, t.start_geofence_id) \
         LEFT JOIN riviamigo.geofences eg ON eg.id = COALESCE(tua.end_geofence_id, t.end_geofence_id) \
         LEFT JOIN riviamigo.addresses sa ON sa.id = COALESCE(tua.start_address_id, t.start_address_id) \
         LEFT JOIN riviamigo.addresses ea ON ea.id = COALESCE(tua.end_address_id, t.end_address_id) \
         WHERE t.id=$1 AND t.vehicle_id=$2",
    )
    .bind(id)
    .bind(vid)
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let duration_seconds = trip
        .duration_seconds
        .unwrap_or_else(|| (trip.ended_at - trip.started_at).num_seconds().max(0) as i32);
    let sample_interval_seconds = detail_bucket_seconds(duration_seconds);
    let weather_rows = sqlx::query_as::<_, TripWeatherRow>(
        "SELECT sampled_at, elapsed_seconds, temperature_c FROM riviamigo.trip_weather_samples WHERE trip_id=$1 ORDER BY sampled_at",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    let cache_key = format!("trips:detail:v3:{vid}:{id}:{sample_interval_seconds}");
    let mut redis_conn = state.redis.get_multiplexed_async_connection().await.ok();
    if let Some(conn) = redis_conn.as_mut() {
        let cached: Option<String> = conn.get(&cache_key).await.ok();
        if let Some(payload) = cached {
            if let Ok(cached) = serde_json::from_str::<TripDetailCachePayload>(&payload) {
                let mut samples = cached.samples;
                let raw_elapsed = raw_outside_elapsed(&samples);
                merge_weather_samples(&mut samples, &weather_rows);
                let outside_temperature =
                    build_outside_temperature(&trip, &samples, &weather_rows, &raw_elapsed);
                debug!(trip_id = %id, vehicle_id = %vid, cache_hit = true, "trips.detail_cache");
                return Ok(Json(TripDetailResponse {
                    trip,
                    sample_interval_seconds,
                    samples,
                    power: cached.power,
                    outside_temperature,
                }));
            }
        }
    }

    let rows = sqlx::query_as::<_, DetailSampleRow>(
        r#"SELECT time_bucket(make_interval(secs => $5), ts) AS bucket_ts,
                  EXTRACT(EPOCH FROM (time_bucket(make_interval(secs => $5), ts) - $3))::int AS elapsed_s,
                  last(latitude, ts) FILTER (WHERE latitude IS NOT NULL AND latitude <> 0) AS lat,
                  last(longitude, ts) FILTER (WHERE longitude IS NOT NULL AND longitude <> 0) AS lng,
                  last(altitude_m, ts) AS altitude_m,
                  avg(speed_mph) AS speed_mph,
                  avg(power_kw) AS power_kw,
                  avg(regen_power_kw) AS regen_power_kw,
                  avg(battery_level) AS battery_level,
                  avg(outside_temp_c) AS outside_temp_c,
                  avg(cabin_temp_c) AS cabin_temp_c,
                  avg(driver_temp_c) AS driver_temp_c,
                  bool_or(hvac_active) AS hvac_active,
                  avg(tire_fl_psi) AS tire_fl_psi,
                  avg(tire_fr_psi) AS tire_fr_psi,
                  avg(tire_rl_psi) AS tire_rl_psi,
                  avg(tire_rr_psi) AS tire_rr_psi
           FROM timeseries.telemetry
           WHERE vehicle_id=$1 AND ts>=$3 AND ts<=$4
             AND (trip_id=$2 OR trip_id IS NULL)
           GROUP BY 1
           ORDER BY 1
           LIMIT 2000"#,
    )
    .bind(vid)
    .bind(id)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .bind(sample_interval_seconds)
    .fetch_all(&state.pool)
    .await?;

    let power_data = load_trip_power_data(
        &state.pool,
        vid,
        id,
        trip.started_at,
        trip.ended_at,
        duration_seconds,
    )
    .await?;
    let mut samples = TripDetailSamples::default();
    for row in rows {
        samples.elapsed_s.push(row.elapsed_s);
        samples.lat.push(row.lat);
        samples.lng.push(row.lng);
        samples.altitude_m.push(row.altitude_m);
        samples.speed_mph.push(row.speed_mph);
        samples.power_kw.push(row.power_kw);
        samples.regen_power_kw.push(row.regen_power_kw);
        samples
            .estimated_net_power_kw
            .push(power_data.estimated_at(row.bucket_ts));
        samples.battery_level.push(row.battery_level);
        samples.outside_temp_c.push(row.outside_temp_c);
        samples.cabin_temp_c.push(row.cabin_temp_c);
        samples.driver_temp_c.push(row.driver_temp_c);
        samples.hvac_active.push(row.hvac_active);
        samples.tire_fl_psi.push(row.tire_fl_psi);
        samples.tire_fr_psi.push(row.tire_fr_psi);
        samples.tire_rl_psi.push(row.tire_rl_psi);
        samples.tire_rr_psi.push(row.tire_rr_psi);
    }

    let raw_elapsed = raw_outside_elapsed(&samples);
    merge_weather_samples(&mut samples, &weather_rows);
    let outside_temperature =
        build_outside_temperature(&trip, &samples, &weather_rows, &raw_elapsed);

    if let Some(conn) = redis_conn.as_mut() {
        let payload = TripDetailCachePayload {
            samples: samples.clone(),
            power: power_data.metadata.clone(),
        };
        if let Ok(payload) = serde_json::to_string(&payload) {
            let _: Result<(), redis::RedisError> =
                conn.set_ex(&cache_key, payload, 24 * 60 * 60).await;
        }
    }

    debug!(
        trip_id = %id,
        vehicle_id = %vid,
        cache_hit = false,
        sample_interval_seconds,
        point_count = samples.elapsed_s.len(),
        "trips.detail_data"
    );

    Ok(Json(TripDetailResponse {
        trip,
        sample_interval_seconds,
        samples,
        power: power_data.metadata,
        outside_temperature,
    }))
}

fn raw_outside_elapsed(samples: &TripDetailSamples) -> std::collections::HashSet<i32> {
    samples
        .elapsed_s
        .iter()
        .copied()
        .zip(samples.outside_temp_c.iter())
        .filter_map(|(elapsed, value)| value.map(|_| elapsed))
        .collect()
}

fn merge_weather_samples(samples: &mut TripDetailSamples, weather_rows: &[TripWeatherRow]) {
    if samples.elapsed_s.is_empty() {
        return;
    }
    for weather in weather_rows {
        let Some((index, _)) = samples
            .elapsed_s
            .iter()
            .enumerate()
            .min_by_key(|(_, elapsed)| (**elapsed - weather.elapsed_seconds).abs())
        else {
            continue;
        };
        if samples
            .outside_temp_c
            .get(index)
            .copied()
            .flatten()
            .is_none()
        {
            if let Some(value) = samples.outside_temp_c.get_mut(index) {
                *value = Some(weather.temperature_c);
            }
        }
    }
}

fn build_outside_temperature(
    trip: &TripRow,
    samples: &TripDetailSamples,
    weather_rows: &[TripWeatherRow],
    raw_elapsed: &std::collections::HashSet<i32>,
) -> OutsideTemperatureResponse {
    let source = trip.outside_temp_source.clone().unwrap_or_else(|| {
        if !raw_elapsed.is_empty() && !weather_rows.is_empty() {
            "mixed".into()
        } else if !raw_elapsed.is_empty() {
            "vehicle".into()
        } else if !weather_rows.is_empty() {
            "open_meteo".into()
        } else {
            "unavailable".into()
        }
    });
    let timeline_samples = samples
        .elapsed_s
        .iter()
        .enumerate()
        .filter_map(|(index, elapsed)| {
            let temperature_c = samples.outside_temp_c.get(index).copied().flatten()?;
            let matched_weather = weather_rows
                .iter()
                .min_by_key(|row| (row.elapsed_seconds - *elapsed).abs())
                .filter(|row| (row.elapsed_seconds - *elapsed).abs() <= 30);
            let sample_source = if raw_elapsed.contains(elapsed) {
                "vehicle"
            } else if matched_weather.is_some() {
                "open_meteo"
            } else {
                "vehicle"
            };
            Some(OutsideTemperatureSample {
                elapsed_s: *elapsed,
                ts: matched_weather
                    .map(|row| row.sampled_at)
                    .unwrap_or_else(|| {
                        trip.started_at + chrono::Duration::seconds(i64::from(*elapsed))
                    }),
                temperature_c,
                source: sample_source,
            })
        })
        .collect();
    OutsideTemperatureResponse {
        attribution: matches!(source.as_str(), "open_meteo" | "mixed").then_some(
            OutsideTemperatureAttribution {
                name: "Open-Meteo",
                url: "https://open-meteo.com/",
            },
        ),
        source,
        samples: timeline_samples,
    }
}

fn detail_bucket_seconds(duration_seconds: i32) -> i32 {
    let target = (duration_seconds.max(1) as f64 / 1_500.0).ceil().max(1.0);
    let exponent = target.log10().floor() as i32;
    let base = 10_f64.powi(exponent);
    [1.0, 2.0, 5.0, 10.0]
        .into_iter()
        .map(|step| step * base)
        .find(|step| *step >= target)
        .unwrap_or(10.0 * base)
        .round() as i32
}

async fn get_track(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<Vec<TrackPoint>>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let trip = sqlx::query_as::<_, TripWindowRow>(
        "SELECT started_at, ended_at, duration_seconds FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2"
    )
    .bind(id)
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let duration_min = trip.duration_seconds.unwrap_or(0) / 60;
    let bucket = if duration_min < 15 {
        "1 second"
    } else if duration_min < 60 {
        "5 seconds"
    } else {
        "15 seconds"
    };

    let cache_key = format!("trips:track:v2:{vid}:{id}:{bucket}");
    let mut redis_conn = state.redis.get_multiplexed_async_connection().await.ok();

    if let Some(conn) = redis_conn.as_mut() {
        let cached: Option<String> = conn.get(&cache_key).await.ok();
        if let Some(payload) = cached {
            if let Ok(points) = serde_json::from_str::<Vec<TrackPoint>>(&payload) {
                debug!(trip_id = %id, vehicle_id = %vid, cache_hit = true, "trips.track_cache");
                return Ok(Json(points));
            }
        }
    }

    // Dynamically pick bucket — use 1hr agg for very long trips as fallback
    let points: Vec<TrackPoint> = match bucket {
        "1 second" => sqlx::query_as::<_, TrackPoint>(
            "SELECT ts, latitude AS lat, longitude AS lng, speed_mph, altitude_m \
             FROM timeseries.telemetry \
             WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$3 AND latitude IS NOT NULL \
               AND longitude IS NOT NULL \
               AND NOT (latitude = 0 AND longitude = 0) \
             ORDER BY ts LIMIT 5000",
        )
        .bind(vid)
        .bind(trip.started_at)
        .bind(trip.ended_at)
        .fetch_all(&state.pool)
        .await?,
        _ => sqlx::query_as::<_, TrackPoint>(
            r#"SELECT time_bucket('15 seconds'::interval, ts) AS ts, avg(latitude) AS lat, avg(longitude) AS lng,
                      avg(speed_mph) AS speed_mph, avg(altitude_m) AS altitude_m
               FROM timeseries.telemetry
               WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$3 AND latitude IS NOT NULL
                 AND longitude IS NOT NULL
                 AND NOT (latitude = 0 AND longitude = 0)
               GROUP BY 1 ORDER BY 1 LIMIT 5000"#,
        )
        .bind(vid)
        .bind(trip.started_at)
        .bind(trip.ended_at)
        .fetch_all(&state.pool)
        .await?,
    };

    if let Some(conn) = redis_conn.as_mut() {
        if let Ok(payload) = serde_json::to_string(&points) {
            let _: Result<(), redis::RedisError> =
                conn.set_ex(&cache_key, payload, 12 * 60 * 60).await;
        }
    }

    debug!(trip_id = %id, vehicle_id = %vid, cache_hit = false, point_count = points.len(), "trips.track_cache");

    Ok(Json(points))
}

async fn get_speed_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let trip = sqlx::query_as::<_, TripWindowRow>(
        "SELECT started_at, ended_at, NULL::int4 AS duration_seconds FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2"
    )
    .bind(id)
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let points = sqlx::query_as::<_, SpeedProfileRow>(
        r#"SELECT EXTRACT(EPOCH FROM (time_bucket('10 seconds'::interval, ts) - $3))::float8 AS elapsed_s,
                  avg(speed_mph) AS speed_mph
           FROM timeseries.telemetry
           WHERE vehicle_id=$1
             AND ts>=$3 AND ts<=$4
             AND ($2::uuid IS NULL OR trip_id=$2 OR trip_id IS NULL)
             AND speed_mph IS NOT NULL
           GROUP BY 1
           ORDER BY 1"#
    )
    .bind(vid)
    .bind(id)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(points)))
}

async fn get_elevation_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    require_vehicle_owned(&state.pool, auth.user_id, vid).await?;

    let trip = sqlx::query_as::<_, TripWindowRow>(
        "SELECT started_at, ended_at, NULL::int4 AS duration_seconds FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2"
    )
    .bind(id)
    .bind(vid)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let points = sqlx::query_as::<_, ElevationPointRow>(
        r#"SELECT time_bucket('10 seconds'::interval, ts) AS ts, avg(altitude_m) AS value
           FROM timeseries.telemetry
           WHERE vehicle_id=$1 AND ts>=$2 AND ts<=$3 AND altitude_m IS NOT NULL
           GROUP BY 1 ORDER BY 1"#,
    )
    .bind(vid)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!(points)))
}

async fn get_power_profile(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    power_profile_response(&state, auth.user_id, vid, id).await
}

async fn get_power_profile_path(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((vehicle_id, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_access(&auth, vehicle_id)?;
    power_profile_response(&state, auth.user_id, vehicle_id, id).await
}

async fn get_trip_series(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<VehicleParam>,
) -> Result<Json<serde_json::Value>, AppError> {
    let vid = p
        .vehicle_id
        .ok_or(AppError::Validation("vehicle_id required".into()))?;
    require_vehicle_access(&auth, vid)?;
    trip_series_response(&state, auth.user_id, vid, id).await
}

async fn power_profile_response(
    state: &AppState,
    user_id: Uuid,
    vehicle_id: Uuid,
    trip_id: Uuid,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_owned(&state.pool, user_id, vehicle_id).await?;

    let trip = sqlx::query_as::<_, TripWindowRow>(
        "SELECT started_at, ended_at, NULL::int4 AS duration_seconds FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2"
    )
    .bind(trip_id)
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let points = sqlx::query_as::<_, PowerProfileRow>(
        r#"SELECT time_bucket('10 seconds'::interval, ts) AS ts,
                  avg(power_kw) AS power_kw,
                  avg(regen_power_kw) AS regen_power_kw,
                  avg(speed_mph) AS speed_mph,
                  avg(battery_level) AS battery_level
           FROM timeseries.telemetry
            WHERE vehicle_id=$1
              AND ts>=$3 AND ts<=$4
              AND (trip_id=$2 OR trip_id IS NULL)
           GROUP BY 1 ORDER BY 1"#,
    )
    .bind(vehicle_id)
    .bind(trip_id)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .fetch_all(&state.pool)
    .await?;

    let power_data = load_trip_power_data(
        &state.pool,
        vehicle_id,
        trip_id,
        trip.started_at,
        trip.ended_at,
        (trip.ended_at - trip.started_at).num_seconds().max(1) as i32,
    )
    .await?;
    let points = points
        .into_iter()
        .map(|point| {
            serde_json::json!({
                "ts": point.ts,
                "power_kw": point.power_kw,
                "regen_power_kw": point.regen_power_kw,
                "speed_mph": point.speed_mph,
                "battery_level": point.battery_level,
                "estimated_net_power_kw": power_data.estimated_at(point.ts),
                "power_source": power_data.source(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(serde_json::json!(points)))
}

async fn trip_series_response(
    state: &AppState,
    user_id: Uuid,
    vehicle_id: Uuid,
    trip_id: Uuid,
) -> Result<Json<serde_json::Value>, AppError> {
    require_vehicle_owned(&state.pool, user_id, vehicle_id).await?;

    let trip = sqlx::query_as::<_, TripWindowRow>(
        "SELECT started_at, ended_at, NULL::int4 AS duration_seconds FROM riviamigo.trips WHERE id=$1 AND vehicle_id=$2",
    )
    .bind(trip_id)
    .bind(vehicle_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let points = sqlx::query_as::<_, TripSeriesRow>(
        r#"SELECT time_bucket('10 seconds'::interval, ts) AS ts,
                  avg(speed_mph) AS speed_mph,
                  avg(power_kw) AS power_kw,
                  avg(regen_power_kw) AS regen_power_kw,
                  avg(battery_level) AS battery_level,
                  avg(outside_temp_c) AS outside_temp_c,
                  avg(cabin_temp_c) AS cabin_temp_c,
                  avg(driver_temp_c) AS driver_temp_c,
                  bool_or(hvac_active) AS hvac_active,
                  avg(tire_fl_psi) AS tire_fl_psi,
                  avg(tire_fr_psi) AS tire_fr_psi,
                  avg(tire_rl_psi) AS tire_rl_psi,
                  avg(tire_rr_psi) AS tire_rr_psi
           FROM timeseries.telemetry
                WHERE vehicle_id=$1
                  AND ts>=$3 AND ts<=$4
                  AND (trip_id=$2 OR trip_id IS NULL)
           GROUP BY 1 ORDER BY 1"#,
    )
    .bind(vehicle_id)
    .bind(trip_id)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .fetch_all(&state.pool)
    .await?;

    let power_data = load_trip_power_data(
        &state.pool,
        vehicle_id,
        trip_id,
        trip.started_at,
        trip.ended_at,
        (trip.ended_at - trip.started_at).num_seconds().max(1) as i32,
    )
    .await?;
    let points = points
        .into_iter()
        .map(|point| {
            serde_json::json!({
                "ts": point.ts,
                "speed_mph": point.speed_mph,
                "power_kw": point.power_kw,
                "regen_power_kw": point.regen_power_kw,
                "battery_level": point.battery_level,
                "outside_temp_c": point.outside_temp_c,
                "cabin_temp_c": point.cabin_temp_c,
                "driver_temp_c": point.driver_temp_c,
                "hvac_active": point.hvac_active,
                "tire_fl_psi": point.tire_fl_psi,
                "tire_fr_psi": point.tire_fr_psi,
                "tire_rl_psi": point.tire_rl_psi,
                "tire_rr_psi": point.tire_rr_psi,
                "estimated_net_power_kw": power_data.estimated_at(point.ts),
                "power_source": power_data.source(),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(serde_json::json!(points)))
}

#[cfg(test)]
mod trip_power_tests {
    use super::*;
    use chrono::{Duration, TimeZone};

    fn row(offset_seconds: i64, soc: f64) -> TripPowerTelemetryRow {
        TripPowerTelemetryRow {
            ts: Utc.timestamp_opt(offset_seconds, 0).single().unwrap(),
            battery_level: Some(soc),
            battery_capacity_wh: Some(111_500.0),
            power_kw: None,
            regen_power_kw: None,
        }
    }

    #[test]
    fn derives_signed_net_power_from_soc_change() {
        let rows = vec![row(0, 80.0), row(30, 79.5), row(60, 79.8)];
        let data = derive_soc_power(&rows, 60);

        assert!(matches!(
            data.metadata.source,
            TripPowerSource::EstimatedSoc
        ));
        assert_eq!(data.metadata.sample_count, 2);
        assert!(data.intervals[0].net_power_kw > 0.0);
        assert!(data.intervals[1].net_power_kw < 0.0);
        assert_eq!(data.metadata.median_interval_seconds, Some(30.0));
        assert_eq!(data.metadata.coverage_percent, Some(100.0));
    }

    #[test]
    fn rejects_sparse_or_large_soc_jumps() {
        let rows = vec![row(0, 80.0), row(301, 79.0), row(302, 78.0)];
        let data = derive_soc_power(&rows, 302);

        assert!(matches!(data.metadata.source, TripPowerSource::Unavailable));
        assert!(data.intervals.is_empty());
    }

    #[test]
    fn direct_power_wins_when_multiple_samples_exist() {
        let mut first = row(0, 80.0);
        first.power_kw = Some(42.0);
        let mut second = row(10, 80.0);
        second.regen_power_kw = Some(8.0);

        let data = derive_soc_power(&[first, second], 10);
        assert!(matches!(data.metadata.source, TripPowerSource::Direct));
        assert_eq!(data.metadata.sample_count, 2);
        assert!(data.intervals.is_empty());
    }

    #[test]
    fn estimated_at_uses_half_open_intervals() {
        let rows = vec![row(0, 80.0), row(30, 79.5)];
        let data = derive_soc_power(&rows, 30);
        let start = Utc.timestamp_opt(0, 0).single().unwrap();
        assert!(data.estimated_at(start).is_some());
        assert!(data.estimated_at(start + Duration::seconds(30)).is_none());
    }
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use http::{Request, StatusCode};
    use tower::ServiceExt;

    // Run with: cargo test -- --ignored

    async fn make_app() -> axum::Router {
        use crate::middleware::auth::{AppState, JwtKeys};
        use std::sync::Arc;

        let database_url =
            std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");
        let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into());

        let pool = crate::db::pool::create_pool(&database_url)
            .await
            .expect("create_pool");
        let redis = redis::Client::open(redis_url).expect("redis client");

        let keys = crate::keys::generate_keys().expect("generate test keys");
        let jwt_keys =
            Arc::new(JwtKeys::new(&keys.jwt_private_pem, &keys.jwt_public_pem).expect("jwt keys"));

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
                .join("riviamigo-route-test-vehicle-images")
                .to_string_lossy()
                .into_owned(),
            backup_driver: "pg_dump".into(),
            backup_poll_interval_seconds: 60,
            rivian_ws_reconnect_initial_seconds: 10,
            rivian_ws_reconnect_max_seconds: 900,
            rivian_raw_event_retention_days: 7,
            rivian_persist_raw_events: true,
            rivian_parallax_capture_enabled: true,
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

    async fn get_status(app: axum::Router, uri: &str) -> http::StatusCode {
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap();
        app.oneshot(req).await.unwrap().status()
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn list_trips_requires_auth() {
        let app = make_app().await;
        assert_eq!(get_status(app, "/v1/trips").await, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_map_requires_auth() {
        let app = make_app().await;
        assert_eq!(
            get_status(app, "/v1/trips/map").await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_detail_requires_auth() {
        let app = make_app().await;
        let status = get_status(app, &format!("/v1/trips/{}", uuid::Uuid::new_v4())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_detail_data_requires_auth() {
        let app = make_app().await;
        let status = get_status(app, &format!("/v1/trips/{}/detail", uuid::Uuid::new_v4())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_track_requires_auth() {
        let app = make_app().await;
        let status = get_status(app, &format!("/v1/trips/{}/track", uuid::Uuid::new_v4())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_speed_requires_auth() {
        let app = make_app().await;
        let status = get_status(app, &format!("/v1/trips/{}/speed", uuid::Uuid::new_v4())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_elevation_requires_auth() {
        let app = make_app().await;
        let status = get_status(
            app,
            &format!("/v1/trips/{}/elevation", uuid::Uuid::new_v4()),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn trip_series_requires_auth() {
        let app = make_app().await;
        let status = get_status(app, &format!("/v1/trips/{}/series", uuid::Uuid::new_v4())).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}
