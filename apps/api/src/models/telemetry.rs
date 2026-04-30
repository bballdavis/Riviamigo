use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Raw telemetry event as received from the Rivian WebSocket.
/// All fields are Option because Rivian sends partial updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryEvent {
    pub vehicle_id: Uuid,
    pub ts: DateTime<Utc>,

    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub altitude_m: Option<f64>,
    pub speed_mph: Option<f64>,

    pub battery_level: Option<f64>,
    pub battery_capacity_wh: Option<f64>,
    pub distance_to_empty_mi: Option<f64>,
    pub battery_limit: Option<f64>,

    pub power_state: Option<PowerState>,
    pub charger_state: Option<ChargerState>,
    pub charger_status: Option<String>,
    pub time_to_end_of_charge_min: Option<i32>,
    pub drive_mode: Option<DriveMode>,
    pub gear_status: Option<String>,

    pub cabin_temp_c: Option<f64>,
    pub driver_temp_c: Option<f64>,
    pub outside_temp_c: Option<f64>,
    pub hvac_active: Option<bool>,

    pub power_kw: Option<f64>,
    pub regen_power_kw: Option<f64>,

    pub heading_deg: Option<f64>,
    pub odometer_miles: Option<f64>,

    pub tire_fl_psi: Option<f64>,
    pub tire_fr_psi: Option<f64>,
    pub tire_rl_psi: Option<f64>,
    pub tire_rr_psi: Option<f64>,
    pub tire_fl_status: Option<String>,
    pub tire_fr_status: Option<String>,
    pub tire_rl_status: Option<String>,
    pub tire_rr_status: Option<String>,

    pub door_front_left_locked: Option<bool>,
    pub door_front_right_locked: Option<bool>,
    pub door_rear_left_locked: Option<bool>,
    pub door_rear_right_locked: Option<bool>,
    pub door_front_left_closed: Option<bool>,
    pub door_front_right_closed: Option<bool>,
    pub door_rear_left_closed: Option<bool>,
    pub door_rear_right_closed: Option<bool>,
    pub closure_frunk_locked: Option<bool>,
    pub closure_frunk_closed: Option<bool>,
    pub closure_liftgate_locked: Option<bool>,
    pub closure_liftgate_closed: Option<bool>,
    pub closure_tailgate_locked: Option<bool>,
    pub closure_tailgate_closed: Option<bool>,

    pub ota_current_version: Option<String>,
    pub ota_available_version: Option<String>,
    pub ota_status: Option<String>,
    pub ota_current_status: Option<String>,

    pub hv_thermal_event: Option<String>,
    pub twelve_volt_health: Option<String>,
    pub is_online: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text")]
#[serde(rename_all = "lowercase")]
pub enum PowerState {
    Sleep,
    Ready,
    Go,
    Drive,
    Charging,
    Unknown,
}

impl std::str::FromStr for PowerState {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_lowercase().as_str() {
            "sleep" => PowerState::Sleep,
            "ready" => PowerState::Ready,
            "go" => PowerState::Go,
            "drive" => PowerState::Drive,
            "charging" => PowerState::Charging,
            _ => PowerState::Unknown,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text")]
#[serde(rename_all = "lowercase")]
pub enum ChargerState {
    Disconnected,
    Connected,
    Charging,
    Done,
    Unknown,
}

impl std::str::FromStr for ChargerState {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_lowercase().as_str() {
            "disconnected" => ChargerState::Disconnected,
            "connected" => ChargerState::Connected,
            "charging_active" | "charging" => ChargerState::Charging,
            "charging_done" | "done" => ChargerState::Done,
            _ => ChargerState::Unknown,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text")]
#[serde(rename_all = "snake_case")]
pub enum DriveMode {
    Sport,
    AllPurpose,
    Conserve,
    OffRoad,
    Unknown,
}

impl std::str::FromStr for DriveMode {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_lowercase().as_str() {
            "sport" => DriveMode::Sport,
            "all_purpose" | "normal" => DriveMode::AllPurpose,
            "conserve" => DriveMode::Conserve,
            "off_road" => DriveMode::OffRoad,
            _ => DriveMode::Unknown,
        })
    }
}
