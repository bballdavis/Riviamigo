//! Detects trip boundaries from a stream of TelemetryEvents.

use crate::models::telemetry::{PowerState, TelemetryEvent};
use chrono::{DateTime, Utc};
use uuid::Uuid;

const STOPPED_SPEED_MPH:     f64 = 2.0;
const STOPPED_DURATION_SECS: i64 = 300; // 5 min
const MIN_TRIP_DISTANCE_MI:  f64 = 0.1;

#[derive(Debug, Clone, PartialEq)]
pub enum TripEvent {
    TripStarted { trip_id: Uuid, started_at: DateTime<Utc> },
    TripEnded { trip: CompletedTripData },
    NoChange,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompletedTripData {
    pub vehicle_id:          Uuid,
    pub started_at:          DateTime<Utc>,
    pub ended_at:            DateTime<Utc>,
    pub points:              Vec<TrackPoint>,
    pub soc_start:           Option<f64>,
    pub soc_end:             Option<f64>,
    pub battery_capacity_wh: Option<f64>,
    pub dominant_drive_mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrackPoint {
    pub ts:         DateTime<Utc>,
    pub lat:        f64,
    pub lng:        f64,
    pub speed_mph:  f64,
    pub altitude_m: Option<f64>,
}

#[derive(Debug, Default)]
pub struct TripDetectorState {
    vehicle_id:       Uuid,
    active_trip_id:   Option<Uuid>,
    trip_started_at:  Option<DateTime<Utc>>,
    track_points:     Vec<TrackPoint>,
    soc_at_start:     Option<f64>,
    drive_modes:      Vec<String>,
    last_moving_at:   Option<DateTime<Utc>>,
    battery_capacity: Option<f64>,
    last_soc:         Option<f64>,
}

impl TripDetectorState {
    pub fn new(vehicle_id: Uuid) -> Self {
        Self { vehicle_id, ..Default::default() }
    }

    pub fn process(&mut self, event: &TelemetryEvent) -> TripEvent {
        let power   = event.power_state.as_ref();
        let speed   = event.speed_mph.unwrap_or(0.0);
        let ts      = event.ts;

        if let Some(soc) = event.battery_level { self.last_soc = Some(soc); }
        if let Some(cap) = event.battery_capacity_wh { self.battery_capacity = Some(cap); }

        let is_moving = speed > STOPPED_SPEED_MPH;
        let is_awake  = matches!(power, Some(PowerState::Drive | PowerState::Go | PowerState::Ready));
        let is_asleep = matches!(power, Some(PowerState::Sleep));

        if self.active_trip_id.is_some() {
            if let (Some(lat), Some(lng)) = (event.latitude, event.longitude) {
                self.track_points.push(TrackPoint {
                    ts, lat, lng, speed_mph: speed, altitude_m: event.altitude_m,
                });
            }
            if let Some(dm) = &event.drive_mode {
                self.drive_modes.push(format!("{dm:?}"));
            }
        }

        // Trip start
        if self.active_trip_id.is_none() && is_moving && is_awake {
            let trip_id = Uuid::new_v4();
            self.active_trip_id  = Some(trip_id);
            self.trip_started_at = Some(ts);
            self.soc_at_start    = event.battery_level;
            self.last_moving_at  = Some(ts);
            if let (Some(lat), Some(lng)) = (event.latitude, event.longitude) {
                self.track_points.push(TrackPoint {
                    ts, lat, lng, speed_mph: speed, altitude_m: event.altitude_m,
                });
            }
            return TripEvent::TripStarted { trip_id, started_at: ts };
        }

        // Trip end
        if self.active_trip_id.is_some() {
            if is_moving { self.last_moving_at = Some(ts); }

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
        let data = CompletedTripData {
            vehicle_id:          self.vehicle_id,
            started_at:          self.trip_started_at.unwrap_or(ended_at),
            ended_at,
            points:              std::mem::take(&mut self.track_points),
            soc_start:           self.soc_at_start,
            soc_end:             self.last_soc,
            battery_capacity_wh: self.battery_capacity,
            dominant_drive_mode: mode_of(&self.drive_modes),
        };
        self.active_trip_id  = None;
        self.trip_started_at = None;
        self.soc_at_start    = None;
        self.last_moving_at  = None;
        self.drive_modes.clear();
        TripEvent::TripEnded { trip: data }
    }
}

fn mode_of(v: &[String]) -> Option<String> {
    if v.is_empty() { return None; }
    let mut counts = std::collections::HashMap::<&str, usize>::new();
    for s in v { *counts.entry(s.as_str()).or_insert(0) += 1; }
    counts.into_iter().max_by_key(|&(_, c)| c).map(|(s, _)| s.to_string())
}

pub fn compute_distance_miles(points: &[TrackPoint]) -> f64 {
    points.windows(2)
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

    fn mk_event(power: PowerState, speed: f64, offset_secs: i64) -> TelemetryEvent {
        let base: DateTime<Utc> = "2024-01-15T08:00:00Z".parse().unwrap();
        let ts = base + chrono::Duration::seconds(offset_secs);
        TelemetryEvent {
            vehicle_id: Uuid::nil(), ts,
            latitude: Some(30.267), longitude: Some(-97.743),
            altitude_m: None, speed_mph: Some(speed),
            battery_level: Some(80.0), battery_capacity_wh: Some(135_000.0),
            distance_to_empty_mi: None, battery_limit: None,
            power_state: Some(power), charger_state: None, charger_status: None,
            time_to_end_of_charge_min: None, drive_mode: None, gear_status: None,
            cabin_temp_c: None, driver_temp_c: None, odometer_miles: None,
            hv_thermal_event: None, twelve_volt_health: None, is_online: None,
        }
    }

    #[test]
    fn trip_starts_moving_awake() {
        let mut d = TripDetectorState::new(Uuid::nil());
        assert!(matches!(d.process(&mk_event(PowerState::Drive, 35.0, 0)), TripEvent::TripStarted { .. }));
    }

    #[test]
    fn no_trip_when_stationary() {
        let mut d = TripDetectorState::new(Uuid::nil());
        assert_eq!(d.process(&mk_event(PowerState::Ready, 0.0, 0)), TripEvent::NoChange);
    }

    #[test]
    fn trip_ends_on_sleep() {
        let mut d = TripDetectorState::new(Uuid::nil());
        d.process(&mk_event(PowerState::Drive, 35.0, 0));
        assert!(matches!(d.process(&mk_event(PowerState::Sleep, 0.0, 10)), TripEvent::TripEnded { .. }));
    }

    #[test]
    fn trip_ends_after_5min_stopped() {
        let mut d = TripDetectorState::new(Uuid::nil());
        d.process(&mk_event(PowerState::Drive, 35.0, 0));
        d.process(&mk_event(PowerState::Ready, 1.5, 60));
        assert!(matches!(d.process(&mk_event(PowerState::Ready, 0.0, 400)), TripEvent::TripEnded { .. }));
    }

    #[test]
    fn haversine_austin_san_antonio() {
        let d = haversine_miles(30.267_153, -97.743_061, 29.424_122, -98.493_629);
        assert!((d - 79.0).abs() < 3.0, "Expected ~79 miles, got {d}");
    }
}
