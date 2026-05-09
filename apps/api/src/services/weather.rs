//! Ambient temperature lookup via Open-Meteo (free, no API key required).
//!
//! Uses the archive endpoint for trips older than 5 days and the forecast
//! endpoint (with past_days) for recent trips.  Returns the temperature_2m
//! reading at the hour closest to `at_time`.

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use reqwest::Client;

const ARCHIVE_BASE: &str = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_BASE: &str = "https://api.open-meteo.com/v1/forecast";

/// Fetch the ambient temperature (°C) at `(lat, lng)` at `at_time`.
///
/// Returns `None` if the lookup fails for any reason — callers should degrade
/// gracefully rather than failing the trip write.
pub async fn fetch_ambient_temp_c(
    client: &Client,
    lat: f64,
    lng: f64,
    at_time: DateTime<Utc>,
) -> Option<f64> {
    let age_days = (Utc::now() - at_time).num_days();

    // Open-Meteo archive only has data up to ~5 days ago; use forecast API
    // (with past_days parameter) for anything more recent.
    let result = if age_days >= 5 {
        fetch_from_archive(client, lat, lng, at_time).await
    } else {
        fetch_from_forecast(client, lat, lng, at_time).await
    };

    match result {
        Ok(temp) => Some(temp),
        Err(e) => {
            tracing::warn!(
                lat = lat,
                lng = lng,
                at = %at_time,
                error = %e,
                "weather.fetch_ambient_temp_failed"
            );
            None
        }
    }
}

async fn fetch_from_archive(
    client: &Client,
    lat: f64,
    lng: f64,
    at_time: DateTime<Utc>,
) -> Result<f64> {
    let date = at_time.date_naive();
    let date_str = date.format("%Y-%m-%d").to_string();

    let body: serde_json::Value = client
        .get(ARCHIVE_BASE)
        .query(&[
            ("latitude", lat.to_string()),
            ("longitude", lng.to_string()),
            ("start_date", date_str.clone()),
            ("end_date", date_str),
            ("hourly", "temperature_2m".to_string()),
            ("timezone", "UTC".to_string()),
            ("temperature_unit", "celsius".to_string()),
        ])
        .send()
        .await
        .context("archive request failed")?
        .error_for_status()
        .context("archive HTTP error")?
        .json()
        .await
        .context("archive JSON decode failed")?;

    pick_closest_temp(&body, at_time).context("archive: no matching hourly data")
}

async fn fetch_from_forecast(
    client: &Client,
    lat: f64,
    lng: f64,
    at_time: DateTime<Utc>,
) -> Result<f64> {
    let body: serde_json::Value = client
        .get(FORECAST_BASE)
        .query(&[
            ("latitude", lat.to_string()),
            ("longitude", lng.to_string()),
            ("hourly", "temperature_2m".to_string()),
            ("timezone", "UTC".to_string()),
            ("temperature_unit", "celsius".to_string()),
            ("past_days", "5".to_string()),
            ("forecast_days", "1".to_string()),
        ])
        .send()
        .await
        .context("forecast request failed")?
        .error_for_status()
        .context("forecast HTTP error")?
        .json()
        .await
        .context("forecast JSON decode failed")?;

    pick_closest_temp(&body, at_time).context("forecast: no matching hourly data")
}

/// Find the temperature reading whose timestamp is closest to `target`.
///
/// Open-Meteo returns arrays like:
/// ```json
/// { "hourly": { "time": ["2026-05-08T00:00", ...], "temperature_2m": [12.3, ...] } }
/// ```
fn pick_closest_temp(body: &serde_json::Value, target: DateTime<Utc>) -> Option<f64> {
    let times = body.pointer("/hourly/time")?.as_array()?;
    let temps = body.pointer("/hourly/temperature_2m")?.as_array()?;

    let target_ts = target.timestamp();

    let mut best_temp: Option<f64> = None;
    let mut best_diff = i64::MAX;

    for (time_val, temp_val) in times.iter().zip(temps.iter()) {
        let time_str = time_val.as_str()?;
        // Open-Meteo timestamps are like "2026-05-08T14:00" (no seconds, no Z)
        let naive = NaiveDate::parse_from_str(&time_str[..10], "%Y-%m-%d").ok()?;
        let hour: u32 = time_str.get(11..13)?.parse().ok()?;
        let dt = naive.and_hms_opt(hour, 0, 0)?.and_utc();
        let diff = (dt.timestamp() - target_ts).abs();

        if diff < best_diff {
            if let Some(t) = temp_val.as_f64() {
                best_diff = diff;
                best_temp = Some(t);
            }
        }
    }

    best_temp
}

#[cfg(test)]
mod tests {
    use super::pick_closest_temp;
    use chrono::Utc;

    #[test]
    fn picks_closest_hour() {
        let body = serde_json::json!({
            "hourly": {
                "time": ["2026-05-08T00:00", "2026-05-08T01:00", "2026-05-08T02:00"],
                "temperature_2m": [10.0, 12.5, 14.0]
            }
        });
        // 01:20 UTC — closest to 01:00
        let target: chrono::DateTime<Utc> = "2026-05-08T01:20:00Z".parse().unwrap();
        assert_eq!(pick_closest_temp(&body, target), Some(12.5));
    }

    #[test]
    fn picks_first_when_tie() {
        let body = serde_json::json!({
            "hourly": {
                "time": ["2026-05-08T00:00", "2026-05-08T01:00"],
                "temperature_2m": [10.0, 12.0]
            }
        });
        // Exactly 30 min between — first match wins
        let target: chrono::DateTime<Utc> = "2026-05-08T00:30:00Z".parse().unwrap();
        // 00:30 is equidistant; both diffs = 1800s, first encountered wins
        assert!(pick_closest_temp(&body, target).is_some());
    }
}
