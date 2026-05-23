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

    // Extended vehicle state fields (added to WS subscription)
    pub charge_port_open: Option<bool>,
    pub charger_derate_active: Option<bool>,
    pub cabin_precon_status: Option<String>,
    pub cabin_precon_type: Option<String>,
    pub pet_mode_active: Option<bool>,
    pub pet_mode_temp_ok: Option<bool>,
    pub defrost_active: Option<bool>,
    pub steering_wheel_heat: Option<i32>,
    pub seat_fl_heat: Option<i32>,
    pub seat_fr_heat: Option<i32>,
    pub seat_rl_heat: Option<i32>,
    pub seat_rr_heat: Option<i32>,
    pub seat_fl_vent: Option<i32>,
    pub seat_fr_vent: Option<i32>,
    pub tonneau_locked: Option<bool>,
    pub tonneau_closed: Option<bool>,
    pub side_bin_left_locked: Option<bool>,
    pub side_bin_right_locked: Option<bool>,
    pub window_fl_closed: Option<bool>,
    pub window_fr_closed: Option<bool>,
    pub window_rl_closed: Option<bool>,
    pub window_rr_closed: Option<bool>,
    pub gear_guard_locked: Option<bool>,
    pub gear_guard_video_status: Option<String>,
    pub wiper_fluid_low: Option<bool>,
    pub brake_fluid_low: Option<bool>,
    pub alarm_active: Option<bool>,
    pub service_mode: Option<bool>,
}

impl TelemetryEvent {
    pub fn empty(vehicle_id: Uuid, ts: DateTime<Utc>) -> Self {
        Self {
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
            charge_port_open: None,
            charger_derate_active: None,
            cabin_precon_status: None,
            cabin_precon_type: None,
            pet_mode_active: None,
            pet_mode_temp_ok: None,
            defrost_active: None,
            steering_wheel_heat: None,
            seat_fl_heat: None,
            seat_fr_heat: None,
            seat_rl_heat: None,
            seat_rr_heat: None,
            seat_fl_vent: None,
            seat_fr_vent: None,
            tonneau_locked: None,
            tonneau_closed: None,
            side_bin_left_locked: None,
            side_bin_right_locked: None,
            window_fl_closed: None,
            window_fr_closed: None,
            window_rl_closed: None,
            window_rr_closed: None,
            gear_guard_locked: None,
            gear_guard_video_status: None,
            wiper_fluid_low: None,
            brake_fluid_low: None,
            alarm_active: None,
            service_mode: None,
        }
    }
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
    Snow,
    AllTerrain,
    SoftSand,
    RockCrawl,
    Rally,
    Drift,
    Towing,
    Unknown,
}

impl DriveMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            DriveMode::Sport => "sport",
            DriveMode::AllPurpose => "all_purpose",
            DriveMode::Conserve => "conserve",
            DriveMode::Snow => "snow",
            DriveMode::AllTerrain => "all_terrain",
            DriveMode::SoftSand => "soft_sand",
            DriveMode::RockCrawl => "rock_crawl",
            DriveMode::Rally => "rally",
            DriveMode::Drift => "drift",
            DriveMode::Towing => "towing",
            DriveMode::Unknown => "unknown",
        }
    }
}

impl std::str::FromStr for DriveMode {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(match s.to_lowercase().as_str() {
            "sport" => DriveMode::Sport,
            "all_purpose" | "everyday" | "normal" => DriveMode::AllPurpose,
            "conserve" | "distance" => DriveMode::Conserve,
            "snow" | "winter" => DriveMode::Snow,
            "all_terrain" | "off_road" | "off_road_auto" => DriveMode::AllTerrain,
            "soft_sand" | "off_road_sand" => DriveMode::SoftSand,
            "rock_crawl" | "off_road_rocks" => DriveMode::RockCrawl,
            "rally" | "off_road_sport_auto" => DriveMode::Rally,
            "drift" | "off_road_sport_drift" => DriveMode::Drift,
            "tow" | "towing" => DriveMode::Towing,
            _ => DriveMode::Unknown,
        })
    }
}
