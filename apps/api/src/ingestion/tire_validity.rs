//! Decides when a "not valid" tire reading means a failed sensor.
//!
//! Tire pressure sensors only report while the wheels turn. Once the vehicle
//! parks they go quiet and Rivian marks every tire reading "not valid" until
//! the next drive wakes them. That flag is normal for a parked vehicle, so
//! recording it would replace the last good reading with "Invalid Sensor" for
//! most of the day. It only points to a real fault when the sensor stays
//! silent after the vehicle has been driven long enough to wake it.

use chrono::{DateTime, Duration, Utc};

use crate::models::telemetry::{PowerState, TelemetryEvent};

/// How long the vehicle must have been in a driving gear before a silent
/// sensor counts as failed. Sensors start reporting within the first few
/// minutes of a drive; this leaves room for slow traffic.
const SENSOR_WAKE_ALLOWANCE: Duration = Duration::minutes(10);

#[derive(Debug, Default)]
pub struct TireValidityGate {
    /// When the vehicle entered the driving gear it is still in.
    driving_since: Option<DateTime<Utc>>,
}

impl TireValidityGate {
    /// Fold in one sample from any source and drop "not valid" tire flags the
    /// vehicle sent while its sensors were expected to be quiet. A dropped
    /// flag leaves the stored reading and its validity untouched.
    pub fn observe(&mut self, event: &mut TelemetryEvent) {
        self.track_driving(event);
        if self.sensors_should_report(event.ts) {
            return;
        }
        for valid in [
            &mut event.tire_fl_valid,
            &mut event.tire_fr_valid,
            &mut event.tire_rl_valid,
            &mut event.tire_rr_valid,
        ] {
            if *valid == Some(false) {
                *valid = None;
            }
        }
    }

    fn track_driving(&mut self, event: &TelemetryEvent) {
        if let Some(gear) = event.gear_status.as_deref() {
            let driving =
                gear.eq_ignore_ascii_case("drive") || gear.eq_ignore_ascii_case("reverse");
            if !driving {
                self.driving_since = None;
            } else if self.driving_since.is_none() {
                self.driving_since = Some(event.gear_status_ts.unwrap_or(event.ts));
            }
        }
        // A sleeping vehicle is parked even if the shift to park was missed.
        if event.power_state == Some(PowerState::Sleep) {
            self.driving_since = None;
        }
    }

    fn sensors_should_report(&self, now: DateTime<Utc>) -> bool {
        self.driving_since
            .is_some_and(|since| now - since >= SENSOR_WAKE_ALLOWANCE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn at(minutes: i64) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(1_800_000_000, 0).unwrap() + Duration::minutes(minutes)
    }

    fn event(minutes: i64) -> TelemetryEvent {
        TelemetryEvent::empty(Uuid::nil(), at(minutes))
    }

    fn gear(minutes: i64, gear: &str) -> TelemetryEvent {
        let mut event = event(minutes);
        event.gear_status = Some(gear.into());
        event
    }

    /// The frame a parked vehicle sends: every tire "not valid", no pressure.
    fn all_invalid(minutes: i64) -> TelemetryEvent {
        let mut event = event(minutes);
        event.tire_fl_valid = Some(false);
        event.tire_fr_valid = Some(false);
        event.tire_rl_valid = Some(false);
        event.tire_rr_valid = Some(false);
        event
    }

    fn validity(event: &TelemetryEvent) -> [Option<bool>; 4] {
        [
            event.tire_fl_valid,
            event.tire_fr_valid,
            event.tire_rl_valid,
            event.tire_rr_valid,
        ]
    }

    #[test]
    fn a_parked_vehicle_does_not_report_failed_sensors() {
        let mut gate = TireValidityGate::default();
        gate.observe(&mut gear(0, "park"));

        let mut parked = all_invalid(5);
        gate.observe(&mut parked);

        assert_eq!(validity(&parked), [None; 4]);
    }

    #[test]
    fn an_unknown_driving_state_does_not_report_failed_sensors() {
        // After a restart the first frame can be the tire frame itself.
        let mut gate = TireValidityGate::default();

        let mut first = all_invalid(0);
        gate.observe(&mut first);

        assert_eq!(validity(&first), [None; 4]);
    }

    #[test]
    fn the_start_of_a_drive_does_not_report_failed_sensors() {
        let mut gate = TireValidityGate::default();
        gate.observe(&mut gear(0, "drive"));

        let mut waking = all_invalid(9);
        gate.observe(&mut waking);

        assert_eq!(validity(&waking), [None; 4]);
    }

    #[test]
    fn a_sensor_silent_well_into_a_drive_is_reported_invalid() {
        let mut gate = TireValidityGate::default();
        gate.observe(&mut gear(0, "drive"));

        let mut one_dead = event(10);
        one_dead.tire_fl_valid = Some(true);
        one_dead.tire_rr_valid = Some(false);
        gate.observe(&mut one_dead);

        assert_eq!(validity(&one_dead), [Some(true), None, None, Some(false)]);
    }

    #[test]
    fn parking_stops_reporting_failed_sensors_again() {
        let mut gate = TireValidityGate::default();
        gate.observe(&mut gear(0, "drive"));
        gate.observe(&mut gear(30, "park"));

        let mut parked = all_invalid(31);
        gate.observe(&mut parked);

        assert_eq!(validity(&parked), [None; 4]);
    }

    #[test]
    fn a_new_drive_gets_a_fresh_wake_allowance() {
        let mut gate = TireValidityGate::default();
        gate.observe(&mut gear(0, "drive"));
        gate.observe(&mut gear(30, "park"));
        gate.observe(&mut gear(60, "reverse"));
        // Shifting between driving gears is still the same drive.
        gate.observe(&mut gear(61, "drive"));

        let mut waking = all_invalid(65);
        gate.observe(&mut waking);
        assert_eq!(validity(&waking), [None; 4]);

        let mut silent = all_invalid(70);
        gate.observe(&mut silent);
        assert_eq!(validity(&silent), [Some(false); 4]);
    }

    #[test]
    fn a_sleeping_vehicle_is_parked_even_without_a_park_shift() {
        let mut gate = TireValidityGate::default();
        gate.observe(&mut gear(0, "drive"));
        let mut asleep = event(30);
        asleep.power_state = Some(PowerState::Sleep);
        gate.observe(&mut asleep);

        let mut parked = all_invalid(31);
        gate.observe(&mut parked);

        assert_eq!(validity(&parked), [None; 4]);
    }

    #[test]
    fn valid_readings_always_pass_through() {
        let mut gate = TireValidityGate::default();
        gate.observe(&mut gear(0, "park"));

        let mut reading = event(1);
        reading.tire_fl_valid = Some(true);
        reading.tire_fl_psi = Some(48.0);
        gate.observe(&mut reading);

        assert_eq!(reading.tire_fl_valid, Some(true));
        assert_eq!(reading.tire_fl_psi, Some(48.0));
    }
}
