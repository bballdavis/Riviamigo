use anyhow::anyhow;
use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tracing::debug;
use uuid::Uuid;

use crate::{
    errors::AppError,
    middleware::auth::{AppState, AuthUser},
    models::cost_profile::{validate_tou_periods, TouPeriod},
    services::cost::recompute_charge_session_cost,
};

const SYNC_LINKED_SESSION_COST_PROFILE_SQL: &str = "UPDATE riviamigo.charge_sessions
        SET cost_profile_id=$2
      WHERE geofence_id=$1 AND cost_override_mode='automatic'
      RETURNING id";

/// Re-link automatically located charge sessions to the owner's nearest saved
/// place after places change, so a place's price reaches history and not only
/// sessions that close afterwards.
///
/// Candidates are sessions on vehicles `$1` owns, still in automatic location
/// mode and with known coordinates, that are linked to one of the places in
/// `$2`, listed in `$3`, or inside the radius of a place in `$2`. Each gets
/// the same nearest-place match ingestion applies. Its pinned profile is
/// cleared under automatic pricing because `recompute_charge_session_cost`
/// stores whichever profile it resolved, which would otherwise outrank the
/// place's profile.
const REMATCH_PLACE_SESSIONS_SQL: &str = r#"
WITH candidates AS (
    SELECT cs.id,
           cs.geofence_id AS previous_geofence_id,
           COALESCE(cs.source_location_lat, cs.location_lat) AS lat,
           COALESCE(cs.source_location_lng, cs.location_lng) AS lng
      FROM riviamigo.charge_sessions cs
      JOIN riviamigo.vehicle_memberships vm
        ON vm.vehicle_id = cs.vehicle_id AND vm.user_id = $1 AND vm.role = 'owner'
     WHERE cs.location_override_mode = 'automatic'
       AND COALESCE(cs.source_location_lat, cs.location_lat) IS NOT NULL
       AND COALESCE(cs.source_location_lng, cs.location_lng) IS NOT NULL
       AND (cs.geofence_id = ANY($2)
            OR cs.id = ANY($3)
            OR EXISTS (
                SELECT 1 FROM riviamigo.geofences g
                 WHERE g.id = ANY($2) AND g.user_id = $1
                   AND earth_box(ll_to_earth(g.latitude, g.longitude), g.radius_m)
                       @> ll_to_earth(COALESCE(cs.source_location_lat, cs.location_lat),
                                      COALESCE(cs.source_location_lng, cs.location_lng))
                   AND earth_distance(ll_to_earth(g.latitude, g.longitude),
                                      ll_to_earth(COALESCE(cs.source_location_lat, cs.location_lat),
                                                  COALESCE(cs.source_location_lng, cs.location_lng)))
                       <= g.radius_m))
),
matched AS (
    SELECT c.id, c.previous_geofence_id, m.id AS geofence_id, m.address_id, m.is_home
      FROM candidates c
      LEFT JOIN LATERAL (
          SELECT g.id, g.address_id, g.is_home
            FROM riviamigo.geofences g
           WHERE g.user_id = $1
             AND earth_box(ll_to_earth(g.latitude, g.longitude), g.radius_m)
                 @> ll_to_earth(c.lat, c.lng)
             AND earth_distance(ll_to_earth(g.latitude, g.longitude), ll_to_earth(c.lat, c.lng))
                 <= g.radius_m
           ORDER BY earth_distance(ll_to_earth(g.latitude, g.longitude), ll_to_earth(c.lat, c.lng))
           LIMIT 1
      ) m ON true
)
UPDATE riviamigo.charge_sessions cs
   SET geofence_id = matched.geofence_id,
       address_id = COALESCE(matched.address_id, cs.address_id),
       is_home = CASE
                     WHEN matched.geofence_id IS NOT NULL THEN matched.is_home
                     WHEN matched.previous_geofence_id IS NOT NULL THEN NULL
                     ELSE cs.is_home
                 END,
       cost_profile_id = CASE WHEN cs.cost_override_mode = 'automatic' THEN NULL ELSE cs.cost_profile_id END
  FROM matched
 WHERE cs.id = matched.id
RETURNING cs.id"#;

/// Detach every session from a place that is about to be deleted. Sessions
/// pinned to it fall back to automatic location, since the place is gone.
const DETACH_PLACE_SESSIONS_SQL: &str = "UPDATE riviamigo.charge_sessions
        SET geofence_id = NULL,
            is_home = NULL,
            location_override_mode = 'automatic',
            cost_profile_id = CASE WHEN cost_override_mode = 'automatic' THEN NULL ELSE cost_profile_id END
      WHERE geofence_id = $1
      RETURNING id";

/// Rematch sessions near `place_ids` (plus `session_ids`) to the owner's
/// nearest place inside `tx`, returning the sessions whose cost must be
/// recomputed once the transaction commits.
async fn rematch_place_sessions(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    place_ids: &[Uuid],
    session_ids: &[Uuid],
) -> Result<Vec<Uuid>, AppError> {
    sqlx::query_scalar::<_, Uuid>(REMATCH_PLACE_SESSIONS_SQL)
        .bind(user_id)
        .bind(place_ids)
        .bind(session_ids)
        .fetch_all(&mut **tx)
        .await
        .map_err(AppError::from)
}

async fn recompute_session_costs(
    pool: &sqlx::PgPool,
    mut session_ids: Vec<Uuid>,
) -> Result<(), AppError> {
    session_ids.sort_unstable();
    session_ids.dedup();
    for session_id in session_ids {
        recompute_charge_session_cost(pool, session_id).await?;
    }
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/places", get(list_places).post(create_place))
        .route("/places/search", get(search_places))
        .route(
            "/places/{id}",
            get(get_place).put(update_place).delete(delete_place),
        )
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

fn normalize_place_billing_type(raw: &str) -> &str {
    match raw {
        "flat" => "per_kwh",
        "tou" => "tou",
        "per_kwh" => "per_kwh",
        _ => raw,
    }
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
    fetch_places(&state.pool, auth.user_id, Some(id))
        .await?
        .into_iter()
        .next()
        .map(Json)
        .ok_or(AppError::NotFound)
}

async fn search_places(
    _auth: AuthUser,
    State(state): State<AppState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<Vec<AddressRecord>>, AppError> {
    let query = params.q.trim().to_lowercase();
    if query.len() < 3 {
        return Ok(Json(Vec::new()));
    }

    let limit = params.limit.unwrap_or(5);
    let persistent_cache_key = search_cache_key(&query, limit);

    // The persistent key contains only a digest, never the address query.
    // Redis is backed by an AOF volume in normal deployment and is cleared
    // explicitly from External Connections.
    if let Ok(mut redis) = state.redis.get_multiplexed_async_connection().await {
        if let Ok(Some(payload)) = redis.get::<_, Option<String>>(&persistent_cache_key).await {
            if let Ok(value) = serde_json::from_str::<Value>(&payload) {
                let suggestions: Vec<AddressRecord> = value
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .iter()
                    .filter_map(|v| value_to_address_record(v.clone()))
                    .collect();
                debug!(
                    cache_hit = true,
                    cache = "persistent",
                    suggestion_count = suggestions.len(),
                    "places.address_search_completed"
                );
                return Ok(Json(suggestions));
            }
        }
    }

    // --- in-process fallback cache (1 hour) ------------------------------
    {
        let cache = state.nominatim_cache.read().await;
        if let Some((cached_at, value)) = cache.get(&query) {
            if cached_at.elapsed() < Duration::from_secs(3600) {
                let suggestions: Vec<AddressRecord> = value
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .iter()
                    .filter_map(|v| value_to_address_record(v.clone()))
                    .collect();
                debug!(
                    cache_hit = true,
                    suggestion_count = suggestions.len(),
                    "places.address_search_completed"
                );
                return Ok(Json(suggestions));
            }
        }
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| {
            AppError::Internal(anyhow!("address search client build failed: {error}"))
        })?;
    let rows =
        crate::services::nominatim::search(&state.pool, &client, params.q.trim(), limit).await?;

    // --- populate cache --------------------------------------------------
    {
        let mut cache = state.nominatim_cache.write().await;
        // Evict expired entries to keep memory bounded
        cache.retain(|_, (cached_at, _)| cached_at.elapsed() < Duration::from_secs(3600));
        if cache.len() >= 500 {
            if let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, (cached_at, _))| *cached_at)
                .map(|(key, _)| key.clone())
            {
                cache.remove(&oldest);
            }
        }
        cache.insert(
            query.clone(),
            (
                std::time::Instant::now(),
                serde_json::Value::Array(rows.clone()),
            ),
        );
    }

    if let Ok(payload) = serde_json::to_string(&rows) {
        if let Ok(mut redis) = state.redis.get_multiplexed_async_connection().await {
            let _: Result<(), _> = redis.set(&persistent_cache_key, payload).await;
        }
    }

    let suggestions: Vec<AddressRecord> = rows
        .into_iter()
        .filter_map(value_to_address_record)
        .collect();

    debug!(
        cache_hit = false,
        suggestion_count = suggestions.len(),
        "places.address_search_completed"
    );

    Ok(Json(suggestions))
}

fn search_cache_key(query: &str, limit: u8) -> String {
    let mut hasher = Sha256::new();
    hasher.update(query.as_bytes());
    hasher.update([0]);
    hasher.update(limit.to_le_bytes());
    format!(
        "external:nominatim:search:{}",
        hex::encode(hasher.finalize())
    )
}

async fn create_place(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<PlaceBody>,
) -> Result<Json<PlaceRecord>, AppError> {
    validate_place_body(&body)?;

    let mut tx = state.pool.begin().await?;
    let address_id = upsert_address(&mut tx, &body.address).await?;
    let cost_profile_id = upsert_cost_profile(
        &mut tx,
        auth.user_id,
        None,
        body.charging.as_ref(),
        &body.name,
    )
    .await?;

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

    let sessions = rematch_place_sessions(&mut tx, auth.user_id, &[place_id], &[]).await?;

    tx.commit().await?;

    // A new place covers charges that happened before it existed, so its
    // price applies to that history too.
    recompute_session_costs(&state.pool, sessions).await?;

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
    let cost_profile_id = upsert_cost_profile(
        &mut tx,
        auth.user_id,
        existing.cost_profile_id,
        body.charging.as_ref(),
        &body.name,
    )
    .await?;

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

    // A moved or resized place can gain or lose automatically located
    // sessions; rematch them before syncing profiles.
    let mut sessions = rematch_place_sessions(&mut tx, auth.user_id, &[id], &[]).await?;

    // Keep each linked automatic session's explicit profile synchronized with
    // the place before recomputing. This also clears a removed place profile.
    sessions.extend(
        sqlx::query_scalar::<_, Uuid>(SYNC_LINKED_SESSION_COST_PROFILE_SQL)
            .bind(id)
            .bind(cost_profile_id)
            .fetch_all(&mut *tx)
            .await?,
    );

    tx.commit().await?;

    // Place pricing is an automatic policy. Explicit Free/Manual session
    // overrides are excluded above and retain their precedence.
    recompute_session_costs(&state.pool, sessions).await?;

    get_place(auth, State(state), Path(id)).await
}

async fn delete_place(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let owned = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM riviamigo.geofences WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(auth.user_id)
    .fetch_optional(&state.pool)
    .await?;
    if owned.is_none() {
        return Err(AppError::NotFound);
    }

    let mut tx = state.pool.begin().await?;
    // Sessions reference the place without ON DELETE, so detach them first;
    // then give them the next-nearest place, if any, and its price.
    let detached = sqlx::query_scalar::<_, Uuid>(DETACH_PLACE_SESSIONS_SQL)
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;

    let result = sqlx::query!(
        "DELETE FROM riviamigo.geofences WHERE id = $1 AND user_id = $2",
        id,
        auth.user_id
    )
    .execute(&mut *tx)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }

    let mut sessions = rematch_place_sessions(&mut tx, auth.user_id, &[], &detached).await?;
    sessions.extend(detached);
    tx.commit().await?;

    recompute_session_costs(&state.pool, sessions).await?;

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
                    id: Some(
                        row.address_id
                            .expect("address id should exist when address details are present"),
                    ),
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
                charging: row
                    .cost_profile_id
                    .map(|cost_profile_id| ChargingProfileRecord {
                        id: cost_profile_id,
                        name: row.cost_profile_name.unwrap_or_else(|| place_name.clone()),
                        billing_type: normalize_place_billing_type(
                            row.cost_profile_billing_type
                                .as_deref()
                                .unwrap_or("per_kwh"),
                        )
                        .to_string(),
                        rate: row.cost_profile_rate.unwrap_or(0.0),
                        session_fee: row.cost_profile_session_fee.unwrap_or(0.0),
                        currency: row.cost_profile_currency.unwrap_or_else(|| "USD".into()),
                        timezone: row.cost_profile_timezone,
                        tou_periods: row
                            .cost_profile_tou_periods
                            .unwrap_or_else(|| serde_json::json!([])),
                    }),
            }
        })
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
    let billing_type = normalize_place_billing_type(&input.billing_type).to_string();
    let tou_periods = input
        .tou_periods
        .clone()
        .unwrap_or_else(|| serde_json::json!([]));

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
            billing_type,
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
        billing_type,
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
        return Err(AppError::Validation(
            "an address selection is required".into(),
        ));
    }
    if !body.address.latitude.is_finite() || !body.address.longitude.is_finite() {
        return Err(AppError::Validation(
            "address coordinates must be valid numbers".into(),
        ));
    }
    if let Some(radius_m) = body.radius_m {
        if !radius_m.is_finite() || radius_m <= 0.0 {
            return Err(AppError::Validation(
                "radius_m must be a positive number".into(),
            ));
        }
    }
    if let Some(charging) = &body.charging {
        validate_charging_input(charging)?;
    }
    Ok(())
}

fn validate_charging_input(input: &ChargingProfileInput) -> Result<(), AppError> {
    let billing_type = normalize_place_billing_type(&input.billing_type);

    match billing_type {
        "per_kwh" | "tou" => {}
        _ => {
            return Err(AppError::Validation(
                "billing_type must be either per_kwh or tou for places".into(),
            ))
        }
    }

    if !input.rate.is_finite() || input.rate < 0.0 {
        return Err(AppError::Validation(
            "rate must be a non-negative number".into(),
        ));
    }

    if billing_type == "tou" {
        if input
            .timezone
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
        {
            return Err(AppError::Validation(
                "timezone is required for TOU charging plans".into(),
            ));
        }

        let periods: Vec<TouPeriod> = serde_json::from_value(
            input
                .tou_periods
                .clone()
                .unwrap_or_else(|| serde_json::json!([])),
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
        road: address
            .and_then(|value| {
                value
                    .get("road")
                    .or_else(|| value.get("pedestrian"))
                    .or_else(|| value.get("footway"))
            })
            .and_then(Value::as_str)
            .map(str::to_string),
        city: address
            .and_then(|value| {
                value
                    .get("city")
                    .or_else(|| value.get("town"))
                    .or_else(|| value.get("village"))
            })
            .and_then(Value::as_str)
            .map(str::to_string),
        state: address
            .and_then(|value| value.get("state"))
            .and_then(Value::as_str)
            .map(str::to_string),
        postcode: address
            .and_then(|value| value.get("postcode"))
            .and_then(Value::as_str)
            .map(str::to_string),
        country: address
            .and_then(|value| value.get("country"))
            .and_then(Value::as_str)
            .map(str::to_string),
        raw: Some(raw),
    })
}

#[cfg(test)]
mod tests {
    use super::{search_cache_key, SYNC_LINKED_SESSION_COST_PROFILE_SQL};

    #[test]
    fn persistent_search_key_does_not_contain_address_text() {
        let key = search_cache_key("123 Main Street, Austin", 5);
        assert!(key.starts_with("external:nominatim:search:"));
        assert!(!key.contains("Main"));
        assert_ne!(key, search_cache_key("124 Main Street, Austin", 5));
    }

    #[test]
    fn place_pricing_edits_replace_or_clear_linked_automatic_session_profiles() {
        assert!(SYNC_LINKED_SESSION_COST_PROFILE_SQL.contains("SET cost_profile_id=$2"));
        assert!(SYNC_LINKED_SESSION_COST_PROFILE_SQL.contains("geofence_id=$1"));
        assert!(SYNC_LINKED_SESSION_COST_PROFILE_SQL.contains("cost_override_mode='automatic'"));
        assert!(SYNC_LINKED_SESSION_COST_PROFILE_SQL.contains("RETURNING id"));
    }
}
