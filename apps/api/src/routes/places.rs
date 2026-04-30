use anyhow::anyhow;
use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    models::cost_profile::{TouPeriod, validate_tou_periods},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/places", get(list_places).post(create_place))
        .route("/places/search", get(search_places))
        .route("/places/:id", get(get_place).put(update_place).delete(delete_place))
}

#[derive(Debug, Serialize)]
struct PlaceRecord {
    id: Uuid,
    name: String,
    latitude: f64,
    longitude: f64,
    radius_m: f64,
    is_home: bool,
    is_work: bool,
    address: Option<AddressRecord>,
    charging: Option<ChargingProfileRecord>,
}

#[derive(Debug, Serialize)]
struct AddressRecord {
    id: Option<Uuid>,
    display_name: String,
    osm_id: Option<i64>,
    latitude: f64,
    longitude: f64,
    road: Option<String>,
    city: Option<String>,
    state: Option<String>,
    postcode: Option<String>,
    country: Option<String>,
    raw: Option<Value>,
}

#[derive(Debug, Serialize)]
struct ChargingProfileRecord {
    id: Uuid,
    name: String,
    billing_type: String,
    rate: f64,
    session_fee: f64,
    currency: String,
    timezone: Option<String>,
    tou_periods: Value,
}

#[derive(Serialize)]
struct PlacesResponse {
    places: Vec<PlaceRecord>,
}

#[derive(Deserialize)]
struct SearchParams {
    q: String,
    limit: Option<u8>,
}

#[derive(Deserialize)]
struct PlaceBody {
    name: String,
    radius_m: Option<f64>,
    is_home: Option<bool>,
    is_work: Option<bool>,
    address: AddressInput,
    charging: Option<ChargingProfileInput>,
}

#[derive(Debug, Clone, Deserialize)]
struct AddressInput {
    display_name: String,
    osm_id: Option<i64>,
    latitude: f64,
    longitude: f64,
    road: Option<String>,
    city: Option<String>,
    state: Option<String>,
    postcode: Option<String>,
    country: Option<String>,
    raw: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct ChargingProfileInput {
    name: Option<String>,
    billing_type: String,
    rate: f64,
    session_fee: Option<f64>,
    currency: Option<String>,
    timezone: Option<String>,
    tou_periods: Option<Value>,
}

async fn list_places(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<PlacesResponse>, AppError> {
    Ok(Json(PlacesResponse {
        places: fetch_places(&state.pool, auth.user_id, None).await?,
    }))
}

async fn get_place(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<PlaceRecord>, AppError> {
    fetch_places(&state.pool, auth.user_id, Some(id)).await?
        .into_iter()
        .next()
        .map(Json)
        .ok_or(AppError::NotFound)
}

async fn search_places(
    _auth: AuthUser,
    Query(params): Query<SearchParams>,
) -> Result<Json<Vec<AddressRecord>>, AppError> {
    let query = params.q.trim();
    if query.len() < 3 {
        return Ok(Json(Vec::new()));
    }

    let client = reqwest::Client::new();
    let response = client
        .get("https://nominatim.openstreetmap.org/search")
        .header(reqwest::header::USER_AGENT, "Riviamigo/0.1 places search")
        .query(&[
            ("format", "jsonv2"),
            ("addressdetails", "1"),
            ("limit", &params.limit.unwrap_or(5).clamp(1, 10).to_string()),
            ("q", query),
        ])
        .send()
        .await
        .map_err(|error| AppError::Internal(anyhow!("address search request failed: {error}")))?
        .error_for_status()
        .map_err(|error| AppError::Internal(anyhow!("address search failed: {error}")))?;

    let rows: Vec<Value> = response
        .json()
        .await
        .map_err(|error| AppError::Internal(anyhow!("address search payload decode failed: {error}")))?;

    let suggestions = rows
        .into_iter()
        .filter_map(value_to_address_record)
        .collect();

    Ok(Json(suggestions))
}

async fn create_place(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<PlaceBody>,
) -> Result<Json<PlaceRecord>, AppError> {
    validate_place_body(&body)?;

    let mut tx = state.pool.begin().await?;
    let address_id = upsert_address(&mut tx, &body.address).await?;
    let cost_profile_id = upsert_cost_profile(&mut tx, auth.user_id, None, body.charging.as_ref(), &body.name).await?;

    let place_id = sqlx::query_scalar!(
        r#"INSERT INTO riviamigo.geofences
           (user_id, name, latitude, longitude, radius_m, address_id, is_home, is_work, cost_profile_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id"#,
        auth.user_id,
        body.name,
        body.address.latitude,
        body.address.longitude,
        body.radius_m.unwrap_or(75.0),
        address_id,
        body.is_home.unwrap_or(false),
        body.is_work.unwrap_or(false),
        cost_profile_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    get_place(auth, State(state), Path(place_id)).await
}

async fn update_place(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PlaceBody>,
) -> Result<Json<PlaceRecord>, AppError> {
    validate_place_body(&body)?;

    let existing = sqlx::query!(
        "SELECT cost_profile_id FROM riviamigo.geofences WHERE id = $1 AND user_id = $2",
        id,
        auth.user_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let mut tx = state.pool.begin().await?;
    let address_id = upsert_address(&mut tx, &body.address).await?;
    let cost_profile_id = upsert_cost_profile(&mut tx, auth.user_id, existing.cost_profile_id, body.charging.as_ref(), &body.name).await?;

    let updated = sqlx::query!(
        r#"UPDATE riviamigo.geofences
           SET name = $3,
               latitude = $4,
               longitude = $5,
               radius_m = $6,
               address_id = $7,
               is_home = $8,
               is_work = $9,
               cost_profile_id = $10,
               updated_at = now()
           WHERE id = $1 AND user_id = $2"#,
        id,
        auth.user_id,
        body.name,
        body.address.latitude,
        body.address.longitude,
        body.radius_m.unwrap_or(75.0),
        address_id,
        body.is_home.unwrap_or(false),
        body.is_work.unwrap_or(false),
        cost_profile_id,
    )
    .execute(&mut *tx)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    tx.commit().await?;

    get_place(auth, State(state), Path(id)).await
}

async fn delete_place(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let result = sqlx::query!(
        "DELETE FROM riviamigo.geofences WHERE id = $1 AND user_id = $2",
        id,
        auth.user_id
    )
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn fetch_places(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    place_id: Option<Uuid>,
) -> Result<Vec<PlaceRecord>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT
               g.id,
               g.name,
               g.latitude,
               g.longitude,
               g.radius_m,
               g.is_home,
               g.is_work,
               a.id AS "address_id?: Uuid",
               a.display_name AS "address_display_name?",
               a.osm_id AS "address_osm_id?",
               a.latitude AS "address_latitude?",
               a.longitude AS "address_longitude?",
               a.road AS "address_road?",
               a.city AS "address_city?",
               a.state AS "address_state?",
               a.postcode AS "address_postcode?",
               a.country AS "address_country?",
               a.raw AS "address_raw?: Value",
               cp.id AS "cost_profile_id?: Uuid",
               cp.name AS "cost_profile_name?",
               cp.billing_type AS "cost_profile_billing_type?",
               cp.rate AS "cost_profile_rate?",
               cp.session_fee AS "cost_profile_session_fee?",
               cp.currency AS "cost_profile_currency?",
               cp.timezone AS "cost_profile_timezone?",
               cp.tou_periods AS "cost_profile_tou_periods?: Value"
           FROM riviamigo.geofences g
           LEFT JOIN riviamigo.addresses a ON a.id = g.address_id
           LEFT JOIN riviamigo.cost_profiles cp ON cp.id = g.cost_profile_id
           WHERE g.user_id = $1
             AND ($2::uuid IS NULL OR g.id = $2)
           ORDER BY g.name"#,
        user_id,
        place_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let place_name = row.name;

            PlaceRecord {
            id: row.id,
            name: place_name.clone(),
            latitude: row.latitude,
            longitude: row.longitude,
            radius_m: row.radius_m,
            is_home: row.is_home,
            is_work: row.is_work,
            address: row.address_display_name.map(|display_name| AddressRecord {
                id: Some(row.address_id.expect("address id should exist when address details are present")),
                display_name,
                osm_id: row.address_osm_id,
                latitude: row.address_latitude.unwrap_or(row.latitude),
                longitude: row.address_longitude.unwrap_or(row.longitude),
                road: row.address_road,
                city: row.address_city,
                state: row.address_state,
                postcode: row.address_postcode,
                country: row.address_country,
                raw: row.address_raw,
            }),
            charging: row.cost_profile_id.map(|cost_profile_id| ChargingProfileRecord {
                id: cost_profile_id,
                name: row.cost_profile_name.unwrap_or_else(|| place_name.clone()),
                billing_type: row.cost_profile_billing_type.unwrap_or_else(|| "flat".into()),
                rate: row.cost_profile_rate.unwrap_or(0.0),
                session_fee: row.cost_profile_session_fee.unwrap_or(0.0),
                currency: row.cost_profile_currency.unwrap_or_else(|| "USD".into()),
                timezone: row.cost_profile_timezone,
                tou_periods: row.cost_profile_tou_periods.unwrap_or_else(|| serde_json::json!([])),
            }),
        }} )
        .collect())
}

async fn upsert_address(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    input: &AddressInput,
) -> Result<Uuid, AppError> {
    if let Some(osm_id) = input.osm_id {
        let address_id = sqlx::query_scalar!(
            r#"INSERT INTO riviamigo.addresses
               (display_name, osm_id, latitude, longitude, road, city, state, postcode, country, raw)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (osm_id) DO UPDATE SET
                 display_name = EXCLUDED.display_name,
                 latitude = EXCLUDED.latitude,
                 longitude = EXCLUDED.longitude,
                 road = EXCLUDED.road,
                 city = EXCLUDED.city,
                 state = EXCLUDED.state,
                 postcode = EXCLUDED.postcode,
                 country = EXCLUDED.country,
                 raw = EXCLUDED.raw
               RETURNING id"#,
            input.display_name,
            osm_id,
            input.latitude,
            input.longitude,
            input.road,
            input.city,
            input.state,
            input.postcode,
            input.country,
            input.raw,
        )
        .fetch_one(&mut **tx)
        .await?;

        return Ok(address_id);
    }

    sqlx::query_scalar!(
        r#"INSERT INTO riviamigo.addresses
           (display_name, latitude, longitude, road, city, state, postcode, country, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id"#,
        input.display_name,
        input.latitude,
        input.longitude,
        input.road,
        input.city,
        input.state,
        input.postcode,
        input.country,
        input.raw,
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(AppError::from)
}

async fn upsert_cost_profile(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    existing_profile_id: Option<Uuid>,
    input: Option<&ChargingProfileInput>,
    place_name: &str,
) -> Result<Option<Uuid>, AppError> {
    let Some(input) = input else {
        return Ok(None);
    };

    validate_charging_input(input)?;
    let profile_name = input
        .name
        .clone()
        .unwrap_or_else(|| format!("{} charging", place_name.trim()));
    let session_fee = input.session_fee.unwrap_or(0.0);
    let currency = input.currency.clone().unwrap_or_else(|| "USD".into());
    let tou_periods = input.tou_periods.clone().unwrap_or_else(|| serde_json::json!([]));

    if let Some(profile_id) = existing_profile_id {
        let updated_id = sqlx::query_scalar!(
            r#"UPDATE riviamigo.cost_profiles
               SET name = $3,
                   billing_type = $4,
                   rate = $5,
                   session_fee = $6,
                   currency = $7,
                   timezone = $8,
                   tou_periods = $9
               WHERE id = $1 AND user_id = $2
               RETURNING id"#,
            profile_id,
            user_id,
            profile_name,
            input.billing_type,
            input.rate,
            session_fee,
            currency,
            input.timezone,
            tou_periods,
        )
        .fetch_optional(&mut **tx)
        .await?;

        if updated_id.is_some() {
            return Ok(updated_id);
        }
    }

    let created_id = sqlx::query_scalar!(
        r#"INSERT INTO riviamigo.cost_profiles
           (user_id, name, billing_type, rate, session_fee, currency, timezone, tou_periods)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id"#,
        user_id,
        profile_name,
        input.billing_type,
        input.rate,
        session_fee,
        currency,
        input.timezone,
        tou_periods,
    )
    .fetch_one(&mut **tx)
    .await?;

    Ok(Some(created_id))
}

fn validate_place_body(body: &PlaceBody) -> Result<(), AppError> {
    if body.name.trim().is_empty() {
        return Err(AppError::Validation("place name is required".into()));
    }
    if body.address.display_name.trim().is_empty() {
        return Err(AppError::Validation("an address selection is required".into()));
    }
    if !body.address.latitude.is_finite() || !body.address.longitude.is_finite() {
        return Err(AppError::Validation("address coordinates must be valid numbers".into()));
    }
    if let Some(radius_m) = body.radius_m {
        if !radius_m.is_finite() || radius_m <= 0.0 {
            return Err(AppError::Validation("radius_m must be a positive number".into()));
        }
    }
    if let Some(charging) = &body.charging {
        validate_charging_input(charging)?;
    }
    Ok(())
}

fn validate_charging_input(input: &ChargingProfileInput) -> Result<(), AppError> {
    match input.billing_type.as_str() {
        "flat" | "tou" => {}
        _ => {
            return Err(AppError::Validation(
                "billing_type must be either flat or tou for places".into(),
            ))
        }
    }

    if !input.rate.is_finite() || input.rate < 0.0 {
        return Err(AppError::Validation("rate must be a non-negative number".into()));
    }

    if input.billing_type == "tou" {
        if input.timezone.as_deref().map(str::trim).filter(|value| !value.is_empty()).is_none() {
            return Err(AppError::Validation("timezone is required for TOU charging plans".into()));
        }

        let periods: Vec<TouPeriod> = serde_json::from_value(
            input.tou_periods.clone().unwrap_or_else(|| serde_json::json!([])),
        )
        .map_err(|_| AppError::Validation("tou_periods must be a JSON array".into()))?;

        validate_tou_periods(&periods).map_err(AppError::Validation)?;
    }

    Ok(())
}

fn value_to_address_record(raw: Value) -> Option<AddressRecord> {
    let latitude = raw.get("lat")?.as_str()?.parse().ok()?;
    let longitude = raw.get("lon")?.as_str()?.parse().ok()?;
    let display_name = raw.get("display_name")?.as_str()?.to_string();
    let address = raw.get("address").and_then(Value::as_object);

    Some(AddressRecord {
        id: None,
        display_name,
        osm_id: raw.get("osm_id").and_then(Value::as_i64),
        latitude,
        longitude,
        road: address.and_then(|value| value.get("road").or_else(|| value.get("pedestrian")).or_else(|| value.get("footway"))).and_then(Value::as_str).map(str::to_string),
        city: address.and_then(|value| value.get("city").or_else(|| value.get("town")).or_else(|| value.get("village"))).and_then(Value::as_str).map(str::to_string),
        state: address.and_then(|value| value.get("state")).and_then(Value::as_str).map(str::to_string),
        postcode: address.and_then(|value| value.get("postcode")).and_then(Value::as_str).map(str::to_string),
        country: address.and_then(|value| value.get("country")).and_then(Value::as_str).map(str::to_string),
        raw: Some(raw),
    })
}