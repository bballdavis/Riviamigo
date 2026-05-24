//! Cost profile resolution service.
//!
//! Resolution priority:
//!   1. Explicit `charge_sessions.cost_profile_id` (set by caller)
//!   2. Matched geofence's `cost_profile_id`
//!   3. Vehicle default `cost_profile_id`
//!   4. NULL → cost_method = "unknown"

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::cost_profile::{compute_cost, CostProfile};

#[derive(Debug, Clone, PartialEq)]
pub struct ChargeCostComputation {
    pub cost_profile_id: Option<Uuid>,
    pub cost_method: String,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, sqlx::FromRow)]
struct ChargeSessionCostRow {
    id: Uuid,
    vehicle_id: Uuid,
    geofence_id: Option<Uuid>,
    cost_profile_id: Option<Uuid>,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    duration_minutes: Option<i32>,
    kwh_added: Option<f64>,
    energy_added_wh: Option<f64>,
    energy_used_wh: Option<f64>,
    rivian_paid_total: Option<f64>,
    is_public: Option<bool>,
    is_rivian_network: Option<bool>,
}

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
    started_at: DateTime<Utc>,
) -> Result<Option<CostProfile>> {
    // Tier 1: explicit override
    if let Some(id) = explicit_id {
        if let Some(p) = fetch_profile(pool, id).await? {
            if p.is_effective_at(started_at) {
                return Ok(Some(p));
            }
        }
    }

    // Tier 2: geofence-linked profile
    if let Some(gf_id) = geofence_id {
        let profile_id: Option<Uuid> =
            sqlx::query_scalar("SELECT cost_profile_id FROM riviamigo.geofences WHERE id = $1")
                .bind(gf_id)
                .fetch_optional(pool)
                .await?
                .flatten();

        if let Some(id) = profile_id {
            if let Some(p) = fetch_profile(pool, id).await? {
                if p.is_effective_at(started_at) {
                    return Ok(Some(p));
                }
            }
        }
    }

    // Tier 3: vehicle default
    let profile_id: Option<Uuid> =
        sqlx::query_scalar("SELECT cost_profile_id FROM riviamigo.vehicles WHERE id = $1")
            .bind(vehicle_id)
            .fetch_optional(pool)
            .await?
            .flatten();

    if let Some(id) = profile_id {
        if let Some(p) = fetch_profile(pool, id).await? {
            if p.is_effective_at(started_at) {
                return Ok(Some(p));
            }
        }
    }

    Ok(None)
}

pub async fn recompute_charge_session_cost(
    pool: &PgPool,
    session_id: Uuid,
) -> Result<Option<ChargeCostComputation>> {
    let session = sqlx::query_as::<_, ChargeSessionCostRow>(
        r#"SELECT id, vehicle_id, geofence_id, cost_profile_id, started_at, ended_at,
                  duration_minutes, kwh_added, energy_added_wh, energy_used_wh,
                  rivian_paid_total, is_public, is_rivian_network
           FROM riviamigo.charge_sessions
           WHERE id = $1"#,
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await?;

    let Some(session) = session else {
        return Ok(None);
    };

    let profile = resolve_profile(
        pool,
        session.cost_profile_id,
        session.geofence_id,
        session.vehicle_id,
        session.started_at,
    )
    .await?;
    let authoritative_paid_total =
        (session.is_public == Some(true) || session.is_rivian_network == Some(true))
            .then_some(session.rivian_paid_total)
            .flatten();
    let duration_minutes = session.duration_minutes.unwrap_or_else(|| {
        session
            .ended_at
            .map(|ended_at| ((ended_at - session.started_at).num_seconds() / 60) as i32)
            .unwrap_or(0)
            .max(0)
    });
    let cost_usd = authoritative_paid_total.or_else(|| {
        profile.as_ref().and_then(|profile| {
            compute_cost(
                profile,
                session.energy_added_wh.map(|wh| wh / 1000.0).or(session.kwh_added),
                session.energy_used_wh.map(|wh| wh / 1000.0),
                duration_minutes,
                session.started_at,
                session.ended_at,
            )
        })
    });
    let resolved_profile_id = profile.as_ref().map(|profile| profile.id);
    let cost_method = if authoritative_paid_total.is_some() {
        String::from("rivian_paid_total")
    } else if resolved_profile_id.is_some() && cost_usd.is_some() {
        String::from("profile")
    } else if resolved_profile_id.is_some() {
        String::from("profile_pending")
    } else {
        String::from("unknown")
    };

    sqlx::query(
        r#"UPDATE riviamigo.charge_sessions
           SET cost_profile_id = $2,
               cost_method = $3,
               cost_usd = $4
           WHERE id = $1"#,
    )
    .bind(session.id)
    .bind(resolved_profile_id)
    .bind(&cost_method)
    .bind(cost_usd)
    .execute(pool)
    .await?;

    Ok(Some(ChargeCostComputation {
        cost_profile_id: resolved_profile_id,
        cost_method,
        cost_usd,
    }))
}

async fn fetch_profile(pool: &PgPool, id: Uuid) -> Result<Option<CostProfile>> {
    let row = sqlx::query_as!(
        CostProfile,
        r#"SELECT id, user_id, name, billing_type, rate, session_fee, currency,
                  timezone, tou_periods,
                  effective_from, effective_to, created_at
           FROM riviamigo.cost_profiles WHERE id = $1"#,
        id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}
