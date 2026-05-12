//! Detects trip boundaries from a stream of TelemetryEvents.
//! Extended with odometer, range, power envelope, elevation, inside temp,
//! regen energy tracking, and an energy-strategy ensemble.

use crate::models::telemetry::{PowerState, TelemetryEvent};
use chrono::{DateTime, Utc};
use uuid::Uuid;

const STOPPED_SPEED_MPH: f64 = 2.0;
const STOPPED_DURATION_SECS: i64 = 300; // 5 min
#[allow(dead_code)]
const MIN_TRIP_DISTANCE_MI: f64 = 0.1;

#[derive(Debug, Clone, PartialEq)]
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
    last_ts: Option<DateTime<Utc>>,

    drive_modes: Vec<String>,
    last_moving_at: Option<DateTime<Utc>>,
}

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

    pub fn process(&mut self, event: &TelemetryEvent) -> TripEvent {
        let power = event.power_state.as_ref();
        let speed = event.speed_mph.unwrap_or(0.0);
        let ts = event.ts;

        if let Some(soc) = event.battery_level {
            self.last_soc = Some(soc);
        }
        if let Some(cap) = event.battery_capacity_wh {
            self.battery_capacity = Some(cap);
        }
        if let Some(odo) = event.odometer_miles {
            self.last_odometer = Some(odo);
        }
        if let Some(r) = event.distance_to_empty_mi {
            self.last_range = Some(r);
        }

        let is_moving = speed > STOPPED_SPEED_MPH;
        let is_awake = matches!(
            power,
            Some(PowerState::Drive | PowerState::Go | PowerState::Ready)
        );
        let is_asleep = matches!(power, Some(PowerState::Sleep));

        if self.active_trip_id.is_some() {
            if let (Some(lat), Some(lng)) = (event.latitude, event.longitude) {
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
            if let (Some(last_t), Some(kw)) = (self.last_ts, event.regen_power_kw) {
                let dt_hours = (ts - last_t).num_milliseconds() as f64 / 3_600_000.0;
                if kw < 0.0 {
                    self.regen_wh_acc += kw.abs() * 1000.0 * dt_hours;
                }
            }
        }

        self.last_ts = Some(ts);

        // ── Trip START ──────────────────────────────────────────────────────
        if self.active_trip_id.is_none() && is_moving && is_awake {
            let trip_id = Uuid::new_v4();
            self.active_trip_id = Some(trip_id);
            self.trip_started_at = Some(ts);
            self.soc_at_start = event.battery_level;
            self.start_odometer = event.odometer_miles;
            self.range_at_start = event.distance_to_empty_mi;
            self.last_moving_at = Some(ts);
            self.last_altitude = event.altitude_m;
            self.elevation_gain_acc = 0.0;
            self.elevation_loss_acc = 0.0;
            self.inside_temp_sum = 0.0;
            self.inside_temp_count = 0;
            self.outside_temp_sum = 0.0;
            self.outside_temp_count = 0;
            self.regen_wh_acc = 0.0;
            self.power_max = event.power_kw;
            self.power_min = event.power_kw;

            if let (Some(lat), Some(lng)) = (event.latitude, event.longitude) {
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
                started_at: ts,
            };
        }

        // ── Trip END ────────────────────────────────────────────────────────
        if self.active_trip_id.is_some() {
            if is_moving {
                self.last_moving_at = Some(ts);
            }

            let stopped_long_enough = self.last_moving_at.map_or(false, |last| {
                (ts - last).num_seconds() > STOPPED_DURATION_SECS
            });

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
        self.drive_modes.clear();

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

    fn mk_event_base(power: PowerState, speed: f64, offset_secs: i64) -> TelemetryEvent {
        let base: DateTime<Utc> = "2024-01-15T08:00:00Z".parse().unwrap();
        let ts = base + chrono::Duration::seconds(offset_secs);
        TelemetryEvent {
            vehicle_id: Uuid::nil(),
            ts,
            latitude: Some(30.267),
            longitude: Some(-97.743),
            altitude_m: None,
            speed_mph: Some(speed),
            battery_level: Some(80.0),
            battery_capacity_wh: Some(135_000.0),
            distance_to_empty_mi: None,
            battery_limit: None,
            power_state: Some(power),
            charger_state: None,
            charger_status: None,
            time_to_end_of_charge_min: None,
            drive_mode: None,
            gear_status: None,
            cabin_temp_c: None,
            driver_temp_c: None,
            outside_temp_c: None,
            hvac_active: None,
            power_kw: None,
            regen_power_kw: None,
            heading_deg: None,
            odometer_miles: None,
            tire_fl_psi: None,
            tire_fr_psi: None,
            tire_rl_psi: None,
            tire_rr_psi: None,
            tire_fl_status: None,
            tire_fr_status: None,
            tire_rl_status: None,
            tire_rr_status: None,
            door_front_left_locked: None,
            door_front_right_locked: None,
            door_rear_left_locked: None,
            door_rear_right_locked: None,
            door_front_left_closed: None,
            door_front_right_closed: None,
            door_rear_left_closed: None,
            door_rear_right_closed: None,
            closure_frunk_locked: None,
            closure_frunk_closed: None,
            closure_liftgate_locked: None,
            closure_liftgate_closed: None,
            closure_tailgate_locked: None,
            closure_tailgate_closed: None,
            ota_current_version: None,
            ota_available_version: None,
            ota_status: None,
            ota_current_status: None,
            hv_thermal_event: None,
            twelve_volt_health: None,
            is_online: None,
        }
    }

    fn mk_event(power: PowerState, speed: f64, offset_secs: i64) -> TelemetryEvent {
        mk_event_base(power, speed, offset_secs)
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
        assert!((d - 79.0).abs() < 3.0, "Expected ~79 miles, got {d}");
    }
}
