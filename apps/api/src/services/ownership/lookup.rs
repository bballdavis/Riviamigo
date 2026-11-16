//! Vehicle lookup against the fueleconomy.gov menu and record endpoints, reduced
//! to the figures the ownership cost model uses.

use std::time::Duration as StdDuration;

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

use super::reference::Powertrain;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LookupOption {
    pub text: String,
    pub value: String,
}

/// fueleconomy.gov returns `null` for no matches, a bare object for exactly
/// one match, and an array otherwise.
pub fn parse_lookup_menu(body: &serde_json::Value) -> Vec<LookupOption> {
    let to_option = |item: &serde_json::Value| {
        Some(LookupOption {
            text: item.get("text")?.as_str()?.to_string(),
            value: item.get("value")?.as_str()?.to_string(),
        })
    };
    match body.get("menuItem") {
        Some(serde_json::Value::Array(items)) => items.iter().filter_map(to_option).collect(),
        Some(item @ serde_json::Value::Object(_)) => to_option(item).into_iter().collect(),
        _ => Vec::new(),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LookupVehicle {
    pub epa_id: String,
    pub label: String,
    pub powertrain: Powertrain,
    pub mpg: Option<f64>,
    pub kwh_per_mi: Option<f64>,
    pub premium_fuel: bool,
    pub fuel_description: String,
}

fn text_field<'a>(body: &'a serde_json::Value, key: &str) -> &'a str {
    body.get(key).and_then(|value| value.as_str()).unwrap_or("")
}

fn number_field(body: &serde_json::Value, key: &str) -> Option<f64> {
    let value = body.get(key)?;
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
        .filter(|number: &f64| number.is_finite() && *number > 0.0)
}

/// Reduce a fueleconomy.gov vehicle record to the figures the cost model uses.
pub fn parse_lookup_vehicle(body: &serde_json::Value) -> Option<LookupVehicle> {
    let epa_id = body.get("id").and_then(|id| {
        id.as_str()
            .map(str::to_string)
            .or_else(|| id.as_i64().map(|n| n.to_string()))
    })?;
    let fuel = text_field(body, "fuelType1");
    let alternative = text_field(body, "atvType");
    let label = [
        text_field(body, "year"),
        text_field(body, "make"),
        text_field(body, "model"),
    ]
    .iter()
    .filter(|part| !part.is_empty())
    .copied()
    .collect::<Vec<_>>()
    .join(" ");
    if label.is_empty() {
        return None;
    }

    let electric =
        alternative.eq_ignore_ascii_case("EV") || fuel.eq_ignore_ascii_case("Electricity");
    if electric {
        // combE is kWh per 100 miles.
        let kwh_per_mi = number_field(body, "combE")? / 100.0;
        return Some(LookupVehicle {
            epa_id,
            label,
            powertrain: Powertrain::Ev,
            mpg: None,
            kwh_per_mi: Some((kwh_per_mi * 1000.0).round() / 1000.0),
            premium_fuel: false,
            fuel_description: "Electricity".into(),
        });
    }
    let mpg = number_field(body, "comb08")?;
    let hybrid = alternative.to_ascii_lowercase().contains("hybrid");
    Some(LookupVehicle {
        epa_id,
        label,
        powertrain: if hybrid {
            Powertrain::Hybrid
        } else {
            Powertrain::Gas
        },
        mpg: Some(mpg),
        kwh_per_mi: None,
        premium_fuel: fuel.to_ascii_lowercase().contains("premium"),
        fuel_description: if fuel.is_empty() {
            "Gasoline".into()
        } else {
            fuel.to_string()
        },
    })
}

/// Fetch one JSON document from the vehicle-lookup provider, recording the
/// attempt against the connection. Fails with `ExternalConnectionDisabled`
/// when an administrator has turned the connection off.
pub async fn lookup_json(
    pool: &PgPool,
    path: &str,
    query: &[(&str, String)],
) -> Result<serde_json::Value, AppError> {
    let id = connections::VEHICLE_LOOKUP;
    connections::require_enabled(pool, id).await?;
    let mut endpoint = Url::parse(&format!("{}/{path}", connections::VEHICLE_LOOKUP_BASE_URL))
        .map_err(|_| AppError::Validation("vehicle lookup endpoint is invalid".into()))?;
    for (key, value) in query {
        endpoint.query_pairs_mut().append_pair(key, value);
    }
    connections::record_attempt(pool, id).await;
    let response = outbound_client_for_url(&endpoint, &[])
        .await?
        .get(endpoint)
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(StdDuration::from_secs(10))
        .send()
        .await
        .map_err(|error| {
            AppError::DependencyUnavailable(format!(
                "vehicle lookup failed: {}",
                error.without_url()
            ))
        });
    let response = match response {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            connections::record_failure(pool, id, &format!("HTTP {}", response.status())).await;
            return Err(AppError::DependencyUnavailable(
                "vehicle lookup provider returned an error".into(),
            ));
        }
        Err(error) => {
            connections::record_failure(pool, id, "request failed").await;
            return Err(error);
        }
    };
    let bytes = read_response_limited(response, 2 * 1024 * 1024, "Vehicle lookup").await?;
    connections::record_success(pool, id).await;
    // The provider answers "no matches" with the JSON literal `null`.
    Ok(serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
}
