//! Monthly regular and premium gasoline prices: the EIA series, its response
//! parser, and the refresh that stores them for the ownership cost ledger.

use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, NaiveDate, Utc};
use reqwest::Url;
use serde::Serialize;
use sqlx::PgPool;

use crate::{
    errors::AppError,
    services::{
        external_connections as connections,
        outbound::{outbound_client_for_url, read_response_limited},
    },
};

/// Shared, rate-limited key that api.data.gov publishes for evaluation. One
/// daily request stays far inside its allowance; an administrator can store
/// their own free EIA key on the connection instead.
const EIA_DEMO_KEY: &str = "DEMO_KEY";
pub(super) const EIA_REGULAR_SERIES: &str = "EMM_EPMR_PTE_NUS_DPG";
pub(super) const EIA_PREMIUM_SERIES: &str = "EMM_EPMP_PTE_NUS_DPG";
const FUEL_PRICE_START: &str = "2012-01";
const FUEL_PRICE_REFRESH_INTERVAL: Duration = Duration::hours(24);
/// After any attempt, successful or not, wait before contacting the provider
/// again so a failing provider is not retried on every page load.
const FUEL_PRICE_RETRY_INTERVAL: Duration = Duration::hours(6);
const FUEL_PRICE_FETCH_TIMEOUT: StdDuration = StdDuration::from_secs(8);

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FuelPriceMonth {
    pub month: NaiveDate,
    pub regular_usd: Option<f64>,
    pub premium_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FuelPrices {
    /// Whether the fuel-price connection may contact its provider.
    pub connection_enabled: bool,
    pub months: Vec<FuelPriceMonth>,
    pub last_updated_at: Option<DateTime<Utc>>,
    /// True when the most recent refresh attempt failed and stored months are
    /// being served instead.
    pub refresh_failed: bool,
}

/// Build the EIA v2 request for the two national retail gasoline series.
pub fn fuel_price_endpoint(api_key: Option<&str>, length: u32) -> Result<Url, AppError> {
    let mut url = Url::parse(connections::FUEL_PRICES_BASE_URL)
        .and_then(|base| base.join("v2/petroleum/pri/gnd/data/"))
        .map_err(|_| AppError::Validation("fuel price endpoint is invalid".into()))?;
    url.query_pairs_mut()
        .append_pair(
            "api_key",
            api_key
                .map(str::trim)
                .filter(|key| !key.is_empty())
                .unwrap_or(EIA_DEMO_KEY),
        )
        .append_pair("frequency", "monthly")
        .append_pair("data[0]", "value")
        .append_pair("facets[series][]", EIA_REGULAR_SERIES)
        .append_pair("facets[series][]", EIA_PREMIUM_SERIES)
        .append_pair("start", FUEL_PRICE_START)
        .append_pair("sort[0][column]", "period")
        .append_pair("sort[0][direction]", "desc")
        .append_pair("length", &length.to_string());
    Ok(url)
}

/// Parse an EIA v2 response into `(month, grade, price)` rows, skipping rows
/// this build does not understand.
pub fn parse_fuel_prices(body: &serde_json::Value) -> Vec<(NaiveDate, &'static str, f64)> {
    let Some(rows) = body
        .get("response")
        .and_then(|response| response.get("data"))
        .and_then(|data| data.as_array())
    else {
        return Vec::new();
    };
    rows.iter()
        .filter_map(|row| {
            let grade = match row.get("series")?.as_str()? {
                EIA_REGULAR_SERIES => "regular",
                EIA_PREMIUM_SERIES => "premium",
                _ => return None,
            };
            let month = NaiveDate::parse_from_str(
                &format!("{}-01", row.get("period")?.as_str()?),
                "%Y-%m-%d",
            )
            .ok()?;
            // EIA has returned this field both as a number and as a string.
            let value = row.get("value")?;
            let price = value
                .as_f64()
                .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))?;
            (price.is_finite() && price > 0.0 && price < 100.0).then_some((month, grade, price))
        })
        .collect()
}

fn decrypt_api_key(age_key: &str, encrypted: Option<&[u8]>) -> Option<String> {
    let identity = age_key.parse::<age::x25519::Identity>().ok()?;
    crate::ingestion::session_store::decrypt_json::<String>(encrypted?, &identity).ok()
}

async fn fetch_fuel_prices(
    api_key: Option<&str>,
) -> Result<Vec<(NaiveDate, &'static str, f64)>, String> {
    let endpoint = fuel_price_endpoint(api_key, 5000).map_err(|error| error.to_string())?;
    let response = outbound_client_for_url(&endpoint, &[])
        .await
        .map_err(|error| error.to_string())?
        .get(endpoint)
        .send()
        .await
        // The request URL carries the API key; never let it reach a log or
        // the stored error text.
        .map_err(|error| error.without_url().to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let bytes = read_response_limited(response, 4 * 1024 * 1024, "Fuel prices")
        .await
        .map_err(|error| error.to_string())?;
    let body: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "unreadable provider response".to_string())?;
    let rows = parse_fuel_prices(&body);
    if rows.is_empty() {
        return Err("provider returned no price rows".into());
    }
    Ok(rows)
}

async fn store_fuel_prices(
    pool: &PgPool,
    rows: &[(NaiveDate, &'static str, f64)],
) -> Result<(), AppError> {
    let months: Vec<NaiveDate> = rows.iter().map(|row| row.0).collect();
    let grades: Vec<&str> = rows.iter().map(|row| row.1).collect();
    let prices: Vec<f64> = rows.iter().map(|row| row.2).collect();
    sqlx::query(
        "INSERT INTO riviamigo.fuel_price_months (month, grade, price_usd_per_gallon, fetched_at)
         SELECT month, grade, price, now()
         FROM UNNEST($1::date[], $2::text[], $3::float8[]) AS incoming(month, grade, price)
         ON CONFLICT (month, grade) DO UPDATE SET
           price_usd_per_gallon = EXCLUDED.price_usd_per_gallon,
           fetched_at = EXCLUDED.fetched_at",
    )
    .bind(months)
    .bind(grades)
    .bind(prices)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RefreshDecision {
    /// Serve the stored months without contacting the provider.
    Serve { refresh_failed: bool },
    /// The stored copy is stale and no recent attempt holds a refresh back.
    Refresh { previously_failed: bool },
}

pub(super) fn refresh_decision(
    now: DateTime<Utc>,
    last_attempt_at: Option<DateTime<Utc>>,
    last_success_at: Option<DateTime<Utc>>,
    has_last_error: bool,
    last_stored_at: Option<DateTime<Utc>>,
) -> RefreshDecision {
    let previously_failed = has_last_error
        && last_attempt_at.is_some()
        && last_success_at.is_none_or(|success| last_attempt_at > Some(success));
    let fresh = last_stored_at.is_some_and(|at| now - at < FUEL_PRICE_REFRESH_INTERVAL);
    // A connection test also records an attempt. Until something is stored,
    // only a failed attempt may hold the first download back.
    let recently_attempted = last_attempt_at.is_some_and(|at| now - at < FUEL_PRICE_RETRY_INTERVAL)
        && (last_stored_at.is_some() || previously_failed);
    if fresh || recently_attempted {
        RefreshDecision::Serve {
            refresh_failed: !fresh && previously_failed,
        }
    } else {
        RefreshDecision::Refresh { previously_failed }
    }
}

/// Records a refresh attempt only if no other request has recorded one since
/// `observed_last_attempt_at` was read: a compare-and-set on the activity
/// row, so exactly one of several concurrent stale reads wins the refresh.
/// The row lock taken by `ON CONFLICT DO UPDATE` serializes the contenders,
/// and each re-checks the condition against the winner's committed value.
pub(super) async fn claim_fuel_price_refresh<'e>(
    executor: impl sqlx::PgExecutor<'e>,
    connection_id: &str,
    observed_last_attempt_at: Option<DateTime<Utc>>,
) -> Result<bool, AppError> {
    let claimed = sqlx::query_scalar::<_, String>(
        r#"INSERT INTO riviamigo.external_connection_activity AS activity
             (connection_id, last_attempt_at, usage_date, request_count)
           VALUES ($1, now(), CURRENT_DATE, 1)
           ON CONFLICT (connection_id) DO UPDATE SET
             last_attempt_at = now(),
             usage_date = CURRENT_DATE,
             request_count = CASE
               WHEN activity.usage_date = CURRENT_DATE THEN activity.request_count + 1
               ELSE 1 END
           WHERE activity.last_attempt_at IS NOT DISTINCT FROM $2
           RETURNING connection_id"#,
    )
    .bind(connection_id)
    .bind(observed_last_attempt_at)
    .fetch_optional(executor)
    .await?;
    Ok(claimed.is_some())
}

/// Refresh the stored series when the connection is enabled and the stored
/// copy is stale. Failures are recorded on the connection and never surface
/// as a request error: the page keeps working from stored months.
async fn refresh_fuel_prices_if_stale(
    pool: &PgPool,
    age_key: &str,
) -> Result<(bool, bool), AppError> {
    let settings = match connections::load(pool, connections::FUEL_PRICES).await {
        Ok(settings) => settings,
        Err(AppError::NotFound) => return Ok((false, false)),
        Err(error) => return Err(error),
    };
    if !settings.is_active() {
        return Ok((false, false));
    }

    let (last_attempt_at, last_success_at, last_error) =
        sqlx::query_as::<_, (Option<DateTime<Utc>>, Option<DateTime<Utc>>, Option<String>)>(
            "SELECT last_attempt_at, last_success_at, last_error
         FROM riviamigo.external_connection_activity
         WHERE connection_id = $1",
        )
        .bind(connections::FUEL_PRICES)
        .fetch_optional(pool)
        .await?
        .unwrap_or((None, None, None));
    let last_stored_at = sqlx::query_scalar::<_, Option<DateTime<Utc>>>(
        "SELECT MAX(fetched_at) FROM riviamigo.fuel_price_months",
    )
    .fetch_one(pool)
    .await?;

    let previously_failed = match refresh_decision(
        Utc::now(),
        last_attempt_at,
        last_success_at,
        last_error.is_some(),
        last_stored_at,
    ) {
        RefreshDecision::Serve { refresh_failed } => return Ok((true, refresh_failed)),
        RefreshDecision::Refresh { previously_failed } => previously_failed,
    };

    // Concurrent page loads all see the same stale state. Only the request
    // that records the attempt contacts the provider; the others serve the
    // stored months, exactly as if the attempt had just been made.
    match claim_fuel_price_refresh(pool, connections::FUEL_PRICES, last_attempt_at).await {
        Ok(true) => {}
        Ok(false) => return Ok((true, previously_failed)),
        Err(error) => {
            // A refresh failure never fails the page; serve what is stored.
            tracing::warn!(err = %error, "ownership.fuel_prices.claim_failed");
            return Ok((true, previously_failed));
        }
    }
    let api_key = decrypt_api_key(age_key, settings.api_key_encrypted.as_deref());
    let fetched = tokio::time::timeout(
        FUEL_PRICE_FETCH_TIMEOUT,
        fetch_fuel_prices(api_key.as_deref()),
    )
    .await
    .unwrap_or_else(|_| Err("request timed out".into()));
    let stored = match fetched {
        Ok(rows) => store_fuel_prices(pool, &rows)
            .await
            .map_err(|_| "could not store the downloaded prices".to_string()),
        Err(message) => Err(message),
    };
    match stored {
        Ok(()) => {
            connections::record_success(pool, connections::FUEL_PRICES).await;
            Ok((true, false))
        }
        Err(message) => {
            tracing::warn!(error = %message, "fuel price refresh failed");
            connections::record_failure(pool, connections::FUEL_PRICES, &message).await;
            Ok((true, true))
        }
    }
}

/// Stored monthly prices, refreshed first when the connection allows it.
/// Stored months are returned even while the connection is disabled.
pub async fn fuel_prices(pool: &PgPool, age_key: &str) -> Result<FuelPrices, AppError> {
    // A refresh problem never fails the page: report it as a failed refresh
    // and serve whatever months are stored.
    let (connection_enabled, refresh_failed) = refresh_fuel_prices_if_stale(pool, age_key)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(err = %error, "ownership.fuel_prices.refresh_check_failed");
            (true, true)
        });
    let rows = sqlx::query_as::<_, (NaiveDate, Option<f64>, Option<f64>, Option<DateTime<Utc>>)>(
        "SELECT month,
                MAX(price_usd_per_gallon) FILTER (WHERE grade = 'regular') AS regular_usd,
                MAX(price_usd_per_gallon) FILTER (WHERE grade = 'premium') AS premium_usd,
                MAX(fetched_at) AS fetched_at
         FROM riviamigo.fuel_price_months
         GROUP BY month
         ORDER BY month",
    )
    .fetch_all(pool)
    .await?;
    let last_updated_at = rows.iter().filter_map(|row| row.3).max();
    Ok(FuelPrices {
        connection_enabled,
        months: rows
            .into_iter()
            .map(|row| FuelPriceMonth {
                month: row.0,
                regular_usd: row.1,
                premium_usd: row.2,
            })
            .collect(),
        last_updated_at,
        refresh_failed,
    })
}
