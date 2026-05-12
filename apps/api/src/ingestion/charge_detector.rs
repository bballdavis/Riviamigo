//! Detects charge session boundaries from charger_state transitions.
//! Extended with energy integration, charger-type classification, and max/avg
//! charge rate tracking.

use crate::models::telemetry::{ChargerState, TelemetryEvent};
use chrono::{DateTime, Utc};
use uuid::Uuid;

const CHARGE_TIMEOUT_SECS: i64 = 1800; // 30 min

/// Threshold for classifying charger type by peak power.
const AC_L1_MAX_KW: f64 = 12.0;
const AC_L2_MAX_KW: f64 = 50.0;

#[derive(Debug, Clone)]
pub struct CompletedChargeSession {
    pub session_id: Uuid,
    pub vehicle_id: Uuid,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub location_lat: Option<f64>,
    pub location_lng: Option<f64>,
    pub soc_start: Option<f64>,
    pub soc_end: Option<f64>,
    pub charge_limit: Option<f64>,
    pub battery_capacity_wh: Option<f64>,

    /// Energy drawn from the grid (integrated from |power_kw| × Δt).
    pub energy_used_wh: Option<f64>,
    /// Energy delivered to the pack: (soc_end - soc_start) × battery_capacity.
    pub energy_added_wh: Option<f64>,
    /// Peak AC/DC power recorded during the session.
    pub peak_charge_kw: Option<f64>,
    /// Average charge rate = energy_used_kwh / duration_hours.
    pub avg_charge_rate_kw: Option<f64>,
    /// Classified charger type: "ac", "ac_l2", or "dc".
    pub charger_type: Option<String>,
}

#[derive(Debug, Default)]
pub struct ChargeDetectorState {
    vehicle_id: Uuid,
    active_session_id: Option<Uuid>,
    is_charging: bool,
    started_at: Option<DateTime<Utc>>,
    start_lat: Option<f64>,
    start_lng: Option<f64>,
    soc_start: Option<f64>,
    last_soc: Option<f64>,
    charge_limit: Option<f64>,
    battery_capacity: Option<f64>,
    last_charge_ts: Option<DateTime<Utc>>,
    last_power_ts: Option<DateTime<Utc>>,

    // Energy / rate accumulators
    energy_used_wh_acc: f64,
    peak_charge_kw: f64,
}

#[derive(Debug)]
pub enum ChargeEvent {
    SessionStarted,
    SessionEnded(CompletedChargeSession),
    NoChange,
}

impl ChargeDetectorState {
    pub fn new(vehicle_id: Uuid) -> Self {
        Self {
            vehicle_id,
            ..Default::default()
        }
    }

    /// Returns the active session_id so the ingestion worker can stamp each
    /// telemetry row while charging is in progress.
    pub fn active_session_id(&self) -> Option<Uuid> {
        self.active_session_id
    }

    pub fn process(&mut self, event: &TelemetryEvent) -> ChargeEvent {
        let ts = event.ts;
        let state = event.charger_state.as_ref();

        if let Some(soc) = event.battery_level {
            self.last_soc = Some(soc);
            if self.is_charging && self.soc_start.is_none() {
                self.soc_start = Some(soc);
            }
        }
        if let Some(limit) = event.battery_limit {
            self.charge_limit = Some(limit);
        }
        if let Some(cap) = event.battery_capacity_wh {
            self.battery_capacity = Some(cap);
        }
        if self.is_charging && self.start_lat.is_none() && self.start_lng.is_none() {
            if let (Some(lat), Some(lng)) = (event.latitude, event.longitude) {
                self.start_lat = Some(lat);
                self.start_lng = Some(lng);
            }
        }

        // Power integration (|power_kw| for charging — power_kw may be negative
        // for grid intake depending on sign convention; take absolute value).
        if self.is_charging {
            if let Some(kw) = event.power_kw {
                let kw_abs = kw.abs();
                if kw_abs > 0.0 {
                    if let Some(last_t) = self.last_power_ts {
                        let dt_hours = (ts - last_t).num_milliseconds() as f64 / 3_600_000.0;
                        self.energy_used_wh_acc += kw_abs * 1_000.0 * dt_hours;
                    }
                    if kw_abs > self.peak_charge_kw {
                        self.peak_charge_kw = kw_abs;
                    }
                    self.last_power_ts = Some(ts);
                }
            }
        }

        let actively_charging = matches!(state, Some(ChargerState::Charging));
        let session_ended = matches!(state, Some(ChargerState::Done | ChargerState::Disconnected));

        // Start
        if !self.is_charging && actively_charging {
            let session_id = Uuid::new_v4();
            self.active_session_id = Some(session_id);
            self.is_charging = true;
            self.started_at = Some(ts);
            self.start_lat = event.latitude;
            self.start_lng = event.longitude;
            self.soc_start = event.battery_level;
            self.last_charge_ts = Some(ts);
            self.last_power_ts = Some(ts);
            self.energy_used_wh_acc = 0.0;
            self.peak_charge_kw = 0.0;
            return ChargeEvent::SessionStarted;
        }

        if self.is_charging {
            if actively_charging {
                self.last_charge_ts = Some(ts);
            }

            // Timeout: no charging event in 30 min
            let timed_out = self.last_charge_ts.map_or(false, |last| {
                (ts - last).num_seconds() > CHARGE_TIMEOUT_SECS
            });

            if session_ended || timed_out {
                return self.close_session(ts);
            }
        }

        ChargeEvent::NoChange
    }

    fn close_session(&mut self, ended_at: DateTime<Utc>) -> ChargeEvent {
        let started_at = self.started_at.unwrap_or(ended_at);
        let duration_hours = (ended_at - started_at).num_seconds() as f64 / 3_600.0;

        // energy_added_wh from SOC delta × pack capacity
        let energy_added_wh = match (self.soc_start, self.last_soc, self.battery_capacity) {
            (Some(s0), Some(s1), Some(cap)) => {
                let delta = s1 - s0;
                if delta > 0.0 { Some((delta / 100.0) * cap) } else { None }
            }
            _ => None,
        };

        let energy_used_wh = if self.energy_used_wh_acc > 0.0 {
            Some(self.energy_used_wh_acc)
        } else {
            None
        };

        // Prefer grid-side integrated energy, but fall back to pack-side SOC
        // delta when Rivian omits power telemetry for the session.
        let avg_charge_rate_kw = energy_used_wh.or(energy_added_wh).and_then(|wh| {
            if duration_hours > 0.0 { Some(wh / 1_000.0 / duration_hours) } else { None }
        });

        // charger_type classification by peak power
        let charger_type = if self.peak_charge_kw > 0.0 {
            Some(classify_charger(self.peak_charge_kw))
        } else {
            avg_charge_rate_kw.map(classify_charger)
        };
        let peak = if self.peak_charge_kw > 0.0 { Some(self.peak_charge_kw) } else { None };

        let session = CompletedChargeSession {
            session_id: self.active_session_id.unwrap_or_else(Uuid::new_v4),
            vehicle_id: self.vehicle_id,
            started_at,
            ended_at,
            location_lat: self.start_lat,
            location_lng: self.start_lng,
            soc_start: self.soc_start,
            soc_end: self.last_soc,
            charge_limit: self.charge_limit,
            battery_capacity_wh: self.battery_capacity,
            energy_used_wh,
            energy_added_wh,
            peak_charge_kw: peak,
            avg_charge_rate_kw,
            charger_type,
        };

        self.active_session_id = None;
        self.is_charging = false;
        self.started_at = None;
        self.start_lat = None;
        self.start_lng = None;
        self.soc_start = None;
        self.last_charge_ts = None;
        self.last_power_ts = None;
        self.energy_used_wh_acc = 0.0;
        self.peak_charge_kw = 0.0;

        ChargeEvent::SessionEnded(session)
    }
}

/// Classify charger type from peak observed power.
fn classify_charger(peak_kw: f64) -> String {
    if peak_kw < AC_L1_MAX_KW {
        "ac".to_string()
    } else if peak_kw < AC_L2_MAX_KW {
        "ac_l2".to_string()
    } else {
        "dc".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn event(
        vehicle_id: Uuid,
        ts: DateTime<Utc>,
        charger_state: Option<ChargerState>,
    ) -> TelemetryEvent {
        TelemetryEvent {
            vehicle_id,
            ts,
            latitude: None,
            longitude: None,
            altitude_m: None,
            speed_mph: None,
            battery_level: None,
            battery_capacity_wh: None,
            distance_to_empty_mi: None,
            battery_limit: None,
            power_state: None,
            charger_state,
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

    #[test]
    fn classify_ac_l1() {
        assert_eq!(classify_charger(7.2), "ac");
    }

    #[test]
    fn classify_ac_l2() {
        assert_eq!(classify_charger(19.2), "ac_l2");
    }

    #[test]
    fn classify_dc() {
        assert_eq!(classify_charger(150.0), "dc");
    }

    #[test]
    fn fills_start_soc_and_location_from_later_charge_samples() {
        let vehicle_id = Uuid::new_v4();
        let started_at = Utc::now();
        let mut detector = ChargeDetectorState::new(vehicle_id);

        assert!(matches!(
            detector.process(&event(vehicle_id, started_at, Some(ChargerState::Charging))),
            ChargeEvent::SessionStarted
        ));

        let mut follow_up = event(vehicle_id, started_at + Duration::minutes(2), None);
        follow_up.battery_level = Some(42.0);
        follow_up.battery_capacity_wh = Some(111_000.0);
        follow_up.latitude = Some(29.81);
        follow_up.longitude = Some(-95.38);
        assert!(matches!(detector.process(&follow_up), ChargeEvent::NoChange));

        let mut end = event(vehicle_id, started_at + Duration::minutes(62), Some(ChargerState::Done));
        end.battery_level = Some(52.0);
        let ChargeEvent::SessionEnded(session) = detector.process(&end) else {
            panic!("expected completed charge session");
        };

        assert_eq!(session.soc_start, Some(42.0));
        assert_eq!(session.location_lat, Some(29.81));
        assert_eq!(session.location_lng, Some(-95.38));
        assert!(session.energy_added_wh.is_some());
    }

    #[test]
    fn classifies_from_average_rate_when_peak_power_is_missing() {
        let vehicle_id = Uuid::new_v4();
        let started_at = Utc::now();
        let mut detector = ChargeDetectorState::new(vehicle_id);

        let mut start = event(vehicle_id, started_at, Some(ChargerState::Charging));
        start.battery_level = Some(40.0);
        start.battery_capacity_wh = Some(100_000.0);
        detector.process(&start);

        let mut end = event(vehicle_id, started_at + Duration::minutes(70), Some(ChargerState::Done));
        end.battery_level = Some(50.0);
        let ChargeEvent::SessionEnded(session) = detector.process(&end) else {
            panic!("expected completed charge session");
        };

        assert_eq!(session.charger_type.as_deref(), Some("ac"));
    }
}
