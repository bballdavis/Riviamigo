//! Ownership dashboard inputs: purchase and running-cost settings, monthly
//! usage actuals, reference vehicles, cached fuel prices, and the
//! year/make/model lookup used to add a comparison vehicle.

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::vehicles::{require_vehicle_manager_access, require_vehicle_session_access},
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    services::{
        external_connections as connections,
        ownership::{
            self, ClassDefaults, CostAssumptions, FuelPrices, LookupOption, LookupVehicle,
            OwnershipSettings, ReferenceVehicle, Usage,
        },
    },
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/vehicles/{vehicle_id}/ownership",
            get(get_ownership).put(put_ownership_settings),
        )
        .route(
            "/vehicles/{vehicle_id}/ownership/settings",
            get(get_ownership_settings),
        )
        .route("/ownership/vehicle-lookup/years", get(lookup_years))
        .route("/ownership/vehicle-lookup/makes", get(lookup_makes))
        .route("/ownership/vehicle-lookup/models", get(lookup_models))
        .route("/ownership/vehicle-lookup/options", get(lookup_options))
        .route(
            "/ownership/vehicle-lookup/vehicles/{epa_id}",
            get(lookup_vehicle),
        )
}

#[derive(Serialize)]
struct OwnershipResponse {
    vehicle_id: Uuid,
    can_edit: bool,
    settings: OwnershipSettings,
    usage: Usage,
    fuel_prices: FuelPrices,
    vehicle_lookup_enabled: bool,
    reference_vehicles: Vec<ReferenceVehicle>,
    class_defaults: ClassDefaults,
    own_defaults: CostAssumptions,
}

#[derive(Serialize)]
struct OwnershipSettingsResponse {
    vehicle_id: Uuid,
    can_edit: bool,
    settings: OwnershipSettings,
}

async fn can_edit(state: &AppState, auth: &AuthUser, vehicle_id: Uuid) -> Result<bool, AppError> {
    match require_vehicle_manager_access(&state.pool, auth, vehicle_id).await {
        Ok(()) => Ok(true),
        Err(AppError::Forbidden | AppError::NotFound) => Ok(false),
        Err(error) => Err(error),
    }
}

async fn get_ownership(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<OwnershipResponse>, AppError> {
    require_vehicle_session_access(&state.pool, &auth, vehicle_id).await?;
    let settings = ownership::load_settings(&state.pool, vehicle_id).await?;
    let usage = ownership::load_usage(&state.pool, vehicle_id).await?;
    let fuel_prices = ownership::fuel_prices(&state.pool, &state.age_key).await?;
    let vehicle_lookup_enabled =
        match connections::load(&state.pool, connections::VEHICLE_LOOKUP).await {
            Ok(connection) => connection.is_active(),
            Err(AppError::NotFound) => false,
            Err(error) => return Err(error),
        };
    Ok(Json(OwnershipResponse {
        vehicle_id,
        can_edit: can_edit(&state, &auth, vehicle_id).await?,
        settings,
        usage,
        fuel_prices,
        vehicle_lookup_enabled,
        reference_vehicles: ownership::reference_vehicles(),
        class_defaults: ownership::class_defaults(),
        own_defaults: ownership::own_vehicle_defaults(),
    }))
}

async fn get_ownership_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
) -> Result<Json<OwnershipSettingsResponse>, AppError> {
    require_vehicle_session_access(&state.pool, &auth, vehicle_id).await?;
    Ok(Json(OwnershipSettingsResponse {
        vehicle_id,
        can_edit: can_edit(&state, &auth, vehicle_id).await?,
        settings: ownership::load_settings(&state.pool, vehicle_id).await?,
    }))
}

/// Replaces the stored settings: a field sent as `null` is cleared.
async fn put_ownership_settings(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(vehicle_id): Path<Uuid>,
    Json(body): Json<OwnershipSettings>,
) -> Result<Json<OwnershipSettingsResponse>, AppError> {
    require_vehicle_manager_access(&state.pool, &auth, vehicle_id).await?;
    // The browser checks the purchase date against its own calendar day,
    // which can be a day ahead of UTC.
    let latest_purchase_date = Utc::now().date_naive() + chrono::Days::new(1);
    let settings = ownership::validate_settings(body, latest_purchase_date)?;
    ownership::save_settings(&state.pool, vehicle_id, auth.user_id, &settings).await?;
    Ok(Json(OwnershipSettingsResponse {
        vehicle_id,
        can_edit: true,
        settings,
    }))
}

// ---------------------------------------------------------------------------
// Vehicle lookup
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct LookupMenuResponse {
    items: Vec<LookupOption>,
}

#[derive(Deserialize)]
struct LookupQuery {
    year: Option<i32>,
    make: Option<String>,
    model: Option<String>,
}

/// The lookup is not vehicle-scoped, so it is limited to signed-in sessions:
/// an integration API key has no reason to drive requests to the provider.
fn require_session(auth: &AuthUser) -> Result<(), AppError> {
    if auth.api_access_level.is_some() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

fn lookup_year(query: &LookupQuery) -> Result<String, AppError> {
    match query.year {
        Some(year) if (1984..=2100).contains(&year) => Ok(year.to_string()),
        _ => Err(AppError::Validation(
            "year must be between 1984 and 2100".into(),
        )),
    }
}

fn lookup_text(name: &str, value: Option<&str>) -> Result<String, AppError> {
    ownership::clean_label(value.unwrap_or(""), 80)
        .ok_or_else(|| AppError::Validation(format!("{name} must be 1 to 80 characters")))
}

async fn lookup_menu(
    state: &AppState,
    auth: &AuthUser,
    path: &str,
    query: &[(&str, String)],
) -> Result<Json<LookupMenuResponse>, AppError> {
    require_session(auth)?;
    let body = ownership::lookup_json(&state.pool, path, query).await?;
    Ok(Json(LookupMenuResponse {
        items: ownership::parse_lookup_menu(&body),
    }))
}

async fn lookup_years(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<LookupMenuResponse>, AppError> {
    lookup_menu(&state, &auth, "vehicle/menu/year", &[]).await
}

async fn lookup_makes(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<LookupQuery>,
) -> Result<Json<LookupMenuResponse>, AppError> {
    let year = lookup_year(&query)?;
    lookup_menu(&state, &auth, "vehicle/menu/make", &[("year", year)]).await
}

async fn lookup_models(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<LookupQuery>,
) -> Result<Json<LookupMenuResponse>, AppError> {
    let year = lookup_year(&query)?;
    let make = lookup_text("make", query.make.as_deref())?;
    lookup_menu(
        &state,
        &auth,
        "vehicle/menu/model",
        &[("year", year), ("make", make)],
    )
    .await
}

async fn lookup_options(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<LookupQuery>,
) -> Result<Json<LookupMenuResponse>, AppError> {
    let year = lookup_year(&query)?;
    let make = lookup_text("make", query.make.as_deref())?;
    let model = lookup_text("model", query.model.as_deref())?;
    lookup_menu(
        &state,
        &auth,
        "vehicle/menu/options",
        &[("year", year), ("make", make), ("model", model)],
    )
    .await
}

async fn lookup_vehicle(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(epa_id): Path<u32>,
) -> Result<Json<LookupVehicle>, AppError> {
    require_session(&auth)?;
    let body = ownership::lookup_json(&state.pool, &format!("vehicle/{epa_id}"), &[]).await?;
    ownership::parse_lookup_vehicle(&body)
        .map(Json)
        .ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_inputs_are_bounded() {
        let query = |year| LookupQuery {
            year,
            make: None,
            model: None,
        };
        assert!(lookup_year(&query(Some(2025))).is_ok());
        assert!(lookup_year(&query(Some(1900))).is_err());
        assert!(lookup_year(&query(None)).is_err());
        assert_eq!(lookup_text("make", Some("  Kia ")).unwrap(), "Kia");
        assert!(lookup_text("make", Some("")).is_err());
        assert!(lookup_text("make", Some(&"x".repeat(81))).is_err());
        assert!(lookup_text("make", Some("Kia\n")).is_ok());
        assert!(lookup_text("make", Some("Ki\na")).is_err());
    }
}
