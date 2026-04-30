use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A user-defined rate card for computing the cost of a charging session.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct CostProfile {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub billing_type: String,
    pub rate: f64,
    pub session_fee: f64,
    pub currency: String,
    pub effective_from: Option<NaiveDate>,
    pub effective_to: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
}

/// Calculate the cost of a charging session against a given profile.
///
/// Returns `None` if the profile is missing or the inputs are insufficient.
pub fn compute_cost(
    profile: &CostProfile,
    energy_added_kwh: Option<f64>,
    energy_used_kwh: Option<f64>,
    duration_minutes: i32,
) -> Option<f64> {
    let session_fee = profile.session_fee;
    let rate = profile.rate;

    let cost = match profile.billing_type.as_str() {
        "per_kwh" => {
            let added = energy_added_kwh.unwrap_or(0.0);
            let used = energy_used_kwh.unwrap_or(0.0);
            let kwh = f64::max(added, used);
            if kwh <= 0.0 {
                return None;
            }
            rate * kwh + session_fee
        }
        "per_minute" => rate * duration_minutes as f64 + session_fee,
        "free" => 0.0,
        "flat" => rate + session_fee,
        _ => return None,
    };

    Some(cost)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(billing_type: &str, rate: f64, session_fee: f64) -> CostProfile {
        CostProfile {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: "Test".into(),
            billing_type: billing_type.into(),
            rate,
            session_fee,
            currency: "USD".into(),
            effective_from: None,
            effective_to: None,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn test_per_kwh() {
        let p = profile("per_kwh", 0.13, 0.0);
        let cost = compute_cost(&p, Some(50.0), None, 60).unwrap();
        assert!((cost - 6.5).abs() < 0.001);
    }

    #[test]
    fn test_per_kwh_uses_greatest() {
        // energy_used_kwh > energy_added_kwh → use energy_used_kwh
        let p = profile("per_kwh", 0.13, 1.0);
        let cost = compute_cost(&p, Some(48.0), Some(52.0), 60).unwrap();
        assert!((cost - (0.13 * 52.0 + 1.0)).abs() < 0.001);
    }

    #[test]
    fn test_per_minute() {
        let p = profile("per_minute", 0.05, 2.0);
        let cost = compute_cost(&p, None, None, 60).unwrap();
        assert!((cost - 5.0).abs() < 0.001);
    }

    #[test]
    fn test_free() {
        let p = profile("free", 0.0, 0.0);
        let cost = compute_cost(&p, Some(30.0), None, 30).unwrap();
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn test_flat() {
        let p = profile("flat", 5.0, 1.5);
        let cost = compute_cost(&p, None, None, 20).unwrap();
        assert!((cost - 6.5).abs() < 0.001);
    }

    #[test]
    fn test_per_kwh_no_energy_returns_none() {
        let p = profile("per_kwh", 0.13, 0.0);
        assert!(compute_cost(&p, None, None, 30).is_none());
    }
}
