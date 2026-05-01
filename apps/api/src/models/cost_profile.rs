use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TouPeriod {
    pub label: String,
    pub start_minute: u16,
    pub end_minute: u16,
    pub rate: f64,
}

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
    pub timezone: Option<String>,
    pub tou_periods: serde_json::Value,
    pub effective_from: Option<NaiveDate>,
    pub effective_to: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
}

impl CostProfile {
    pub fn tou_periods(&self) -> Vec<TouPeriod> {
        serde_json::from_value(self.tou_periods.clone()).unwrap_or_default()
    }
}

pub fn validate_tou_periods(periods: &[TouPeriod]) -> Result<(), String> {
    if periods.is_empty() {
        return Err("TOU schedules need at least one period.".into());
    }

    let mut expected_start = 0u16;
    for period in periods {
        if period.label.trim().is_empty() {
            return Err("Each TOU period needs a label.".into());
        }
        if !period.rate.is_finite() || period.rate < 0.0 {
            return Err("Each TOU period needs a non-negative rate.".into());
        }
        if period.start_minute != expected_start {
            return Err("TOU periods must be contiguous and start at 00:00.".into());
        }
        if period.end_minute <= period.start_minute {
            return Err("Each TOU period must end after it starts.".into());
        }
        expected_start = period.end_minute;
    }

    if expected_start != 24 * 60 {
        return Err("TOU periods must cover the full day through 24:00.".into());
    }

    Ok(())
}

/// Calculate the cost of a charging session against a given profile.
///
/// Returns `None` if the profile is missing or the inputs are insufficient.
pub fn compute_cost(
    profile: &CostProfile,
    energy_added_kwh: Option<f64>,
    energy_used_kwh: Option<f64>,
    duration_minutes: i32,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
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
        "tou" => compute_tou_cost(profile, energy_added_kwh, energy_used_kwh, duration_minutes, started_at, ended_at)? + session_fee,
        _ => return None,
    };

    Some(cost)
}

fn compute_tou_cost(
    profile: &CostProfile,
    energy_added_kwh: Option<f64>,
    energy_used_kwh: Option<f64>,
    duration_minutes: i32,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
) -> Option<f64> {
    let total_kwh = f64::max(energy_added_kwh.unwrap_or(0.0), energy_used_kwh.unwrap_or(0.0));
    if total_kwh <= 0.0 {
        return None;
    }

    let tz: Tz = profile.timezone.as_deref().unwrap_or("UTC").parse().ok()?;
    let end_utc = ended_at.unwrap_or_else(|| started_at + Duration::minutes(duration_minutes.max(0) as i64));
    if end_utc <= started_at {
        return None;
    }

    let local_start = started_at.with_timezone(&tz);
    let local_end = end_utc.with_timezone(&tz);
    let periods = profile.tou_periods();
    if periods.is_empty() {
        return None;
    }

    let mut overlap_minutes = 0.0;
    let mut weighted_rate = 0.0;
    let mut day = local_start.date_naive();
    let end_day = local_end.date_naive();

    while day <= end_day {
        for period in &periods {
            let Some(period_start_local) = resolve_local_datetime(tz, day, period.start_minute) else {
                continue;
            };
            let Some(period_end_local) = resolve_local_datetime(tz, day, period.end_minute) else {
                continue;
            };

            let overlap_start = std::cmp::max(period_start_local, local_start);
            let overlap_end = std::cmp::min(period_end_local, local_end);
            if overlap_end <= overlap_start {
                continue;
            }

            let minutes = (overlap_end - overlap_start).num_seconds() as f64 / 60.0;
            overlap_minutes += minutes;
            weighted_rate += minutes * period.rate;
        }

        let Some(next_day) = day.succ_opt() else {
            break;
        };
        day = next_day;
    }

    if overlap_minutes <= 0.0 {
        return None;
    }

    Some(total_kwh * (weighted_rate / overlap_minutes))
}

fn resolve_local_datetime(tz: Tz, day: NaiveDate, minute_of_day: u16) -> Option<chrono::DateTime<Tz>> {
    let minute_of_day = minute_of_day.min(24 * 60);
    let hour = (minute_of_day / 60) as u32;
    let minute = (minute_of_day % 60) as u32;

    let naive = if hour == 24 {
        day.succ_opt()?.and_hms_opt(0, 0, 0)?
    } else {
        day.and_hms_opt(hour, minute, 0)?
    };

    tz.from_local_datetime(&naive)
        .single()
        .or_else(|| tz.from_local_datetime(&naive).earliest())
        .or_else(|| tz.from_local_datetime(&naive).latest())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn profile(billing_type: &str, rate: f64, session_fee: f64) -> CostProfile {
        CostProfile {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: "Test".into(),
            billing_type: billing_type.into(),
            rate,
            session_fee,
            currency: "USD".into(),
            timezone: Some("UTC".into()),
            tou_periods: json!([]),
            effective_from: None,
            effective_to: None,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn test_per_kwh() {
        let p = profile("per_kwh", 0.13, 0.0);
        let cost = compute_cost(&p, Some(50.0), None, 60, Utc::now(), None).unwrap();
        assert!((cost - 6.5).abs() < 0.001);
    }

    #[test]
    fn test_per_kwh_uses_greatest() {
        // energy_used_kwh > energy_added_kwh → use energy_used_kwh
        let p = profile("per_kwh", 0.13, 1.0);
        let cost = compute_cost(&p, Some(48.0), Some(52.0), 60, Utc::now(), None).unwrap();
        assert!((cost - (0.13 * 52.0 + 1.0)).abs() < 0.001);
    }

    #[test]
    fn test_per_minute() {
        let p = profile("per_minute", 0.05, 2.0);
        let cost = compute_cost(&p, None, None, 60, Utc::now(), None).unwrap();
        assert!((cost - 5.0).abs() < 0.001);
    }

    #[test]
    fn test_free() {
        let p = profile("free", 0.0, 0.0);
        let cost = compute_cost(&p, Some(30.0), None, 30, Utc::now(), None).unwrap();
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn test_flat() {
        let p = profile("flat", 5.0, 1.5);
        let cost = compute_cost(&p, None, None, 20, Utc::now(), None).unwrap();
        assert!((cost - 6.5).abs() < 0.001);
    }

    #[test]
    fn test_per_kwh_no_energy_returns_none() {
        let p = profile("per_kwh", 0.13, 0.0);
        assert!(compute_cost(&p, None, None, 30, Utc::now(), None).is_none());
    }

    #[test]
    fn test_tou_weighted_rate() {
        let mut p = profile("tou", 0.0, 1.0);
        p.timezone = Some("UTC".into());
        p.tou_periods = json!([
            { "label": "Off-peak", "start_minute": 0, "end_minute": 60, "rate": 0.10 },
            { "label": "Peak", "start_minute": 60, "end_minute": 120, "rate": 0.30 },
            { "label": "Overnight", "start_minute": 120, "end_minute": 1440, "rate": 0.10 }
        ]);

        let start = Utc.with_ymd_and_hms(2026, 1, 1, 0, 30, 0).single().unwrap();
        let end = Utc.with_ymd_and_hms(2026, 1, 1, 1, 30, 0).single().unwrap();
        let cost = compute_cost(&p, Some(10.0), None, 60, start, Some(end)).unwrap();

        assert!((cost - 3.0).abs() < 0.001);
    }
}
