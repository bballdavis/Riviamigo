//! Detects trip boundaries from a stream of TelemetryEvents.
//! Extended with odometer, range, power envelope, elevation, inside temp,
//! regen energy tracking, and an energy-strategy ensemble.

use crate::models::telemetry::{PowerState, TelemetryEvent};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::location::valid_location_pair;

const STOPPED_SPEED_MPH: f64 = 2.0;
const STOPPED_DURATION_SECS: i64 = 300; // 5 min
#[allow(dead_code)]
const MIN_TRIP_DISTANCE_MI: f64 = 0.1;

#[derive(Debug, Clone, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub enum TripEvent {
    TripStarted {
        trip_id: Uuid,
        started_at: DateTime<Utc>,
    },
    TripEnded {
        trip: CompletedTripData,
    },
    NoChange,
}

impl TripEvent {
    /// Safe for diagnostic logs: completed trips contain coordinates and IDs.
    pub fn transition_name(&self) -> &'static str {
        match self {
            Self::TripStarted { .. } => "started",
            Self::TripEnded { .. } => "ended",
            Self::NoChange => "no_change",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompletedTripData {
    pub trip_id: Uuid,
    pub vehicle_id: Uuid,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub points: Vec<TrackPoint>,

    // SOC / energy
    pub soc_start: Option<f64>,
    pub soc_end: Option<f64>,
    pub battery_capacity_wh: Option<f64>,

    // Odometer at trip boundaries
    pub start_odometer_mi: Option<f64>,
    pub end_odometer_mi: Option<f64>,

    // Range (distance-to-empty) at trip boundaries
    pub range_start_mi: Option<f64>,
    pub range_end_mi: Option<f64>,

    // Power envelope (positive = traction, negative = regen)
    pub power_max_kw: Option<f64>,
    pub power_min_kw: Option<f64>,

    // Cumulative elevation change
    pub elevation_gain_m: Option<f64>,
    pub elevation_loss_m: Option<f64>,

    // Average cabin temperature
    pub inside_temp_avg_c: Option<f64>,

    // Average outside (ambient) temperature
    pub outside_temp_avg_c: Option<f64>,

    // Regenerative braking energy (Wh)
    pub regen_wh: Option<f64>,

    pub dominant_drive_mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrackPoint {
    pub ts: DateTime<Utc>,
    pub lat: f64,
    pub lng: f64,
    pub speed_mph: f64,
    pub altitude_m: Option<f64>,
}

#[derive(Debug, Default)]
pub struct TripDetectorState {
    vehicle_id: Uuid,
    active_trip_id: Option<Uuid>,
    trip_started_at: Option<DateTime<Utc>>,
    track_points: Vec<TrackPoint>,

    soc_at_start: Option<f64>,
    last_soc: Option<f64>,
    battery_capacity: Option<f64>,

    start_odometer: Option<f64>,
    last_odometer: Option<f64>,

    range_at_start: Option<f64>,
    last_range: Option<f64>,

    power_max: Option<f64>,
    power_min: Option<f64>,

    last_altitude: Option<f64>,
    elevation_gain_acc: f64,
    elevation_loss_acc: f64,

    inside_temp_sum: f64,
    inside_temp_count: u32,

    outside_temp_sum: f64,
    outside_temp_count: u32,

    regen_wh_acc: f64,
    last_regen_ts: Option<DateTime<Utc>>,

    drive_modes: Vec<String>,
    last_moving_at: Option<DateTime<Utc>>,

    // Odometer when the vehicle last shifted into gear (or ended a trip while
    // still in gear). Sparse vehicles report motion only after the first
    // odometer steps, so this marks where the upcoming trip really began.
    in_gear: bool,
    gear_odometer: Option<f64>,
    // When that shift happened, and the last location seen while parked, so
    // a backdated start also gets the matching start time and place.
    gear_at: Option<DateTime<Utc>>,
    last_parked_fix: Option<TrackPoint>,
}

/// A gear shift older than this no longer describes the trip that starts
/// now (a missed drive must not be attributed to a much later one).
const GEAR_ANCHOR_MAX_AGE_SECS: i64 = 15 * 60;

impl TripDetectorState {
    pub fn new(vehicle_id: Uuid) -> Self {
        Self {
            vehicle_id,
            ..Default::default()
        }
    }

    /// Returns the active trip_id so the ingestion worker can stamp each
    /// telemetry row with the in-progress trip while driving.
    pub fn active_trip_id(&self) -> Option<Uuid> {
        self.active_trip_id
    }

    /// The same start predicate used by process, exposed without trip contents.
    pub fn start_decision(&self, event: &TelemetryEvent) -> &'static str {
        if self.active_trip_id.is_some() {
            "already_active"
        } else if event.power_state.is_none() {
            "power_missing"
        } else if !matches!(
            event.power_state,
            Some(PowerState::Drive | PowerState::Go | PowerState::Ready)
        ) {
            "power_not_awake"
        } else if event.speed_mph.is_none() {
            "speed_missing"
        } else if !event
            .speed_mph
            .is_some_and(|speed| speed > STOPPED_SPEED_MPH)
        {
            "speed_below_threshold"
        } else {
            "eligible"
        }
    }

    pub fn process(&mut self, event: &TelemetryEvent) -> TripEvent {
        let start_decision = self.start_decision(event);
        let power = event.power_state.as_ref();
        let speed = event.speed_mph.unwrap_or(0.0);
        let ts = event.ts;

        if let Some(soc) = event.battery_level {
            self.last_soc = Some(soc);
        }
        if let Some(cap) = event.battery_capacity_wh {
            self.battery_capacity = Some(cap);
        }
        let prior_odometer = self.last_odometer;
        if let Some(odo) = event.odometer_miles {
            self.last_odometer = Some(odo);
        }
        if let Some(r) = event.distance_to_empty_mi {
            self.last_range = Some(r);
        }

        let is_moving = speed > STOPPED_SPEED_MPH;
        let is_asleep = matches!(power, Some(PowerState::Sleep));

        if let Some(power) = power {
            let in_gear = matches!(power, PowerState::Drive | PowerState::Go);
            if in_gear && !self.in_gear {
                self.gear_odometer = prior_odometer.or(event.odometer_miles);
                self.gear_at = Some(ts);
            } else if !in_gear {
                self.gear_odometer = None;
                self.gear_at = None;
            }
            self.in_gear = in_gear;
        }

        if self.active_trip_id.is_some() {
            if let Some((lat, lng)) = valid_location_pair(event.latitude, event.longitude) {
                self.track_points.push(TrackPoint {
                    ts,
                    lat,
                    lng,
                    speed_mph: speed,
                    altitude_m: event.altitude_m,
                });
            }

            if let Some(dm) = &event.drive_mode {
                self.drive_modes.push(dm.as_str().to_string());
            }

            // Power envelope
            if let Some(kw) = event.power_kw {
                self.power_max = Some(self.power_max.map_or(kw, |m: f64| m.max(kw)));
                self.power_min = Some(self.power_min.map_or(kw, |m: f64| m.min(kw)));
            }

            // Elevation gain/loss from consecutive altitude samples
            if let Some(alt) = event.altitude_m {
                if let Some(prev) = self.last_altitude {
                    let delta = alt - prev;
                    if delta > 0.0 {
                        self.elevation_gain_acc += delta;
                    } else {
                        self.elevation_loss_acc += -delta;
                    }
                }
                self.last_altitude = Some(alt);
            }

            // Inside (cabin) temperature running average
            if let Some(t) = event.cabin_temp_c {
                self.inside_temp_sum += t;
                self.inside_temp_count += 1;
            }

            // Outside (ambient) temperature running average
            if let Some(t) = event.outside_temp_c {
                self.outside_temp_sum += t;
                self.outside_temp_count += 1;
            }

            // Regen energy: negative regen_power_kw × Δt
            if let (Some(last_t), Some(kw)) = (self.last_regen_ts, event.regen_power_kw) {
                // Clamp dt to 0 so out-of-order events don't corrupt the accumulator.
                let dt_hours = ((ts - last_t).num_milliseconds() as f64 / 3_600_000.0).max(0.0);
                if kw.is_finite() && kw < 0.0 {
                    self.regen_wh_acc += kw.abs() * 1000.0 * dt_hours;
                }
            }
        }

        // Partial state frames must not shorten the energy sample interval.
        // Keep the boundary monotonic when a regen sample arrives late.
        if event.regen_power_kw.is_some_and(f64::is_finite)
            && self.last_regen_ts.is_none_or(|prior| ts >= prior)
        {
            self.last_regen_ts = Some(ts);
        }

        // Where the vehicle sat before shifting: the start of the next trip.
        // Fixes after the shift may already be on the road, unseen.
        if self.active_trip_id.is_none() && !self.in_gear && !is_moving {
            if let Some((lat, lng)) = valid_location_pair(event.latitude, event.longitude) {
                self.last_parked_fix = Some(TrackPoint {
                    ts,
                    lat,
                    lng,
                    speed_mph: 0.0,
                    altitude_m: event.altitude_m,
                });
            }
        }

        // ── Trip START ──────────────────────────────────────────────────────
        if start_decision == "eligible" {
            let trip_id = Uuid::new_v4();
            self.active_trip_id = Some(trip_id);
            self.soc_at_start = self.last_soc;
            let fresh =
                |at: DateTime<Utc>| at <= ts && (ts - at).num_seconds() <= GEAR_ANCHOR_MAX_AGE_SECS;
            let gear_at = self.gear_at.take().filter(|at| fresh(*at));
            let gear_odometer = self.gear_odometer.take().filter(|_| gear_at.is_some());
            // Motion may first be seen after the odometer has already
            // advanced, or on a sample carrying no odometer at all; the
            // reading before that motion is the trip's true starting point.
            let current_odometer = event.odometer_miles.or(prior_odometer);
            self.start_odometer = match (gear_odometer, prior_odometer) {
                (Some(gear), _) if current_odometer.is_none_or(|now| gear <= now) => Some(gear),
                (_, Some(prior)) if event.odometer_miles.is_some_and(|now| now > prior) => {
                    Some(prior)
                }
                _ => current_odometer,
            };
            // Sparse vehicles see motion only after the first odometer steps.
            // When the start odometer is backdated, backdate the start time to
            // the shift and the start place to where the vehicle was parked,
            // so duration, average speed, and start geofences agree with it.
            let backdated = matches!(
                (self.start_odometer, current_odometer),
                (Some(start), Some(now)) if start < now
            );
            let started_at = if backdated { gear_at.unwrap_or(ts) } else { ts };
            self.trip_started_at = Some(started_at);
            let parked_fix = self.last_parked_fix.take();
            if backdated {
                if let Some(fix) = parked_fix.filter(|fix| fresh(fix.ts)) {
                    self.track_points.push(fix);
                }
            }
            self.range_at_start = self.last_range;
            self.last_moving_at = Some(ts);
            self.last_altitude = event.altitude_m;
            self.elevation_gain_acc = 0.0;
            self.elevation_loss_acc = 0.0;
            self.inside_temp_sum = 0.0;
            self.inside_temp_count = 0;
            self.outside_temp_sum = 0.0;
            self.outside_temp_count = 0;
            self.regen_wh_acc = 0.0;
            self.last_regen_ts = Some(ts);
            self.power_max = event.power_kw;
            self.power_min = event.power_kw;

            if let Some((lat, lng)) = valid_location_pair(event.latitude, event.longitude) {
                self.track_points.push(TrackPoint {
                    ts,
                    lat,
                    lng,
                    speed_mph: speed,
                    altitude_m: event.altitude_m,
                });
            }
            return TripEvent::TripStarted {
                trip_id,
                started_at,
            };
        }

        // ── Trip END ────────────────────────────────────────────────────────
        if self.active_trip_id.is_some() {
            if is_moving {
                self.last_moving_at = Some(ts);
            }

            let stopped_long_enough = self
                .last_moving_at
                .is_some_and(|last| (ts - last).num_seconds() > STOPPED_DURATION_SECS);

            if is_asleep || stopped_long_enough {
                return self.close_trip(ts);
            }
        }

        TripEvent::NoChange
    }

    fn close_trip(&mut self, ended_at: DateTime<Utc>) -> TripEvent {
        let trip_id = self.active_trip_id.unwrap_or_else(Uuid::new_v4);

        let inside_temp_avg = if self.inside_temp_count > 0 {
            Some(self.inside_temp_sum / self.inside_temp_count as f64)
        } else {
            None
        };
        let outside_temp_avg = if self.outside_temp_count > 0 {
            Some(self.outside_temp_sum / self.outside_temp_count as f64)
        } else {
            None
        };
        let elevation_gain = if self.elevation_gain_acc > 0.0 {
            Some(self.elevation_gain_acc)
        } else {
            None
        };
        let elevation_loss = if self.elevation_loss_acc > 0.0 {
            Some(self.elevation_loss_acc)
        } else {
            None
        };
        let regen_wh = if self.regen_wh_acc > 0.0 {
            Some(self.regen_wh_acc)
        } else {
            None
        };

        let data = CompletedTripData {
            trip_id,
            vehicle_id: self.vehicle_id,
            started_at: self.trip_started_at.unwrap_or(ended_at),
            ended_at,
            points: std::mem::take(&mut self.track_points),
            soc_start: self.soc_at_start,
            soc_end: self.last_soc,
            battery_capacity_wh: self.battery_capacity,
            start_odometer_mi: self.start_odometer,
            end_odometer_mi: self.last_odometer,
            range_start_mi: self.range_at_start,
            range_end_mi: self.last_range,
            power_max_kw: self.power_max,
            power_min_kw: self.power_min,
            elevation_gain_m: elevation_gain,
            elevation_loss_m: elevation_loss,
            inside_temp_avg_c: inside_temp_avg,
            outside_temp_avg_c: outside_temp_avg,
            regen_wh,
            dominant_drive_mode: mode_of(&self.drive_modes),
        };

        self.active_trip_id = None;
        self.trip_started_at = None;
        self.soc_at_start = None;
        self.last_moving_at = None;
        self.start_odometer = None;
        self.range_at_start = None;
        self.power_max = None;
        self.power_min = None;
        self.last_altitude = None;
        self.elevation_gain_acc = 0.0;
        self.elevation_loss_acc = 0.0;
        self.inside_temp_sum = 0.0;
        self.inside_temp_count = 0;
        self.outside_temp_sum = 0.0;
        self.outside_temp_count = 0;
        self.regen_wh_acc = 0.0;
        self.last_regen_ts = None;
        self.drive_modes.clear();
        if self.in_gear {
            self.gear_odometer = self.last_odometer;
            self.gear_at = Some(ended_at);
        }

        TripEvent::TripEnded { trip: data }
    }
}

fn mode_of(v: &[String]) -> Option<String> {
    if v.is_empty() {
        return None;
    }
    let mut counts = std::collections::HashMap::<&str, usize>::new();
    for s in v {
        *counts.entry(s.as_str()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .max_by_key(|&(_, c)| c)
        .map(|(s, _)| s.to_string())
}

/// Compute distance from odometer delta if both endpoints are available.
/// Falls back to GPS haversine if odometer is missing or the delta is zero.
pub fn compute_distance_odometer_or_gps(
    start_odo: Option<f64>,
    end_odo: Option<f64>,
    points: &[TrackPoint],
) -> f64 {
    if let (Some(s), Some(e)) = (start_odo, end_odo) {
        let delta = e - s;
        if delta > 0.0 {
            return delta;
        }
    }
    compute_distance_miles(points)
}

/// Estimate trip energy using a ranked ensemble strategy.
/// Returns `(energy_wh, strategy_name)` or `None` if no strategy applies.
pub fn compute_trip_energy(
    soc_start: Option<f64>,
    soc_end: Option<f64>,
    battery_capacity_wh: Option<f64>,
    range_start_mi: Option<f64>,
    range_end_mi: Option<f64>,
    distance_miles: f64,
    historical_wh_per_mi: Option<f64>,
) -> Option<(f64, &'static str)> {
    // Strategy 1: SOC delta × pack capacity (most accurate)
    if let (Some(s0), Some(s1), Some(cap)) = (soc_start, soc_end, battery_capacity_wh) {
        let delta_pct = s0 - s1;
        if delta_pct >= 1.0 {
            return Some(((delta_pct / 100.0) * cap, "soc_delta"));
        }
    }
    // Strategy 2: Range delta × historical efficiency coefficient
    if let (Some(r0), Some(r1)) = (range_start_mi, range_end_mi) {
        let range_delta = r0 - r1;
        if range_delta >= 1.0 {
            if let Some(eff) = historical_wh_per_mi {
                return Some((range_delta * eff, "range_delta"));
            }
        }
    }
    // Strategy 3: Distance × historical efficiency (final fallback)
    if let Some(eff) = historical_wh_per_mi {
        if distance_miles > 0.0 {
            return Some((distance_miles * eff, "historical"));
        }
    }
    None
}

pub fn compute_distance_miles(points: &[TrackPoint]) -> f64 {
    points
        .windows(2)
        .map(|w| haversine_miles(w[0].lat, w[0].lng, w[1].lat, w[1].lng))
        .sum()
}

pub fn haversine_miles(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 3_958.8;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().asin()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::telemetry::PowerState;
    use chrono::Duration;

    fn mk_event_base(power: PowerState, speed: f64, offset_secs: i64) -> TelemetryEvent {
        let base: DateTime<Utc> = "2024-01-15T08:00:00Z".parse().unwrap();
        let ts = base + chrono::Duration::seconds(offset_secs);
        TelemetryEvent {
            latitude: Some(30.267),
            longitude: Some(-97.743),
            speed_mph: Some(speed),
            battery_level: Some(80.0),
            battery_capacity_wh: Some(135_000.0),
            power_state: Some(power),
            ..TelemetryEvent::empty(Uuid::nil(), ts)
        }
    }

    fn mk_event(power: PowerState, speed: f64, offset_secs: i64) -> TelemetryEvent {
        mk_event_base(power, speed, offset_secs)
    }

    #[test]
    fn start_diagnostics_match_actual_detector_decisions() {
        let mut detector = TripDetectorState::new(Uuid::nil());
        let mut sample = TelemetryEvent::empty(Uuid::nil(), Utc::now());
        assert_eq!(detector.start_decision(&sample), "power_missing");
        sample.power_state = Some(PowerState::Sleep);
        assert_eq!(detector.start_decision(&sample), "power_not_awake");
        sample.power_state = Some(PowerState::Go);
        assert_eq!(detector.start_decision(&sample), "speed_missing");
        for speed in [0.0, 2.0, f64::NAN] {
            sample.speed_mph = Some(speed);
            assert_eq!(detector.start_decision(&sample), "speed_below_threshold");
            assert_eq!(detector.process(&sample).transition_name(), "no_change");
        }
        sample.speed_mph = Some(3.0);
        assert_eq!(detector.start_decision(&sample), "eligible");
        assert_eq!(detector.process(&sample).transition_name(), "started");
        assert_eq!(detector.start_decision(&sample), "already_active");
        sample.power_state = Some(PowerState::Sleep);
        assert_eq!(detector.process(&sample).transition_name(), "ended");
    }

    #[test]
    fn partial_state_frames_do_not_shorten_regen_intervals() {
        let at = Utc::now();
        let mut detector = TripDetectorState::new(Uuid::nil());
        let mut sample = TelemetryEvent::empty(Uuid::nil(), at);
        sample.power_state = Some(PowerState::Drive);
        sample.speed_mph = Some(30.0);
        sample.regen_power_kw = Some(0.0);
        assert_eq!(detector.process(&sample).transition_name(), "started");
        detector.process(&TelemetryEvent::empty(
            Uuid::nil(),
            at + Duration::seconds(4),
        ));
        sample.ts = at + Duration::seconds(5);
        sample.regen_power_kw = Some(-36.0);
        detector.process(&sample);
        sample.ts = at + Duration::seconds(3);
        detector.process(&sample); // Late sample cannot move the boundary back.
        sample.ts = at + Duration::seconds(10);
        sample.regen_power_kw = Some(-36.0);
        detector.process(&sample);
        sample.ts = at + Duration::seconds(11);
        sample.power_state = Some(PowerState::Sleep);
        sample.regen_power_kw = None;
        let TripEvent::TripEnded { trip } = detector.process(&sample) else {
            panic!("expected completed trip");
        };
        assert_eq!(trip.regen_wh, Some(100.0));
    }

    #[test]
    fn partial_trip_start_keeps_available_battery_and_range() {
        let at = Utc::now();
        let mut detector = TripDetectorState::new(Uuid::nil());
        let mut baseline = TelemetryEvent::empty(Uuid::nil(), at);
        baseline.battery_level = Some(80.0);
        baseline.distance_to_empty_mi = Some(240.0);
        detector.process(&baseline);
        let mut motion = TelemetryEvent::empty(Uuid::nil(), at + Duration::seconds(30));
        motion.power_state = Some(PowerState::Go);
        motion.speed_mph = Some(30.0);
        assert_eq!(detector.process(&motion).transition_name(), "started");
        motion.ts += Duration::seconds(30);
        motion.power_state = Some(PowerState::Sleep);
        motion.battery_level = Some(79.0);
        motion.distance_to_empty_mi = Some(237.0);
        let TripEvent::TripEnded { trip } = detector.process(&motion) else {
            panic!("expected completed trip");
        };
        assert_eq!(trip.soc_start, Some(80.0));
        assert_eq!(trip.soc_end, Some(79.0));
        assert_eq!(trip.range_start_mi, Some(240.0));
        assert_eq!(trip.range_end_mi, Some(237.0));
    }

    #[test]
    fn trip_starts_moving_awake() {
        let mut d = TripDetectorState::new(Uuid::nil());
        assert!(matches!(
            d.process(&mk_event(PowerState::Drive, 35.0, 0)),
            TripEvent::TripStarted { .. }
        ));
    }

    #[test]
    fn active_trip_id_exposed() {
        let mut d = TripDetectorState::new(Uuid::nil());
        assert!(d.active_trip_id().is_none());
        d.process(&mk_event(PowerState::Drive, 35.0, 0));
        assert!(d.active_trip_id().is_some());
    }

    #[test]
    fn no_trip_when_stationary() {
        let mut d = TripDetectorState::new(Uuid::nil());
        assert_eq!(
            d.process(&mk_event(PowerState::Ready, 0.0, 0)),
            TripEvent::NoChange
        );
    }

    #[test]
    fn trip_ends_on_sleep() {
        let mut d = TripDetectorState::new(Uuid::nil());
        d.process(&mk_event(PowerState::Drive, 35.0, 0));
        assert!(matches!(
            d.process(&mk_event(PowerState::Sleep, 0.0, 10)),
            TripEvent::TripEnded { .. }
        ));
    }

    #[test]
    fn trip_ends_after_5min_stopped() {
        let mut d = TripDetectorState::new(Uuid::nil());
        d.process(&mk_event(PowerState::Drive, 35.0, 0));
        d.process(&mk_event(PowerState::Ready, 1.5, 60));
        assert!(matches!(
            d.process(&mk_event(PowerState::Ready, 0.0, 400)),
            TripEvent::TripEnded { .. }
        ));
    }

    #[test]
    fn trip_start_odometer_is_the_reading_before_motion() {
        let mut d = TripDetectorState::new(Uuid::nil());
        let mut parked = mk_event(PowerState::Ready, 0.0, 0);
        parked.odometer_miles = Some(100.0);
        d.process(&parked);
        let mut moved = mk_event(PowerState::Go, 30.0, 60);
        moved.odometer_miles = Some(100.62);
        d.process(&moved);
        let TripEvent::TripEnded { trip } = d.process(&mk_event(PowerState::Sleep, 0.0, 120))
        else {
            panic!("expected TripEnded");
        };
        assert_eq!(trip.start_odometer_mi, Some(100.0));
    }

    #[test]
    fn trip_start_without_odometer_uses_last_known_reading() {
        let mut d = TripDetectorState::new(Uuid::nil());
        let mut parked = mk_event(PowerState::Ready, 0.0, 0);
        parked.odometer_miles = Some(100.0);
        d.process(&parked);
        d.process(&mk_event(PowerState::Go, 30.0, 60));
        let TripEvent::TripEnded { trip } = d.process(&mk_event(PowerState::Sleep, 0.0, 120))
        else {
            panic!("expected TripEnded");
        };
        assert_eq!(trip.start_odometer_mi, Some(100.0));
    }

    #[test]
    fn trip_resumed_in_gear_starts_at_previous_trip_end() {
        let mut d = TripDetectorState::new(Uuid::nil());
        let mut parked = mk_event(PowerState::Ready, 0.0, 0);
        parked.odometer_miles = Some(100.0);
        d.process(&parked);
        let mut first = mk_event(PowerState::Drive, 30.0, 60);
        first.odometer_miles = Some(101.0);
        d.process(&first);
        let mut stopped = mk_event(PowerState::Drive, 0.0, 400);
        stopped.odometer_miles = Some(101.0);
        let TripEvent::TripEnded { trip } = d.process(&stopped) else {
            panic!("expected TripEnded");
        };
        assert_eq!(trip.start_odometer_mi, Some(100.0));

        let mut resumed = mk_event(PowerState::Drive, 30.0, 500);
        resumed.odometer_miles = Some(101.6);
        d.process(&resumed);
        let TripEvent::TripEnded { trip } = d.process(&mk_event(PowerState::Sleep, 0.0, 600))
        else {
            panic!("expected TripEnded");
        };
        assert_eq!(trip.start_odometer_mi, Some(101.0));
    }

    /// Dense (R1) telemetry reports speed and odometer on every sample, so the
    /// gear-shift start odometer must not change the measured distance.
    #[test]
    fn dense_r1_trip_distance_is_unchanged_by_gear_start_odometer() {
        use crate::ingestion::trip_signals::TripSignalFusion;

        let mut fusion = TripSignalFusion::new(false);
        let mut d = TripDetectorState::new(Uuid::nil());
        let mut samples = Vec::new();
        let mut parked = mk_event(PowerState::Ready, 0.0, 0);
        parked.odometer_miles = Some(200.0);
        samples.push(parked);
        let mut shifted = mk_event(PowerState::Drive, 0.0, 10);
        shifted.odometer_miles = Some(200.0);
        samples.push(shifted);
        for step in 1..=20 {
            let mut moving = mk_event(PowerState::Drive, 30.0, 10 + step * 30);
            moving.odometer_miles = Some(200.0 + 0.25 * step as f64);
            samples.push(moving);
        }
        let mut sleep = mk_event(PowerState::Sleep, 0.0, 700);
        sleep.odometer_miles = Some(205.0);
        samples.push(sleep);

        let mut ended = None;
        for sample in &samples {
            if let TripEvent::TripEnded { trip } = d.process(&fusion.fuse(sample)) {
                ended = Some(trip);
            }
        }
        let trip = ended.expect("trip ended");
        // The start odometer is the shift reading, so the start time is the
        // shift too, 30 seconds before the first moving sample.
        assert_eq!(trip.started_at, samples[1].ts);
        assert_eq!(trip.start_odometer_mi, Some(200.0));
        assert_eq!(trip.end_odometer_mi, Some(205.0));
        let distance = compute_distance_odometer_or_gps(
            trip.start_odometer_mi,
            trip.end_odometer_mi,
            &trip.points,
        );
        assert!((distance - 5.0).abs() < 1e-9, "{distance}");
    }

    #[test]
    fn trip_data_carries_trip_id() {
        let mut d = TripDetectorState::new(Uuid::nil());
        let ev = d.process(&mk_event(PowerState::Drive, 35.0, 0));
        let trip_id = match ev {
            TripEvent::TripStarted { trip_id, .. } => trip_id,
            _ => panic!("expected TripStarted"),
        };
        match d.process(&mk_event(PowerState::Sleep, 0.0, 10)) {
            TripEvent::TripEnded { trip } => assert_eq!(trip.trip_id, trip_id),
            _ => panic!("expected TripEnded"),
        }
    }

    #[test]
    fn ignores_zero_zero_location_samples_until_valid_coordinates_arrive() {
        let mut d = TripDetectorState::new(Uuid::nil());

        let mut start = mk_event(PowerState::Drive, 35.0, 0);
        start.latitude = Some(0.0);
        start.longitude = Some(0.0);
        assert!(matches!(d.process(&start), TripEvent::TripStarted { .. }));

        let mut mid = mk_event(PowerState::Drive, 36.0, 60);
        mid.latitude = Some(30.267);
        mid.longitude = Some(-97.743);
        assert!(matches!(d.process(&mid), TripEvent::NoChange));

        let mut end = mk_event(PowerState::Sleep, 0.0, 600);
        end.latitude = Some(30.268);
        end.longitude = Some(-97.742);
        let TripEvent::TripEnded { trip } = d.process(&end) else {
            panic!("expected TripEnded");
        };

        assert_eq!(
            trip.points.first().map(|p| (p.lat, p.lng)),
            Some((30.267, -97.743))
        );
        assert_eq!(
            trip.points.last().map(|p| (p.lat, p.lng)),
            Some((30.268, -97.742))
        );
    }

    #[test]
    fn energy_strategy_soc_delta() {
        let (wh, strategy) = compute_trip_energy(
            Some(90.0),
            Some(70.0),
            Some(135_000.0),
            None,
            None,
            50.0,
            None,
        )
        .unwrap();
        assert_eq!(strategy, "soc_delta");
        assert!((wh - 27_000.0).abs() < 1.0);
    }

    #[test]
    fn energy_strategy_range_delta_fallback() {
        let (wh, strategy) = compute_trip_energy(
            Some(80.0),
            Some(79.5),
            None, // SOC delta < 1 %
            Some(250.0),
            Some(230.0),
            20.0,
            Some(400.0),
        )
        .unwrap();
        assert_eq!(strategy, "range_delta");
        assert!((wh - 8_000.0).abs() < 10.0);
    }

    #[test]
    fn energy_strategy_historical_fallback() {
        let (wh, strategy) =
            compute_trip_energy(None, None, None, None, None, 10.0, Some(350.0)).unwrap();
        assert_eq!(strategy, "historical");
        assert!((wh - 3_500.0).abs() < 1.0);
    }

    #[test]
    fn haversine_austin_san_antonio() {
        let d = haversine_miles(30.267_153, -97.743_061, 29.424_122, -98.493_629);
        assert!(
            (d - 73.6).abs() < 1.0,
            "Expected ~73.6 straight-line miles, got {d}"
        );
    }
}
