//! Detects charge session boundaries from charger_state transitions.

use crate::models::telemetry::{ChargerState, TelemetryEvent};
use chrono::{DateTime, Utc};
use uuid::Uuid;

const CHARGE_TIMEOUT_SECS: i64 = 1800; // 30 min

#[derive(Debug, Clone)]
pub struct CompletedChargeSession {
    pub vehicle_id:   Uuid,
    pub started_at:   DateTime<Utc>,
    pub ended_at:     DateTime<Utc>,
    pub location_lat: Option<f64>,
    pub location_lng: Option<f64>,
    pub soc_start:    Option<f64>,
    pub soc_end:      Option<f64>,
    pub charge_limit: Option<f64>,
}

#[derive(Debug, Default)]
pub struct ChargeDetectorState {
    vehicle_id:     Uuid,
    is_charging:    bool,
    started_at:     Option<DateTime<Utc>>,
    start_lat:      Option<f64>,
    start_lng:      Option<f64>,
    soc_start:      Option<f64>,
    last_soc:       Option<f64>,
    charge_limit:   Option<f64>,
    last_charge_ts: Option<DateTime<Utc>>,
}

#[derive(Debug)]
pub enum ChargeEvent {
    SessionStarted,
    SessionEnded(CompletedChargeSession),
    NoChange,
}

impl ChargeDetectorState {
    pub fn new(vehicle_id: Uuid) -> Self {
        Self { vehicle_id, ..Default::default() }
    }

    pub fn process(&mut self, event: &TelemetryEvent) -> ChargeEvent {
        let ts    = event.ts;
        let state = event.charger_state.as_ref();

        if let Some(soc)   = event.battery_level { self.last_soc    = Some(soc); }
        if let Some(limit) = event.battery_limit  { self.charge_limit = Some(limit); }

        let actively_charging = matches!(state, Some(ChargerState::Charging));
        let session_ended     = matches!(state, Some(ChargerState::Done | ChargerState::Disconnected));

        // Start
        if !self.is_charging && actively_charging {
            self.is_charging    = true;
            self.started_at     = Some(ts);
            self.start_lat      = event.latitude;
            self.start_lng      = event.longitude;
            self.soc_start      = event.battery_level;
            self.last_charge_ts = Some(ts);
            return ChargeEvent::SessionStarted;
        }

        if self.is_charging {
            if actively_charging { self.last_charge_ts = Some(ts); }

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
        let session = CompletedChargeSession {
            vehicle_id:   self.vehicle_id,
            started_at:   self.started_at.unwrap_or(ended_at),
            ended_at,
            location_lat: self.start_lat,
            location_lng: self.start_lng,
            soc_start:    self.soc_start,
            soc_end:      self.last_soc,
            charge_limit: self.charge_limit,
        };
        self.is_charging    = false;
        self.started_at     = None;
        self.start_lat      = None;
        self.start_lng      = None;
        self.soc_start      = None;
        self.last_charge_ts = None;
        ChargeEvent::SessionEnded(session)
    }
}
