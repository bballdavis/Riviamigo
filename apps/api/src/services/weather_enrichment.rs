use std::collections::HashMap;
use std::fmt;
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rand::seq::SliceRandom;
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    ingestion::session_store::decrypt_json,
    services::external_connections::{self as connections, ConnectionSettingsRow},
};

const SAMPLE_INTERVAL_SECONDS: i64 = 15 * 60;
const MAX_LOCATIONS_PER_REQUEST: usize = 50;
const DAILY_REQUEST_BUDGET: i32 = 8_000;

#[derive(Debug)]
struct WeatherFetchError {
    status: reqwest::StatusCode,
    retry_after_seconds: Option<i64>,
}

impl fmt::Display for WeatherFetchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "Weather provider returned HTTP {}", self.status)
    }
}

impl std::error::Error for WeatherFetchError {}

#[derive(Debug)]
struct WeatherBudgetError;

impl fmt::Display for WeatherBudgetError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Daily weather request budget reached")
    }
}

impl std::error::Error for WeatherBudgetError {}

#[derive(Debug)]
struct WeatherPausedError;

impl fmt::Display for WeatherPausedError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Weather connection disabled")
    }
}

impl std::error::Error for WeatherPausedError {}

#[derive(Debug, FromRow)]
struct TripInfo {
    id: Uuid,
    vehicle_id: Uuid,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    start_lat: Option<f64>,
    start_lng: Option<f64>,
}

#[derive(Debug, Clone, FromRow)]
struct RoutePoint {
    ts: DateTime<Utc>,
    lat: f64,
    lng: f64,
}

#[derive(Debug, Clone)]
struct TargetSample {
    sampled_at: DateTime<Utc>,
    elapsed_seconds: i32,
    cell_key: String,
    provider_lat: f64,
    provider_lng: f64,
}

#[derive(Debug, Clone)]
struct WeatherCell {
    key: String,
    lat: f64,
    lng: f64,
}

#[derive(Debug, Clone, FromRow)]
struct RawOutsideTemp {
    ts: DateTime<Utc>,
    outside_temp_c: f64,
}

enum EnrichTripOutcome {
    Unavailable,
    Complete { provider_called: bool },
}

pub fn start_worker(pool: PgPool, age_key: String) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                tracing::error!(error = %error, "weather_enrichment.client_build_failed");
                return;
            }
        };

        loop {
            match process_next_job(&pool, &client, &age_key).await {
                Ok(true) => tokio::time::sleep(Duration::from_secs(1)).await,
                Ok(false) => tokio::time::sleep(Duration::from_secs(30)).await,
                Err(error) => {
                    tracing::warn!(error = %error, "weather_enrichment.worker_iteration_failed");
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
            }
        }
    })
}

pub async fn enqueue(pool: &PgPool, trip_id: Uuid) -> Result<()> {
    sqlx::query(
        r#"INSERT INTO riviamigo.weather_enrichment_jobs
             (trip_id, status, attempts, next_attempt_at, last_error, updated_at, completed_at)
           VALUES ($1, 'pending', 0, now(), NULL, now(), NULL)
           ON CONFLICT (trip_id) DO UPDATE SET
             status = CASE WHEN riviamigo.weather_enrichment_jobs.status = 'succeeded' THEN 'succeeded' ELSE 'pending' END,
             next_attempt_at = now(), last_error = NULL, updated_at = now()"#,
    )
    .bind(trip_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn process_next_job(pool: &PgPool, client: &reqwest::Client, age_key: &str) -> Result<bool> {
    let settings = match connections::require_enabled(pool, connections::OPEN_METEO).await {
        Ok(settings) => settings,
        Err(crate::errors::AppError::ExternalConnectionDisabled(_)) => return Ok(false),
        Err(error) => return Err(error.into()),
    };

    let request_count: i32 = sqlx::query_scalar(
        r#"SELECT CASE WHEN usage_date = CURRENT_DATE THEN request_count ELSE 0 END
           FROM riviamigo.external_connection_activity WHERE connection_id = $1"#,
    )
    .bind(connections::OPEN_METEO)
    .fetch_optional(pool)
    .await?
    .unwrap_or(0);
    if request_count >= DAILY_REQUEST_BUDGET {
        return Ok(false);
    }

    let trip_id = sqlx::query_scalar::<_, Uuid>(
        r#"UPDATE riviamigo.weather_enrichment_jobs SET
             status = 'running', attempts = attempts + 1, updated_at = now()
           WHERE trip_id = (
             SELECT trip_id FROM riviamigo.weather_enrichment_jobs
             WHERE status IN ('pending', 'failed') AND attempts < 5 AND next_attempt_at <= now()
             ORDER BY next_attempt_at, created_at
             FOR UPDATE SKIP LOCKED LIMIT 1
           )
           RETURNING trip_id"#,
    )
    .fetch_optional(pool)
    .await?;
    let Some(trip_id) = trip_id else {
        return Ok(false);
    };

    match enrich_trip(pool, client, age_key, &settings, trip_id).await {
        Ok(EnrichTripOutcome::Complete { provider_called }) => {
            sqlx::query("UPDATE riviamigo.weather_enrichment_jobs SET status='succeeded', last_error=NULL, completed_at=now(), updated_at=now() WHERE trip_id=$1")
                .bind(trip_id).execute(pool).await?;
            if provider_called {
                connections::record_success(pool, connections::OPEN_METEO).await;
            }
        }
        Ok(EnrichTripOutcome::Unavailable) => {
            sqlx::query("UPDATE riviamigo.weather_enrichment_jobs SET status='unavailable', last_error=NULL, completed_at=now(), updated_at=now() WHERE trip_id=$1")
                .bind(trip_id).execute(pool).await?;
        }
        Err(error) => {
            if error.downcast_ref::<WeatherPausedError>().is_some() {
                sqlx::query("UPDATE riviamigo.weather_enrichment_jobs SET status='pending', attempts=GREATEST(attempts-1, 0), next_attempt_at=now(), last_error=NULL, updated_at=now() WHERE trip_id=$1")
                    .bind(trip_id).execute(pool).await?;
                return Ok(true);
            }
            if error.downcast_ref::<WeatherBudgetError>().is_some() {
                sqlx::query("UPDATE riviamigo.weather_enrichment_jobs SET status='failed', attempts=GREATEST(attempts-1, 0), next_attempt_at=date_trunc('day', now()) + interval '1 day', last_error='Daily weather request budget reached', updated_at=now() WHERE trip_id=$1")
                    .bind(trip_id).execute(pool).await?;
                return Ok(true);
            }
            connections::record_failure(pool, connections::OPEN_METEO, &error.to_string()).await;
            let attempts: i32 = sqlx::query_scalar(
                "SELECT attempts FROM riviamigo.weather_enrichment_jobs WHERE trip_id=$1",
            )
            .bind(trip_id)
            .fetch_one(pool)
            .await?;
            let exponential_backoff = 60_i64
                .saturating_mul(2_i64.pow(attempts.min(8) as u32))
                .min(21_600);
            let retry_after = error
                .downcast_ref::<WeatherFetchError>()
                .and_then(|error| error.retry_after_seconds)
                .unwrap_or(0);
            let backoff_seconds = exponential_backoff.max(retry_after).min(86_400);
            sqlx::query("UPDATE riviamigo.weather_enrichment_jobs SET status='failed', next_attempt_at=now()+make_interval(secs=>$2), last_error='Weather provider request failed', updated_at=now() WHERE trip_id=$1")
                .bind(trip_id).bind(backoff_seconds as f64).execute(pool).await?;
            tracing::warn!(trip_id = %trip_id, attempts, "weather_enrichment.trip_failed");
        }
    }
    Ok(true)
}

async fn enrich_trip(
    pool: &PgPool,
    client: &reqwest::Client,
    age_key: &str,
    settings: &ConnectionSettingsRow,
    trip_id: Uuid,
) -> Result<EnrichTripOutcome> {
    let trip = sqlx::query_as::<_, TripInfo>(
        "SELECT id, vehicle_id, started_at, ended_at, start_lat, start_lng FROM riviamigo.trips WHERE id=$1",
    )
    .bind(trip_id)
    .fetch_optional(pool)
    .await?
    .context("trip not found")?;

    let route = sqlx::query_as::<_, RoutePoint>(
        r#"SELECT ts, latitude AS lat, longitude AS lng
           FROM timeseries.telemetry
           WHERE vehicle_id=$1 AND ts >= $2 AND ts <= $3
             AND latitude IS NOT NULL AND longitude IS NOT NULL
             AND latitude <> 0 AND longitude <> 0
             AND (trip_id=$4 OR trip_id IS NULL)
           ORDER BY ts"#,
    )
    .bind(trip.vehicle_id)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .bind(trip.id)
    .fetch_all(pool)
    .await?;

    let exact = settings.weather_precision.as_deref() == Some("exact");
    let targets = build_targets(&trip, &route, exact);
    if targets.is_empty() {
        return Ok(EnrichTripOutcome::Unavailable);
    }

    let raw = sqlx::query_as::<_, RawOutsideTemp>(
        r#"SELECT ts, outside_temp_c FROM timeseries.telemetry
           WHERE vehicle_id=$1 AND ts >= $2 AND ts <= $3 AND outside_temp_c IS NOT NULL
           ORDER BY ts"#,
    )
    .bind(trip.vehicle_id)
    .bind(trip.started_at)
    .bind(trip.ended_at)
    .fetch_all(pool)
    .await?;

    let weather_targets = targets
        .iter()
        .filter(|target| nearest_raw_temp(&raw, target.sampled_at).is_none())
        .cloned()
        .collect::<Vec<_>>();
    let mut cells = unique_weather_cells(&weather_targets);
    let provider_called = !cells.is_empty();
    cells.shuffle(&mut rand::thread_rng());

    let api_key = decrypt_secret(age_key, settings.api_key_encrypted.as_deref())?;
    let mut hourly_by_cell = HashMap::<String, Value>::new();
    for chunk in cells.chunks(MAX_LOCATIONS_PER_REQUEST) {
        match connections::require_enabled(pool, connections::OPEN_METEO).await {
            Ok(_) => {}
            Err(crate::errors::AppError::ExternalConnectionDisabled(_)) => {
                return Err(WeatherPausedError.into());
            }
            Err(error) => return Err(error.into()),
        }
        let request_count: i32 = sqlx::query_scalar(
            "SELECT CASE WHEN usage_date = CURRENT_DATE THEN request_count ELSE 0 END FROM riviamigo.external_connection_activity WHERE connection_id=$1",
        )
        .bind(connections::OPEN_METEO)
        .fetch_optional(pool)
        .await?
        .unwrap_or(0);
        if request_count >= DAILY_REQUEST_BUDGET {
            return Err(WeatherBudgetError.into());
        }
        connections::record_attempt(pool, connections::OPEN_METEO).await;
        let payloads = fetch_weather_chunk(
            client,
            settings,
            chunk,
            trip.started_at,
            trip.ended_at,
            api_key.as_deref(),
        )
        .await?;
        for (cell, payload) in chunk.iter().zip(payloads) {
            hourly_by_cell.insert(cell.key.clone(), payload);
        }
        if cells.len() > MAX_LOCATIONS_PER_REQUEST {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    let mut enriched = Vec::with_capacity(targets.len());
    for target in weather_targets {
        let Some(payload) = hourly_by_cell.get(&target.cell_key) else {
            continue;
        };
        let Some(temp) = pick_closest_temp(payload, target.sampled_at) else {
            continue;
        };
        enriched.push((target, temp));
    }
    if enriched.is_empty() && raw.is_empty() {
        anyhow::bail!("weather provider returned no usable temperatures");
    }

    let weather_by_time = enriched
        .iter()
        .map(|(target, temperature)| (target.sampled_at, *temperature))
        .collect::<HashMap<_, _>>();
    let mut summary_values = Vec::with_capacity(targets.len());
    let mut raw_used = 0usize;
    let mut weather_used = 0usize;
    for target in &targets {
        if let Some(raw_temp) = nearest_raw_temp(&raw, target.sampled_at) {
            raw_used += 1;
            summary_values.push((target.sampled_at, raw_temp));
        } else if let Some(weather_temp) = weather_by_time.get(&target.sampled_at) {
            weather_used += 1;
            summary_values.push((target.sampled_at, *weather_temp));
        }
    }
    let source = if raw_used == 0 && weather_used > 0 {
        "open_meteo"
    } else if weather_used == 0 && raw_used > 0 {
        "vehicle"
    } else {
        "mixed"
    };
    let summary = time_weighted_average(&summary_values).context("weather summary unavailable")?;

    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM riviamigo.trip_weather_samples WHERE trip_id=$1")
        .bind(trip.id)
        .execute(&mut *tx)
        .await?;
    for (target, temp) in enriched {
        sqlx::query(
            r#"INSERT INTO riviamigo.trip_weather_samples
                 (trip_id, sampled_at, elapsed_seconds, provider_latitude, provider_longitude, temperature_c)
               VALUES ($1,$2,$3,$4,$5,$6)"#,
        )
        .bind(trip.id).bind(target.sampled_at).bind(target.elapsed_seconds)
        .bind(target.provider_lat).bind(target.provider_lng).bind(temp)
        .execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE riviamigo.trips SET outside_temp_c=$2, outside_temp_source=$3 WHERE id=$1")
        .bind(trip.id)
        .bind(summary)
        .bind(source)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(EnrichTripOutcome::Complete { provider_called })
}

fn nearest_raw_temp(raw: &[RawOutsideTemp], sampled_at: DateTime<Utc>) -> Option<f64> {
    raw.iter()
        .min_by_key(|row| (row.ts - sampled_at).num_seconds().abs())
        .filter(|row| (row.ts - sampled_at).num_seconds().abs() <= SAMPLE_INTERVAL_SECONDS / 2)
        .map(|row| row.outside_temp_c)
}

fn build_targets(trip: &TripInfo, route: &[RoutePoint], exact: bool) -> Vec<TargetSample> {
    let mut times = Vec::new();
    let mut cursor = trip.started_at;
    while cursor < trip.ended_at {
        times.push(cursor);
        cursor += chrono::Duration::seconds(SAMPLE_INTERVAL_SECONDS);
    }
    if times.last().copied() != Some(trip.ended_at) {
        times.push(trip.ended_at);
    }

    times
        .into_iter()
        .filter_map(|sampled_at| {
            let point = route
                .iter()
                .min_by_key(|point| (point.ts - sampled_at).num_seconds().abs());
            let (lat, lng) = point
                .map(|point| (point.lat, point.lng))
                .or_else(|| trip.start_lat.zip(trip.start_lng))?;
            let decimals: usize = if exact { 5 } else { 2 };
            let factor = 10_f64.powi(decimals as i32);
            let provider_lat = (lat * factor).round() / factor;
            let provider_lng = (lng * factor).round() / factor;
            Some(TargetSample {
                sampled_at,
                elapsed_seconds: (sampled_at - trip.started_at).num_seconds().max(0) as i32,
                cell_key: format!("{provider_lat:.decimals$},{provider_lng:.decimals$}"),
                provider_lat,
                provider_lng,
            })
        })
        .collect()
}

fn unique_weather_cells(targets: &[TargetSample]) -> Vec<WeatherCell> {
    let mut cells_by_key = HashMap::<String, WeatherCell>::new();
    for target in targets {
        cells_by_key
            .entry(target.cell_key.clone())
            .or_insert_with(|| WeatherCell {
                key: target.cell_key.clone(),
                lat: target.provider_lat,
                lng: target.provider_lng,
            });
    }
    cells_by_key.into_values().collect()
}

async fn fetch_weather_chunk(
    client: &reqwest::Client,
    settings: &ConnectionSettingsRow,
    cells: &[WeatherCell],
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
    api_key: Option<&str>,
) -> Result<Vec<Value>> {
    let endpoint = if (Utc::now() - ended_at).num_days() < 5 {
        settings.forecast_url.as_deref()
    } else {
        settings.archive_url.as_deref()
    }
    .context("weather endpoint missing")?;
    let latitudes = cells
        .iter()
        .map(|cell| cell.lat.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let longitudes = cells
        .iter()
        .map(|cell| cell.lng.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let start_date = started_at.date_naive().format("%Y-%m-%d").to_string();
    let end_date = ended_at.date_naive().format("%Y-%m-%d").to_string();
    let mut request = client.get(endpoint).query(&[
        ("latitude", latitudes),
        ("longitude", longitudes),
        ("hourly", "temperature_2m".to_string()),
        ("timezone", "UTC".to_string()),
        ("temperature_unit", "celsius".to_string()),
        ("start_date", start_date),
        ("end_date", end_date),
    ]);
    if let Some(api_key) = api_key {
        request = request.query(&[("apikey", api_key)]);
    }
    let response = request.send().await.context("weather request failed")?;
    if !response.status().is_success() {
        let retry_after_seconds = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<i64>().ok());
        return Err(WeatherFetchError {
            status: response.status(),
            retry_after_seconds,
        }
        .into());
    }
    let body: Value = response
        .json()
        .await
        .context("weather JSON decode failed")?;
    if let Some(array) = body.as_array() {
        if array.len() != cells.len() {
            anyhow::bail!("weather provider returned an unexpected batch size");
        }
        return Ok(array.clone());
    }
    if cells.len() != 1 {
        anyhow::bail!("weather provider returned a single response for a batch");
    }
    Ok(vec![body])
}

fn pick_closest_temp(body: &Value, target: DateTime<Utc>) -> Option<f64> {
    let times = body.pointer("/hourly/time")?.as_array()?;
    let temps = body.pointer("/hourly/temperature_2m")?.as_array()?;
    times
        .iter()
        .zip(temps)
        .filter_map(|(time, temp)| {
            let raw = time.as_str()?;
            let parsed = chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M")
                .ok()?
                .and_utc();
            Some(((parsed - target).num_seconds().abs(), temp.as_f64()?))
        })
        .min_by_key(|(distance, _)| *distance)
        .map(|(_, temp)| temp)
}

fn time_weighted_average(values: &[(DateTime<Utc>, f64)]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    if values.len() == 1 {
        return Some(values[0].1);
    }
    let mut weighted = 0.0;
    let mut seconds = 0.0;
    for pair in values.windows(2) {
        let duration = (pair[1].0 - pair[0].0).num_seconds().max(0) as f64;
        weighted += ((pair[0].1 + pair[1].1) / 2.0) * duration;
        seconds += duration;
    }
    if seconds > 0.0 {
        Some(weighted / seconds)
    } else {
        Some(values[0].1)
    }
}

fn decrypt_secret(age_key: &str, encrypted: Option<&[u8]>) -> Result<Option<String>> {
    let Some(encrypted) = encrypted else {
        return Ok(None);
    };
    let identity = age_key
        .parse::<age::x25519::Identity>()
        .map_err(|_| anyhow::anyhow!("invalid age key"))?;
    Ok(Some(decrypt_json(encrypted, &identity)?))
}

#[cfg(test)]
mod tests {
    use super::{
        build_targets, pick_closest_temp, time_weighted_average, unique_weather_cells, RoutePoint,
        TripInfo,
    };
    use chrono::{TimeZone, Utc};
    use uuid::Uuid;

    #[test]
    fn samples_endpoints_and_fifteen_minute_boundaries_with_rounded_cells() {
        let start = Utc.with_ymd_and_hms(2026, 7, 14, 12, 0, 0).unwrap();
        let trip = TripInfo {
            id: Uuid::new_v4(),
            vehicle_id: Uuid::new_v4(),
            started_at: start,
            ended_at: start + chrono::Duration::minutes(31),
            start_lat: None,
            start_lng: None,
        };
        let route = vec![
            RoutePoint {
                ts: start,
                lat: 30.26721,
                lng: -97.74311,
            },
            RoutePoint {
                ts: start + chrono::Duration::minutes(31),
                lat: 30.301,
                lng: -97.701,
            },
        ];
        let targets = build_targets(&trip, &route, false);
        assert_eq!(targets.len(), 4);
        assert_eq!(targets[0].provider_lat, 30.27);
        assert_eq!(targets.last().unwrap().elapsed_seconds, 31 * 60);
    }

    #[test]
    fn calculates_time_weighted_temperature() {
        let start = Utc.with_ymd_and_hms(2026, 7, 14, 12, 0, 0).unwrap();
        let values = vec![(start, 10.0), (start + chrono::Duration::hours(1), 20.0)];
        assert_eq!(time_weighted_average(&values), Some(15.0));
    }

    #[test]
    fn deduplicates_rounded_cells_but_keeps_the_exact_local_timeline() {
        let start = Utc.with_ymd_and_hms(2026, 7, 14, 12, 0, 0).unwrap();
        let trip = TripInfo {
            id: Uuid::new_v4(),
            vehicle_id: Uuid::new_v4(),
            started_at: start,
            ended_at: start + chrono::Duration::minutes(30),
            start_lat: Some(30.2672),
            start_lng: Some(-97.7431),
        };
        let targets = build_targets(&trip, &[], false);
        assert_eq!(targets.len(), 3);
        assert_eq!(unique_weather_cells(&targets).len(), 1);
        assert_eq!(
            targets
                .iter()
                .map(|target| target.sampled_at)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            3
        );
    }

    #[test]
    fn exact_mode_preserves_five_decimal_provider_coordinates() {
        let start = Utc.with_ymd_and_hms(2026, 7, 14, 12, 0, 0).unwrap();
        let trip = TripInfo {
            id: Uuid::new_v4(),
            vehicle_id: Uuid::new_v4(),
            started_at: start,
            ended_at: start + chrono::Duration::minutes(1),
            start_lat: Some(30.267214),
            start_lng: Some(-97.743117),
        };
        let targets = build_targets(&trip, &[], true);
        assert_eq!(targets[0].provider_lat, 30.26721);
        assert_eq!(targets[0].provider_lng, -97.74312);
    }

    #[test]
    fn maps_hourly_provider_values_to_the_nearest_local_sample_time() {
        let target = Utc.with_ymd_and_hms(2026, 7, 14, 12, 40, 0).unwrap();
        let payload = serde_json::json!({
            "hourly": {
                "time": ["2026-07-14T12:00", "2026-07-14T13:00"],
                "temperature_2m": [20.0, 24.0]
            }
        });
        assert_eq!(pick_closest_temp(&payload, target), Some(24.0));
    }
}
