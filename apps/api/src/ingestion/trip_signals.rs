//! Join sparse vehicle-state readings for trip detection without rewriting the
//! original telemetry sample or treating an old location as live motion.
//!
//! Sparse (R2) power arrives only when it changes, so the latest state stays
//! in effect until the vehicle reports another one. Speed is derived from
//! successive GNSS fixes or from odometer increments, because neither is
//! reported directly.

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
    last_odometer: Option<(f64, DateTime<Utc>)>,
    moving_segments: u8,
    sparse: bool,
}

/// Vehicles whose telemetry reports power on change and omits speed.
pub fn is_sparse_model(model: &str) -> bool {
    matches!(model.to_ascii_uppercase().as_str(), "R2" | "R2S" | "R2-S")
}

impl TripSignalFusion {
    pub fn new(sparse: bool) -> Self {
        Self {
            sparse,
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
            if sample.ts >= *observed_at
                && (self.sparse || sample.ts - *observed_at <= POWER_MAX_AGE)
            {
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
                if joined.speed_mph.is_none() && self.sparse {
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

        if let Some(odometer) = sample.odometer_miles.filter(|v| v.is_finite()) {
            let odometer_at = sample.odometer_miles_ts.unwrap_or(sample.ts);
            if odometer_at <= sample.ts + Duration::seconds(5)
                && self
                    .last_odometer
                    .is_none_or(|(_, prior)| odometer_at > prior)
            {
                if joined.speed_mph.is_none()
                    && self.sparse
                    && sample.ts - odometer_at <= FIX_MAX_AGE
                {
                    if let Some((last_odometer, last_at)) = self.last_odometer {
                        let seconds = (odometer_at - last_at).num_seconds();
                        let miles = odometer - last_odometer;
                        if (5..=MAX_FIX_INTERVAL.num_seconds()).contains(&seconds) && miles > 0.0 {
                            let mph = miles * 3600.0 / seconds as f64;
                            if mph <= MAX_PLAUSIBLE_MPH {
                                joined.speed_mph = Some(mph);
                                joined.speed_mph_ts = Some(odometer_at);
                            }
                        }
                    }
                }
                self.last_odometer = Some((odometer, odometer_at));
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
    fn stale_power_is_not_joined_for_dense_vehicles() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(false);
        let mut power = TelemetryEvent::empty(Uuid::nil(), at);
        power.power_state = Some(PowerState::Go);
        fusion.fuse(&power);
        let fix = TelemetryEvent::empty(Uuid::nil(), at + Duration::minutes(4));
        assert_eq!(fusion.fuse(&fix).power_state, None);
    }

    #[test]
    fn sparse_power_holds_until_the_vehicle_reports_another_state() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        let mut power = TelemetryEvent::empty(Uuid::nil(), at);
        power.power_state = Some(PowerState::Go);
        fusion.fuse(&power);
        let later = TelemetryEvent::empty(Uuid::nil(), at + Duration::minutes(20));
        assert_eq!(fusion.fuse(&later).power_state, Some(PowerState::Go));

        power.ts = at + Duration::minutes(21);
        power.power_state = Some(PowerState::Ready);
        fusion.fuse(&power);
        let after = TelemetryEvent::empty(Uuid::nil(), at + Duration::minutes(22));
        assert_eq!(fusion.fuse(&after).power_state, Some(PowerState::Ready));
    }

    #[test]
    fn location_jump_cannot_derive_speed() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        let mut fix = TelemetryEvent::empty(Uuid::nil(), at);
        fix.latitude = Some(30.0);
        fix.longitude = Some(-97.0);
        fix.location_ts = Some(fix.ts);
        fusion.fuse(&fix);
        fix.ts += Duration::seconds(30);
        fix.latitude = Some(35.0);
        fix.location_ts = Some(fix.ts);
        assert_eq!(fusion.fuse(&fix).speed_mph, None);
    }

    fn odometer(at: chrono::DateTime<Utc>, miles: f64) -> TelemetryEvent {
        let mut event = TelemetryEvent::empty(Uuid::nil(), at);
        event.odometer_miles = Some(miles);
        event
    }

    #[test]
    fn sparse_odometer_increment_derives_speed() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        assert_eq!(fusion.fuse(&odometer(at, 55.92)).speed_mph, None);
        let speed = fusion
            .fuse(&odometer(at + Duration::seconds(60), 56.54))
            .speed_mph
            .expect("odometer speed");
        assert!((speed - 37.2).abs() < 0.1, "{speed}");
        // A parked reading hours later is not motion.
        let parked = fusion.fuse(&odometer(at + Duration::hours(3), 56.54));
        assert_eq!(parked.speed_mph, None);
        let resumed = fusion.fuse(&odometer(at + Duration::hours(4), 57.16));
        assert_eq!(resumed.speed_mph, None);
    }

    #[test]
    fn dense_vehicles_do_not_derive_odometer_speed() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(false);
        fusion.fuse(&odometer(at, 55.92));
        let next = fusion.fuse(&odometer(at + Duration::seconds(60), 56.54));
        assert_eq!(next.speed_mph, None);
    }

    /// Timings from a real R2 drive that was missed: power reported Go once,
    /// then only minute-spaced GNSS fixes and 1 km odometer steps arrived.
    #[test]
    fn r2_drive_with_late_motion_produces_a_trip() {
        use crate::ingestion::trip_detector::{
            compute_distance_odometer_or_gps, TripDetectorState, TripEvent,
        };

        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        let mut detector = TripDetectorState::new(Uuid::nil());
        let mut events = vec![odometer(at - Duration::minutes(34), 55.92)];
        let mut go = TelemetryEvent::empty(Uuid::nil(), at);
        go.power_state = Some(PowerState::Go);
        events.push(go);
        for (secs, miles) in [
            (73, 56.54),
            (216, 57.17),
            (355, 57.79),
            (410, 58.41),
            (471, 59.03),
            (515, 59.65),
            (557, 60.27),
            (613, 60.89),
            (681, 61.52),
        ] {
            events.push(odometer(at + Duration::seconds(secs), miles));
        }
        for (i, secs) in [60, 120, 241, 360, 421, 482, 542, 601, 661, 722]
            .into_iter()
            .enumerate()
        {
            let mut fix = TelemetryEvent::empty(Uuid::nil(), at + Duration::seconds(secs));
            fix.latitude = Some(30.0 + i as f64 * 0.01);
            fix.longitude = Some(-97.0);
            fix.location_ts = Some(fix.ts);
            events.push(fix);
        }
        let mut ready = TelemetryEvent::empty(Uuid::nil(), at + Duration::seconds(772));
        ready.power_state = Some(PowerState::Ready);
        events.push(ready);
        let mut sleep = TelemetryEvent::empty(Uuid::nil(), at + Duration::seconds(1200));
        sleep.power_state = Some(PowerState::Sleep);
        events.push(sleep);
        events.sort_by_key(|event| event.ts);

        let mut started = None;
        let mut ended = None;
        for event in &events {
            match detector.process(&fusion.fuse(event)) {
                TripEvent::TripStarted { started_at, .. } => started = Some(started_at),
                TripEvent::TripEnded { trip } => ended = Some(trip),
                TripEvent::NoChange => {}
            }
        }

        assert!(started.expect("trip started") <= at + Duration::seconds(216));
        let trip = ended.expect("trip ended");
        assert_eq!(trip.start_odometer_mi, Some(55.92));
        assert_eq!(trip.end_odometer_mi, Some(61.52));
        let distance = compute_distance_odometer_or_gps(
            trip.start_odometer_mi,
            trip.end_odometer_mi,
            &trip.points,
        );
        assert!((distance - 5.6).abs() < 0.01, "{distance}");
    }
}
