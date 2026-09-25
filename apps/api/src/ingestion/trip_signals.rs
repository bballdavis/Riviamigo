//! Join sparse vehicle-state readings for trip detection without rewriting the
//! original telemetry sample or treating an old location as live motion.

use chrono::{DateTime, Duration, Utc};

use crate::models::telemetry::{PowerState, TelemetryEvent};

use super::{location::valid_location_pair, trip_detector::haversine_miles};

const POWER_MAX_AGE: Duration = Duration::minutes(2);
const FIX_MAX_AGE: Duration = Duration::minutes(2);
const MAX_FIX_INTERVAL: Duration = Duration::minutes(5);
const MAX_PLAUSIBLE_MPH: f64 = 130.0;
const MOVING_MPH: f64 = 2.0;

#[derive(Default)]
pub struct TripSignalFusion {
    power: Option<(PowerState, DateTime<Utc>)>,
    last_fix: Option<(f64, f64, DateTime<Utc>)>,
    moving_segments: u8,
    allow_gps_speed: bool,
}

impl TripSignalFusion {
    pub fn new(allow_gps_speed: bool) -> Self {
        Self {
            allow_gps_speed,
            ..Self::default()
        }
    }

    pub fn fuse(&mut self, sample: &TelemetryEvent) -> TelemetryEvent {
        let mut joined = sample.clone();
        if let Some(power) = sample.power_state.as_ref() {
            let observed_at = sample.power_state_ts.unwrap_or(sample.ts);
            if observed_at <= sample.ts + Duration::seconds(5)
                && self
                    .power
                    .as_ref()
                    .is_none_or(|(_, prior)| observed_at >= *prior)
            {
                self.power = Some((power.clone(), observed_at));
            }
        } else if let Some((power, observed_at)) = self.power.as_ref() {
            if sample.ts >= *observed_at && sample.ts - *observed_at <= POWER_MAX_AGE {
                joined.power_state = Some(power.clone());
                joined.power_state_ts = Some(*observed_at);
            }
        }

        if sample.speed_mph.is_some() {
            let speed_at = sample.speed_mph_ts.unwrap_or(sample.ts);
            if sample.ts < speed_at
                || sample.ts - speed_at > FIX_MAX_AGE
                || sample
                    .speed_mph
                    .is_some_and(|v| !v.is_finite() || !(0.0..=MAX_PLAUSIBLE_MPH).contains(&v))
            {
                joined.speed_mph = None;
            }
        }

        if let Some((lat, lon)) = valid_location_pair(sample.latitude, sample.longitude)
            .filter(|(lat, lon)| (-90.0..=90.0).contains(lat) && (-180.0..=180.0).contains(lon))
        {
            let fix_at = sample.location_ts.unwrap_or(sample.ts);
            if fix_at <= sample.ts + Duration::seconds(5)
                && sample.ts - fix_at <= FIX_MAX_AGE
                && self.last_fix.is_none_or(|(_, _, prior)| fix_at > prior)
            {
                if joined.speed_mph.is_none() && self.allow_gps_speed {
                    if let Some((last_lat, last_lon, last_at)) = self.last_fix {
                        let seconds = (fix_at - last_at).num_seconds();
                        if (5..=MAX_FIX_INTERVAL.num_seconds()).contains(&seconds) {
                            let miles = haversine_miles(last_lat, last_lon, lat, lon);
                            let mph = miles * 3600.0 / seconds as f64;
                            if mph.is_finite() && mph <= MAX_PLAUSIBLE_MPH {
                                self.moving_segments = if mph > MOVING_MPH {
                                    self.moving_segments.saturating_add(1)
                                } else {
                                    0
                                };
                                joined.speed_mph =
                                    Some(if self.moving_segments >= 2 { mph } else { 0.0 });
                                joined.speed_mph_ts = Some(fix_at);
                            } else {
                                self.moving_segments = 0;
                            }
                        } else {
                            self.moving_segments = 0;
                        }
                    }
                }
                self.last_fix = Some((lat, lon, fix_at));
            } else {
                joined.latitude = None;
                joined.longitude = None;
                joined.location_ts = None;
            }
        }
        joined
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};
    use uuid::Uuid;

    use crate::models::telemetry::{PowerState, TelemetryEvent};

    use super::TripSignalFusion;

    #[test]
    fn r2_sparse_power_and_three_fixes_produce_motion() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        let mut power = TelemetryEvent::empty(Uuid::nil(), at);
        power.power_state = Some(PowerState::Go);
        fusion.fuse(&power);
        for (offset, lon) in [(10, -97.0), (40, -96.999), (70, -96.998)] {
            let mut fix = TelemetryEvent::empty(Uuid::nil(), at + Duration::seconds(offset));
            fix.latitude = Some(30.0);
            fix.longitude = Some(lon);
            fix.location_ts = Some(fix.ts);
            let joined = fusion.fuse(&fix);
            assert_eq!(joined.power_state, Some(PowerState::Go));
            if offset == 70 {
                assert!(joined.speed_mph.unwrap_or(0.0) > 2.0);
            }
        }
    }

    #[test]
    fn stale_power_and_location_jump_cannot_start_a_trip() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        let mut power = TelemetryEvent::empty(Uuid::nil(), at);
        power.power_state = Some(PowerState::Go);
        fusion.fuse(&power);
        let mut fix = TelemetryEvent::empty(Uuid::nil(), at + Duration::minutes(4));
        fix.latitude = Some(30.0);
        fix.longitude = Some(-97.0);
        fix.location_ts = Some(fix.ts);
        assert_eq!(fusion.fuse(&fix).power_state, None);
        fix.ts += Duration::seconds(30);
        fix.latitude = Some(35.0);
        fix.location_ts = Some(fix.ts);
        assert_eq!(fusion.fuse(&fix).speed_mph, None);
    }
}
