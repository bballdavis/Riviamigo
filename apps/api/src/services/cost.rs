//! Cost profile resolution service.
//!
//! Resolution priority:
//!   1. Explicit `charge_sessions.cost_profile_id` (set by caller)
//!   2. Matched geofence's `cost_profile_id`
//!   3. Vehicle default `cost_profile_id`
//!   4. NULL → cost_method = "unknown"

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::cost_profile::CostProfile;

/// Resolve the applicable cost profile for a charging session.
///
/// `explicit_id`  — if the session already has a profile pinned, use it.
/// `geofence_id`  — geofence matched at session location (may carry a profile).
/// `vehicle_id`   — fallback: the vehicle's default profile.
///
/// Returns `None` if no profile is found at any tier.
pub async fn resolve_profile(
    pool: &PgPool,
    explicit_id: Option<Uuid>,
    geofence_id: Option<Uuid>,
    vehicle_id: Uuid,
) -> Result<Option<CostProfile>> {
    // Tier 1: explicit override
    if let Some(id) = explicit_id {
        if let Some(p) = fetch_profile(pool, id).await? {
            return Ok(Some(p));
        }
    }

    // Tier 2: geofence-linked profile
    if let Some(gf_id) = geofence_id {
        let profile_id: Option<Uuid> = sqlx::query_scalar!(
            "SELECT cost_profile_id FROM riviamigo.geofences WHERE id = $1",
            gf_id
        )
        .fetch_optional(pool)
        .await?
        .flatten();

        if let Some(id) = profile_id {
            if let Some(p) = fetch_profile(pool, id).await? {
                return Ok(Some(p));
            }
        }
    }

    // Tier 3: vehicle default
    let profile_id: Option<Uuid> = sqlx::query_scalar!(
        "SELECT cost_profile_id FROM riviamigo.vehicles WHERE id = $1",
        vehicle_id
    )
    .fetch_optional(pool)
    .await?
    .flatten();

    if let Some(id) = profile_id {
        return fetch_profile(pool, id).await;
    }

    Ok(None)
}

async fn fetch_profile(pool: &PgPool, id: Uuid) -> Result<Option<CostProfile>> {
    let row = sqlx::query_as!(
        CostProfile,
        r#"SELECT id, user_id, name, billing_type, rate, session_fee, currency,
                  effective_from, effective_to, created_at
           FROM riviamigo.cost_profiles WHERE id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}
