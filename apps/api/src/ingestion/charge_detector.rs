//! Detects charge session boundaries from charger_state transitions.
//! Extended with energy integration, charger-type classification, and max/avg
//! charge rate tracking.

use crate::models::telemetry::{ChargerState, TelemetryEvent};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::location::valid_location_pair;

const CHARGE_TIMEOUT_SECS: i64 = 1800; // 30 min

/// Threshold for classifying charger type by peak power.
const AC_L1_MAX_KW: f64 = 12.0;
const AC_L2_MAX_KW: f64 = 50.0;

/// Hard ceiling on any single power_kw telemetry reading during charging.
/// The Rivian R1T/R1S peaks at ~220 kW DC (large pack). Values above this
/// are sensor glitches and must not corrupt peak_charge_kw or the energy
/// accumulator.  300 kW gives comfortable headroom for future hardware
/// without letting runaway readings through.
const PLAUSIBLE_MAX_CHARGE_KW: f64 = 300.0;

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

#[derive(Debug, Clone)]
pub struct ActiveChargeSessionSnapshot {
    pub session_id: Uuid,
    pub started_at: DateTime<Utc>,
    pub location_lat: Option<f64>,
    pub location_lng: Option<f64>,
    pub soc_start: Option<f64>,
    pub last_soc: Option<f64>,
    pub charge_limit: Option<f64>,
    pub battery_capacity_wh: Option<f64>,
    pub last_charge_ts: DateTime<Utc>,
    pub last_power_ts: Option<DateTime<Utc>>,
    pub energy_used_wh: f64,
    pub peak_charge_kw: f64,
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
#[allow(clippy::large_enum_variant)]
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

    pub fn from_snapshot(vehicle_id: Uuid, snapshot: ActiveChargeSessionSnapshot) -> Self {
        Self {
            vehicle_id,
            active_session_id: Some(snapshot.session_id),
            is_charging: true,
            started_at: Some(snapshot.started_at),
            start_lat: snapshot.location_lat,
            start_lng: snapshot.location_lng,
            soc_start: snapshot.soc_start,
            last_soc: snapshot.last_soc,
            charge_limit: snapshot.charge_limit,
            battery_capacity: snapshot.battery_capacity_wh,
            last_charge_ts: Some(snapshot.last_charge_ts),
            last_power_ts: snapshot.last_power_ts,
            energy_used_wh_acc: snapshot.energy_used_wh.max(0.0),
            peak_charge_kw: snapshot.peak_charge_kw.max(0.0),
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
            if let Some((lat, lng)) = valid_location_pair(event.latitude, event.longitude) {
                self.start_lat = Some(lat);
                self.start_lng = Some(lng);
            }
        }

        // Power integration (|power_kw| for charging — power_kw may be negative
        // for grid intake depending on sign convention; take absolute value).
        //
        // Two-layer glitch rejection:
        //
        //  1. Hard ceiling (PLAUSIBLE_MAX_CHARGE_KW): no real charger delivers
        //     more than ~220 kW to a Rivian.  Anything above 300 kW is hardware
        //     noise and is discarded unconditionally.
        //
        //  2. AC-baseline spike filter: if every reading so far is below
        //     AC_L2_MAX_KW (i.e. the session is clearly on a home/L2 circuit)
        //     and this new sample is more than 5× the established peak, it is
        //     almost certainly a transient sensor glitch — a home charger cannot
        //     physically jump from 8 kW to 250 kW mid-session.  Discard it so a
        //     single bad sample cannot flip the charger-type classification from
        //     AC to DC or corrupt the energy accumulator.
        if self.is_charging {
            if let Some(kw) = event.power_kw {
                let kw_abs = kw.abs();
                let is_dc_spike_on_ac_session = self.peak_charge_kw > 0.0
                    && self.peak_charge_kw < AC_L2_MAX_KW
                    && kw_abs > self.peak_charge_kw * 5.0;

                if kw_abs > 0.0 && kw_abs <= PLAUSIBLE_MAX_CHARGE_KW && !is_dc_spike_on_ac_session {
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

        let status = event.charger_status.as_deref();
        let has_remaining_charge_time = event
            .time_to_end_of_charge_min
            .is_some_and(|minutes| minutes > 0);
        let actively_charging =
            event.is_actively_charging() || (self.is_charging && has_remaining_charge_time);
        let session_ended = matches!(state, Some(ChargerState::Done | ChargerState::Disconnected))
            || matches!(status, Some("chrgr_sts_not_connected"))
            || (self.is_charging
                && matches!(status, Some("chrgr_sts_connected_no_chrg"))
                && !has_remaining_charge_time);

        // Start
        if !self.is_charging && actively_charging {
            let session_id = Uuid::new_v4();
            self.active_session_id = Some(session_id);
            self.is_charging = true;
            self.started_at = Some(ts);
            if let Some((lat, lng)) = valid_location_pair(event.latitude, event.longitude) {
                self.start_lat = Some(lat);
                self.start_lng = Some(lng);
            }
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
            let timed_out = self
                .last_charge_ts
                .is_some_and(|last| (ts - last).num_seconds() > CHARGE_TIMEOUT_SECS);

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
                if delta > 0.0 {
                    Some((delta / 100.0) * cap)
                } else {
                    None
                }
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
            if duration_hours > 0.0 {
                Some(wh / 1_000.0 / duration_hours)
            } else {
                None
            }
        });

        // charger_type classification by peak power
        let charger_type = if self.peak_charge_kw > 0.0 {
            Some(classify_charger(self.peak_charge_kw))
        } else {
            avg_charge_rate_kw.map(classify_charger)
        };
        let peak = if self.peak_charge_kw > 0.0 {
            Some(self.peak_charge_kw)
        } else {
            None
        };

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
            charger_state,
            ..TelemetryEvent::empty(vehicle_id, ts)
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
        assert!(matches!(
            detector.process(&follow_up),
            ChargeEvent::NoChange
        ));

        let mut end = event(
            vehicle_id,
            started_at + Duration::minutes(62),
            Some(ChargerState::Done),
        );
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
    fn skips_zero_zero_location_until_a_real_sample_arrives() {
        let vehicle_id = Uuid::new_v4();
        let started_at = Utc::now();
        let mut detector = ChargeDetectorState::new(vehicle_id);

        let mut start = event(vehicle_id, started_at, Some(ChargerState::Charging));
        start.latitude = Some(0.0);
        start.longitude = Some(0.0);
        assert!(matches!(
            detector.process(&start),
            ChargeEvent::SessionStarted
        ));

        let mut follow_up = event(vehicle_id, started_at + Duration::minutes(3), None);
        follow_up.latitude = Some(29.81);
        follow_up.longitude = Some(-95.38);
        follow_up.battery_level = Some(43.0);
        assert!(matches!(
            detector.process(&follow_up),
            ChargeEvent::NoChange
        ));

        let mut end = event(
            vehicle_id,
            started_at + Duration::minutes(63),
            Some(ChargerState::Done),
        );
        end.battery_level = Some(55.0);
        let ChargeEvent::SessionEnded(session) = detector.process(&end) else {
            panic!("expected completed charge session");
        };

        assert_eq!(session.location_lat, Some(29.81));
        assert_eq!(session.location_lng, Some(-95.38));
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

        let mut end = event(
            vehicle_id,
            started_at + Duration::minutes(70),
            Some(ChargerState::Done),
        );
        end.battery_level = Some(50.0);
        let ChargeEvent::SessionEnded(session) = detector.process(&end) else {
            panic!("expected completed charge session");
        };

        assert_eq!(session.charger_type.as_deref(), Some("ac"));
    }

    #[test]
    fn keeps_partial_charging_patches_in_one_session() {
        let vehicle_id = Uuid::new_v4();
        let started_at = Utc::now();
        let mut detector = ChargeDetectorState::new(vehicle_id);

        let mut start = event(vehicle_id, started_at, Some(ChargerState::Charging));
        start.battery_level = Some(33.0);
        start.battery_capacity_wh = Some(111_000.0);
        assert!(matches!(
            detector.process(&start),
            ChargeEvent::SessionStarted
        ));
        let session_id = detector.active_session_id();

        let mut patch = event(vehicle_id, started_at + Duration::minutes(45), None);
        patch.battery_level = Some(38.0);
        patch.time_to_end_of_charge_min = Some(250);
        assert!(matches!(detector.process(&patch), ChargeEvent::NoChange));
        assert_eq!(detector.active_session_id(), session_id);

        let mut end = event(vehicle_id, started_at + Duration::minutes(120), None);
        end.battery_level = Some(75.0);
        end.charger_status = Some("chrgr_sts_connected_no_chrg".to_string());
        let ChargeEvent::SessionEnded(session) = detector.process(&end) else {
            panic!("expected completed charge session");
        };

        assert_eq!(session.session_id, session_id.unwrap());
        assert_eq!(session.soc_start, Some(33.0));
        assert_eq!(session.soc_end, Some(75.0));
    }

    #[test]
    fn rehydrated_session_keeps_existing_session_id_until_completion() {
        let vehicle_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let started_at = Utc::now() - Duration::minutes(45);
        let mut detector = ChargeDetectorState::from_snapshot(
            vehicle_id,
            ActiveChargeSessionSnapshot {
                session_id,
                started_at,
                location_lat: Some(29.81),
                location_lng: Some(-95.38),
                soc_start: Some(40.0),
                last_soc: Some(48.0),
                charge_limit: Some(80.0),
                battery_capacity_wh: Some(111_000.0),
                last_charge_ts: started_at + Duration::minutes(40),
                last_power_ts: Some(started_at + Duration::minutes(40)),
                energy_used_wh: 18_000.0,
                peak_charge_kw: 10.5,
            },
        );

        let mut patch = event(vehicle_id, started_at + Duration::minutes(50), None);
        patch.battery_level = Some(50.0);
        patch.time_to_end_of_charge_min = Some(25);
        assert!(matches!(detector.process(&patch), ChargeEvent::NoChange));
        assert_eq!(detector.active_session_id(), Some(session_id));

        let mut end = event(
            vehicle_id,
            started_at + Duration::minutes(70),
            Some(ChargerState::Done),
        );
        end.battery_level = Some(60.0);
        let ChargeEvent::SessionEnded(session) = detector.process(&end) else {
            panic!("expected completed charge session");
        };

        assert_eq!(session.session_id, session_id);
        assert_eq!(session.soc_start, Some(40.0));
        assert_eq!(session.soc_end, Some(60.0));
        assert!(session.energy_used_wh.unwrap_or_default() >= 18_000.0);
    }
}
