//! Join timestamped partial readings for every vehicle without rewriting stored
//! telemetry. Direct speed wins; plausible GNSS/odometer motion fills gaps.
//! Power retention follows the source: Parallax reports changes, periodic legacy
//! samples expire. History replay infers the source policy from each row's shape.

use super::{location::valid_location_pair, trip_detector::haversine_miles};
use crate::models::telemetry::{PowerState, TelemetryEvent};
use chrono::{DateTime, Duration, Utc};

const POWER_MAX_AGE: Duration = Duration::minutes(2);
const FIX_MAX_AGE: Duration = Duration::minutes(2);
const MAX_FIX_INTERVAL: Duration = Duration::minutes(5);
const MAX_PLAUSIBLE_MPH: f64 = 130.0;
const MOVING_MPH: f64 = 2.0;

#[derive(Debug)]
pub struct FusionDiagnostics {
    pub power_origin: &'static str,
    pub power_policy: &'static str,
    pub power_outcome: &'static str,
    pub reported_power_outcome: &'static str,
    pub speed_origin: &'static str,
    pub reported_speed_outcome: &'static str,
    pub gnss_outcome: &'static str,
    pub odometer_outcome: &'static str,
    pub gnss_interval_seconds: Option<i64>,
    pub gnss_distance_miles: Option<f64>,
    pub odometer_interval_seconds: Option<i64>,
    pub odometer_delta_miles: Option<f64>,
    pub moving_segments: u8,
}

impl Default for FusionDiagnostics {
    fn default() -> Self {
        Self {
            power_origin: "absent",
            power_policy: "periodic",
            power_outcome: "missing",
            reported_power_outcome: "missing",
            speed_origin: "absent",
            reported_speed_outcome: "missing",
            gnss_outcome: "missing",
            odometer_outcome: "missing",
            gnss_interval_seconds: None,
            gnss_distance_miles: None,
            odometer_interval_seconds: None,
            odometer_delta_miles: None,
            moving_segments: 0,
        }
    }
}

#[derive(Default)]
pub struct TripSignalFusion {
    power: Option<(PowerState, DateTime<Utc>, bool)>,
    last_fix: Option<(f64, f64, DateTime<Utc>)>,
    last_odometer: Option<(f64, DateTime<Utc>)>,
    moving_segments: u8,
    change_only_power: bool,
}

impl TripSignalFusion {
    /// Set a default source policy for callers with a known uniform source.
    pub fn new(change_only_power: bool) -> Self {
        Self {
            change_only_power,
            ..Self::default()
        }
    }

    pub fn fuse(&mut self, sample: &TelemetryEvent) -> TelemetryEvent {
        self.fuse_from(sample, self.change_only_power).0
    }

    /// `change_only_power` describes this source, not this vehicle. The cached
    /// power keeps the policy of the source that actually supplied it.
    pub fn fuse_from(
        &mut self,
        sample: &TelemetryEvent,
        change_only_power: bool,
    ) -> (TelemetryEvent, FusionDiagnostics) {
        let mut joined = sample.clone();
        let mut diag = FusionDiagnostics::default();
        if let Some(power) = sample.power_state.as_ref() {
            let observed_at = sample.power_state_ts.unwrap_or(sample.ts);
            if observed_at <= sample.ts + Duration::seconds(5)
                && (change_only_power || sample.ts - observed_at <= POWER_MAX_AGE)
                && self
                    .power
                    .as_ref()
                    .is_none_or(|(_, prior, _)| observed_at >= *prior)
            {
                self.power = Some((power.clone(), observed_at, change_only_power));
                diag.reported_power_outcome = "accepted";
                diag.power_origin = "reported";
                diag.power_outcome = "accepted";
            } else {
                joined.power_state = None;
                joined.power_state_ts = None;
                diag.reported_power_outcome = "stale_future_or_out_of_order";
                diag.power_outcome = "stale_future_or_out_of_order";
            }
        }
        if joined.power_state.is_none() {
            if let Some((power, observed_at, latched)) = self.power.as_ref() {
                if sample.ts >= *observed_at
                    && (*latched || sample.ts - *observed_at <= POWER_MAX_AGE)
                {
                    joined.power_state = Some(power.clone());
                    joined.power_state_ts = Some(*observed_at);
                    diag.power_origin = "carried_forward";
                    diag.power_outcome = "accepted";
                } else {
                    diag.power_outcome = "stale_or_future";
                }
            }
        }
        if self.power.as_ref().is_some_and(|(_, _, latched)| *latched) {
            diag.power_policy = "change_only";
        }
        if let Some(speed) = sample.speed_mph {
            let speed_at = sample.speed_mph_ts.unwrap_or(sample.ts);
            if sample.ts < speed_at || sample.ts - speed_at > FIX_MAX_AGE {
                joined.speed_mph = None;
                joined.speed_mph_ts = None;
                diag.reported_speed_outcome = "stale_or_future";
            } else if !speed.is_finite() || !(0.0..=MAX_PLAUSIBLE_MPH).contains(&speed) {
                joined.speed_mph = None;
                joined.speed_mph_ts = None;
                diag.reported_speed_outcome = "invalid";
            } else {
                diag.speed_origin = "reported";
                diag.reported_speed_outcome = "accepted";
                // A direct reading interrupts a fallback motion streak. A
                // later gap must establish GNSS motion again, even when this
                // direct-speed frame contains no location.
                self.moving_segments = 0;
            }
        }
        let mut gps_derived_zero = false;
        if let Some((lat, lon)) = valid_location_pair(sample.latitude, sample.longitude)
            .filter(|(lat, lon)| (-90.0..=90.0).contains(lat) && (-180.0..=180.0).contains(lon))
        {
            let fix_at = sample.location_ts.unwrap_or(sample.ts);
            if fix_at <= sample.ts + Duration::seconds(5)
                && sample.ts - fix_at <= FIX_MAX_AGE
                && self.last_fix.is_none_or(|(_, _, prior)| fix_at > prior)
            {
                diag.gnss_outcome = "baseline";
                if let Some((last_lat, last_lon, last_at)) = self.last_fix {
                    let seconds = (fix_at - last_at).num_seconds();
                    diag.gnss_interval_seconds = Some(seconds);
                    if (5..=MAX_FIX_INTERVAL.num_seconds()).contains(&seconds) {
                        let miles = haversine_miles(last_lat, last_lon, lat, lon);
                        diag.gnss_distance_miles = Some(miles);
                        let mph = miles * 3600.0 / seconds as f64;
                        if joined.speed_mph.is_some() {
                            diag.gnss_outcome = "reported_speed_precedence";
                        } else if mph.is_finite() && mph <= MAX_PLAUSIBLE_MPH {
                            self.moving_segments = if mph > MOVING_MPH {
                                self.moving_segments.saturating_add(1)
                            } else {
                                0
                            };
                            let derived = if self.moving_segments >= 2 { mph } else { 0.0 };
                            gps_derived_zero = derived == 0.0;
                            joined.speed_mph = Some(derived);
                            joined.speed_mph_ts = Some(fix_at);
                            diag.speed_origin = "gnss";
                            diag.gnss_outcome = if mph <= MOVING_MPH {
                                "stationary"
                            } else if self.moving_segments < 2 {
                                "provisional_zero"
                            } else {
                                "derived"
                            };
                        } else {
                            self.moving_segments = 0;
                            diag.gnss_outcome = "implausible";
                        }
                    } else {
                        self.moving_segments = 0;
                        diag.gnss_outcome = "interval_out_of_range";
                    }
                }
                self.last_fix = Some((lat, lon, fix_at));
            } else {
                joined.latitude = None;
                joined.longitude = None;
                joined.location_ts = None;
                diag.gnss_outcome = "stale_future_or_out_of_order";
            }
        } else if sample.latitude.is_some() || sample.longitude.is_some() {
            joined.latitude = None;
            joined.longitude = None;
            joined.location_ts = None;
            diag.gnss_outcome = "invalid_or_incomplete";
        }
        if let Some(odometer) = sample.odometer_miles.filter(|v| v.is_finite() && *v >= 0.0) {
            let odometer_at = sample.odometer_miles_ts.unwrap_or(sample.ts);
            if odometer_at <= sample.ts + Duration::seconds(5)
                && self
                    .last_odometer
                    .is_none_or(|(_, prior)| odometer_at > prior)
            {
                diag.odometer_outcome = "baseline";
                if let Some((last_odometer, last_at)) = self.last_odometer {
                    let seconds = (odometer_at - last_at).num_seconds();
                    let miles = odometer - last_odometer;
                    diag.odometer_interval_seconds = Some(seconds);
                    diag.odometer_delta_miles = Some(miles);
                    if joined.speed_mph.is_some() && !gps_derived_zero {
                        diag.odometer_outcome = "speed_precedence";
                    } else if sample.ts - odometer_at > FIX_MAX_AGE {
                        diag.odometer_outcome = "stale";
                    } else if !(5..=MAX_FIX_INTERVAL.num_seconds()).contains(&seconds) {
                        diag.odometer_outcome = "interval_out_of_range";
                    } else if miles <= 0.0 {
                        diag.odometer_outcome = "no_increase";
                    } else {
                        let mph = miles * 3600.0 / seconds as f64;
                        if mph.is_finite() && mph <= MAX_PLAUSIBLE_MPH {
                            joined.speed_mph = Some(mph);
                            joined.speed_mph_ts = Some(odometer_at);
                            diag.speed_origin = "odometer";
                            diag.odometer_outcome = "derived";
                        } else {
                            diag.odometer_outcome = "implausible";
                        }
                    }
                }
                self.last_odometer = Some((odometer, odometer_at));
            } else {
                diag.odometer_outcome = "future_or_out_of_order";
            }
        } else if sample.odometer_miles.is_some() {
            diag.odometer_outcome = "invalid";
        }
        diag.moving_segments = self.moving_segments;
        (joined, diag)
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};
    use uuid::Uuid;

    use crate::models::telemetry::{PowerState, TelemetryEvent};

    use super::TripSignalFusion;

    #[test]
    fn source_policy_follows_latest_accepted_power_not_vehicle_model() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::default();
        let mut power = TelemetryEvent::empty(Uuid::nil(), at);
        power.power_state = Some(PowerState::Go);
        fusion.fuse_from(&power, true);
        let later = TelemetryEvent::empty(Uuid::nil(), at + Duration::minutes(20));
        let (joined, diag) = fusion.fuse_from(&later, false);
        assert_eq!(joined.power_state, Some(PowerState::Go));
        assert_eq!(diag.power_policy, "change_only");
        assert_eq!(diag.power_origin, "carried_forward");
        power.ts = later.ts;
        power.power_state = Some(PowerState::Ready);
        fusion.fuse_from(&power, false);
        let after = TelemetryEvent::empty(Uuid::nil(), later.ts + Duration::minutes(3));
        let (joined, diag) = fusion.fuse_from(&after, true);
        assert_eq!(joined.power_state, None);
        assert_eq!(diag.power_policy, "periodic");
        assert_eq!(diag.power_outcome, "stale_or_future");
    }

    #[test]
    fn diagnostics_distinguish_provisional_zero_and_odometer_override() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::default();
        fusion.fuse(&fix_with_odometer(at, -97.0, 55.92));
        let sample = fix_with_odometer(at + Duration::seconds(60), -96.99, 56.54);
        let (joined, diag) = fusion.fuse_from(&sample, false);
        assert_eq!(diag.gnss_outcome, "provisional_zero");
        assert_eq!(diag.odometer_outcome, "derived");
        assert_eq!(diag.speed_origin, "odometer");
        assert_eq!(diag.odometer_interval_seconds, Some(60));
        assert!((diag.odometer_delta_miles.unwrap() - 0.62).abs() < 1e-9);
        assert!(joined.speed_mph.unwrap() > 2.0);
        assert_eq!(sample.speed_mph, None, "source reading stays unchanged");
        let repeated = fusion.fuse_from(&sample, false).1;
        assert_eq!(repeated.gnss_outcome, "stale_future_or_out_of_order");
        assert_eq!(repeated.odometer_outcome, "future_or_out_of_order");
    }

    #[test]
    fn invalid_or_old_power_cannot_replace_newer_cached_state() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::default();
        let mut sample = TelemetryEvent::empty(Uuid::nil(), at);
        sample.power_state = Some(PowerState::Sleep);
        fusion.fuse_from(&sample, true);
        sample.ts += Duration::seconds(60);
        sample.power_state = Some(PowerState::Go);
        sample.power_state_ts = Some(at - Duration::seconds(1));
        assert_eq!(
            fusion.fuse_from(&sample, false).0.power_state,
            Some(PowerState::Sleep)
        );
        sample.power_state_ts = Some(sample.ts + Duration::seconds(60));
        assert_eq!(
            fusion.fuse_from(&sample, false).0.power_state,
            Some(PowerState::Sleep)
        );
    }

    #[test]
    fn periodic_source_missing_speed_uses_same_drive_sequence() {
        use crate::ingestion::trip_detector::{TripDetectorState, TripEvent};
        let at = Utc::now();
        let mut fusion = TripSignalFusion::default();
        let mut detector = TripDetectorState::new(Uuid::nil());
        let mut first = odometer(at, 100.0);
        first.power_state = Some(PowerState::Drive);
        detector.process(&fusion.fuse_from(&first, false).0);
        let mut moved = odometer(at + Duration::seconds(60), 100.62);
        moved.power_state = Some(PowerState::Drive);
        assert!(matches!(
            detector.process(&fusion.fuse_from(&moved, false).0),
            TripEvent::TripStarted { .. }
        ));
        let mut sleep = odometer(at + Duration::seconds(120), 100.62);
        sleep.power_state = Some(PowerState::Sleep);
        let TripEvent::TripEnded { trip } = detector.process(&fusion.fuse_from(&sleep, false).0)
        else {
            panic!("expected completed trip");
        };
        assert_eq!(trip.start_odometer_mi, Some(100.0));
        assert_eq!(trip.end_odometer_mi, Some(100.62));
    }

    #[test]
    fn reported_speed_interrupts_gnss_confirmation() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::default();
        let mut fix = TelemetryEvent::empty(Uuid::nil(), at);
        fix.latitude = Some(30.0);
        fix.longitude = Some(-97.0);
        fusion.fuse(&fix);
        for offset in [30, 60] {
            fix.ts = at + Duration::seconds(offset);
            fix.longitude = Some(-97.0 + offset as f64 / 30.0 * 0.001);
            fusion.fuse(&fix);
        }
        let mut stopped = TelemetryEvent::empty(Uuid::nil(), at + Duration::seconds(70));
        stopped.speed_mph = Some(0.0);
        assert_eq!(fusion.fuse(&stopped).speed_mph, Some(0.0));
        fix.ts = at + Duration::seconds(90);
        fix.longitude = Some(-96.997);
        let (joined, diag) = fusion.fuse_from(&fix, false);
        assert_eq!(joined.speed_mph, Some(0.0));
        assert_eq!(diag.gnss_outcome, "provisional_zero");
    }

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

    fn fix_with_odometer(at: chrono::DateTime<Utc>, lon: f64, miles: f64) -> TelemetryEvent {
        let mut event = odometer(at, miles);
        event.latitude = Some(30.0);
        event.longitude = Some(lon);
        event.location_ts = Some(at);
        event
    }

    /// Repeated GNSS coordinates yield a derived zero, but the odometer on the
    /// same sample shows the vehicle moved; the odometer speed must win.
    #[test]
    fn odometer_increment_overrides_stationary_gps_zero_on_mixed_sample() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        fusion.fuse(&fix_with_odometer(at, -97.0, 55.92));
        let joined = fusion.fuse(&fix_with_odometer(at + Duration::seconds(60), -97.0, 56.54));
        let speed = joined.speed_mph.expect("odometer speed");
        assert!((speed - 37.2).abs() < 0.1, "{speed}");
        assert_eq!(joined.speed_mph_ts, Some(at + Duration::seconds(60)));
    }

    /// The first moving GNSS segment is held at a provisional zero; an odometer
    /// increment on the same sample still contributes.
    #[test]
    fn odometer_increment_overrides_provisional_gps_zero_on_mixed_sample() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        fusion.fuse(&fix_with_odometer(at, -97.0, 55.92));
        let joined = fusion.fuse(&fix_with_odometer(
            at + Duration::seconds(60),
            -96.99,
            56.54,
        ));
        assert!(joined.speed_mph.expect("odometer speed") > 2.0);
    }

    #[test]
    fn stationary_gps_zero_stands_without_odometer_increment() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        fusion.fuse(&fix_with_odometer(at, -97.0, 55.92));
        let joined = fusion.fuse(&fix_with_odometer(at + Duration::seconds(60), -97.0, 55.92));
        assert_eq!(joined.speed_mph, Some(0.0));
    }

    #[test]
    fn reported_zero_speed_is_not_replaced_by_odometer() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        fusion.fuse(&odometer(at, 55.92));
        let mut sample = odometer(at + Duration::seconds(60), 56.54);
        sample.speed_mph = Some(0.0);
        assert_eq!(fusion.fuse(&sample).speed_mph, Some(0.0));
    }

    #[test]
    fn stale_odometer_on_mixed_sample_keeps_gps_zero() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        fusion.fuse(&fix_with_odometer(at, -97.0, 55.92));
        let mut sample = fix_with_odometer(at + Duration::minutes(4), -97.0, 56.54);
        sample.odometer_miles_ts = Some(at + Duration::seconds(60));
        assert_eq!(fusion.fuse(&sample).speed_mph, Some(0.0));
    }

    #[test]
    fn implausible_odometer_jump_on_mixed_sample_keeps_gps_zero() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        fusion.fuse(&fix_with_odometer(at, -97.0, 55.92));
        let joined = fusion.fuse(&fix_with_odometer(at + Duration::seconds(60), -97.0, 60.0));
        assert_eq!(joined.speed_mph, Some(0.0));
    }

    /// Minute-spaced fixes that repeat the same coordinates while the odometer
    /// climbs must still produce a trip.
    #[test]
    fn r2_drive_with_repeated_gps_and_rising_odometer_produces_a_trip() {
        use crate::ingestion::trip_detector::{TripDetectorState, TripEvent};

        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(true);
        let mut detector = TripDetectorState::new(Uuid::nil());
        let mut go = fix_with_odometer(at, -97.0, 55.92);
        go.power_state = Some(PowerState::Go);
        detector.process(&fusion.fuse(&go));
        let mut started = false;
        for (i, secs) in [60, 120, 180, 240].into_iter().enumerate() {
            let sample = fix_with_odometer(
                at + Duration::seconds(secs),
                -97.0,
                55.92 + 0.62 * (i + 1) as f64,
            );
            if let TripEvent::TripStarted { .. } = detector.process(&fusion.fuse(&sample)) {
                started = true;
            }
        }
        assert!(started, "trip should start from odometer motion");
    }

    #[test]
    fn periodic_sources_also_derive_missing_speed() {
        let at = Utc::now();
        let mut fusion = TripSignalFusion::new(false);
        fusion.fuse(&odometer(at, 55.92));
        let next = fusion.fuse(&odometer(at + Duration::seconds(60), 56.54));
        assert!(next.speed_mph.unwrap() > 2.0);
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
