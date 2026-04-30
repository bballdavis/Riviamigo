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
        }
        if let Some(limit) = event.battery_limit {
            self.charge_limit = Some(limit);
        }
        if let Some(cap) = event.battery_capacity_wh {
            self.battery_capacity = Some(cap);
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

        // avg_charge_rate_kw from integrated energy / duration
        let avg_charge_rate_kw = energy_used_wh.and_then(|wh| {
            if duration_hours > 0.0 { Some(wh / 1_000.0 / duration_hours) } else { None }
        });

        // charger_type classification by peak power
        let charger_type = if self.peak_charge_kw > 0.0 {
            Some(classify_charger(self.peak_charge_kw))
        } else {
            None
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
}
