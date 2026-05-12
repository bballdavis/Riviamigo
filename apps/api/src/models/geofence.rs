use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A named geographic circle used for location tagging and cost-profile lookup.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Geofence {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub radius_m: f64,
    pub address_id: Option<Uuid>,
    pub cost_profile_id: Option<Uuid>,
    pub is_home: bool,
    pub is_work: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Lightweight row returned when matching a point against a user's geofences.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct GeofenceMatch {
    pub id: Uuid,
    pub name: String,
    pub is_home: bool,
    pub is_work: bool,
    pub address_id: Option<Uuid>,
    pub cost_profile_id: Option<Uuid>,
    pub distance_m: f64,
}

/// Resolve the nearest geofence (if any) for a lat/lon point.
///
/// Uses the `cube`/`earthdistance` Postgres extensions via a single SQL
/// query; the caller must hold a reference to the pool.
pub async fn match_geofence(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    lat: f64,
    lon: f64,
) -> anyhow::Result<Option<GeofenceMatch>> {
    let row = sqlx::query_as::<_, GeofenceMatch>(
        r#"
        SELECT
          id,
          name,
          is_home,
          is_work,
                    address_id,
          cost_profile_id,
          earth_distance(
            ll_to_earth($2, $3),
            ll_to_earth(latitude, longitude)
                    ) AS "distance_m!: f64"
        FROM riviamigo.geofences
        WHERE user_id = $1
          AND earth_box(ll_to_earth(latitude, longitude), radius_m)
              @> ll_to_earth($2, $3)
          AND earth_distance(
                ll_to_earth(latitude, longitude),
                ll_to_earth($2, $3)
              ) <= radius_m
        ORDER BY 7 ASC
        LIMIT 1
        "#
    )
    .bind(user_id)
    .bind(lat)
    .bind(lon)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// OSM Nominatim address cache entry.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Address {
    pub id: Uuid,
    pub display_name: String,
    pub osm_id: Option<i64>,
    pub latitude: f64,
    pub longitude: f64,
    pub road: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postcode: Option<String>,
    pub country: Option<String>,
    pub raw: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    // Integration tests for match_geofence require a live DB; see
    // apps/api/tests/auth_integration.rs for the pattern.
    // Unit-test the pure geometry: does earth_distance approach make sense?
    // (tested at the SQL layer via the integration test fixture)
}
