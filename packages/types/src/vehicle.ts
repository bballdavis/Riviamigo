export type PowerState = 'sleep' | 'ready' | 'go' | 'drive' | 'charging' | 'unknown';
export type ChargerState = 'Disconnected' | 'Connected' | 'Charging' | 'Done' | 'Unknown';
export type DriveMode =
  | 'sport'
  | 'all_purpose'
  | 'everyday'
  | 'conserve'
  | 'distance'
  | 'snow'
  | 'winter'
  | 'all_terrain'
  | 'off_road_auto'
  | 'soft_sand'
  | 'off_road_sand'
  | 'rock_crawl'
  | 'off_road_rocks'
  | 'rally'
  | 'off_road_sport_auto'
  | 'drift'
  | 'off_road_sport_drift'
  | 'towing'
  | 'unknown';
export type ChargerType = 'ac' | 'dc' | 'dcfc';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Vehicle {
  id: string;
  user_id: string;
  rivian_vehicle_id: string;
  is_demo?: boolean;
  vin: string | null;
  model: string;
  year: number | null;
  trim: string | null;
  color: string | null;
  battery_capacity_kwh: number | null;
  target_tire_pressure_psi?: number | null;
  battery_config?: string | null;
  display_name: string;
  created_at: string;
  history_backfill_status?: string | null;
  history_backfilled_at?: string | null;
  history_session_count?: number | null;
  worker_health?: string | null;
  worker_health_msg?: string | null;
  auth_state?: string | null;
  auth_reason_code?: string | null;
  images?: VehicleImages | null;
  membership_role?: 'owner' | 'manager' | 'viewer';
}

export interface VehicleMember {
  user_id: string;
  email: string;
  role: 'owner' | 'manager' | 'viewer';
  is_default: boolean;
  created_at: string;
}

export interface VehicleImages {
  all: VehicleImage[];
  cache?: VehicleArtworkCacheState;
  side?: VehicleImagePair | null;
  overhead?: VehicleImagePair | null;
  front?: VehicleImagePair | null;
  rear?: VehicleImagePair | null;
}

export interface VehicleArtworkCacheState {
  status: 'pending' | 'repairing' | 'ready' | 'failed';
  asset_count: number;
  ready_asset_count: number;
  attempts?: number;
  last_repair_attempt_at?: string | null;
  last_repair_success_at?: string | null;
  last_error?: string | null;
}

export interface VehicleImagePair {
  dark?: string | null;
  light?: string | null;
}

export interface VehicleImage {
  placement: string;
  design: string | null;
  size: string | null;
  resolution: string | null;
  url: string;
  overlays?: unknown;
  metadata?: unknown;
}

export type VehicleStatusAvailabilityState = 'current' | 'historical' | 'never_seen';

export type VehicleStatusAvailabilityReason =
  | 'missing_recent_payload'
  | 'never_seen'
  | 'invalid_sensor';

export interface VehicleStatusFieldAvailability {
  ever_seen: boolean;
  last_seen_at: string | null;
  latest_event_at: string | null;
  availability: VehicleStatusAvailabilityState;
  reason_code: VehicleStatusAvailabilityReason | null;
}

export type VehicleStatusFieldAvailabilityMap = Record<string, VehicleStatusFieldAvailability>;

export interface VehicleStatus {
  vehicle_id: string;
  battery_level: number | null;
  range_miles: number | null;
  battery_capacity_kwh?: number | null;
  battery_limit?: number | null;
  power_state: PowerState | null;
  charger_state: ChargerState | null;
  charger_state_ts?: string | null;
  charger_status?: string | null;
  time_to_end_of_charge_min?: number | null;
  speed_mph: number | null;
  altitude_m?: number | null;
  latitude: number | null;
  longitude: number | null;
  drive_mode?: string | null;
  gear_status?: string | null;
  cabin_temp_c?: number | null;
  driver_temp_c?: number | null;
  outside_temp_c?: number | null;
  heading_deg?: number | null;
  odometer_miles?: number | null;
  hv_thermal_event?: string | null;
  twelve_volt_health?: string | null;
  tire_fl_psi?: number | null;
  tire_fr_psi?: number | null;
  tire_rl_psi?: number | null;
  tire_rr_psi?: number | null;
  tire_min_psi?: number | null;
  tire_fl_status?: string | null;
  tire_fr_status?: string | null;
  tire_rl_status?: string | null;
  tire_rr_status?: string | null;
  tire_fl_valid?: boolean | null;
  tire_fr_valid?: boolean | null;
  tire_rl_valid?: boolean | null;
  tire_rr_valid?: boolean | null;
  door_front_left_locked?: boolean | null;
  door_front_right_locked?: boolean | null;
  door_rear_left_locked?: boolean | null;
  door_rear_right_locked?: boolean | null;
  door_front_left_closed?: boolean | null;
  door_front_right_closed?: boolean | null;
  door_rear_left_closed?: boolean | null;
  door_rear_right_closed?: boolean | null;
  closure_frunk_locked?: boolean | null;
  closure_frunk_closed?: boolean | null;
  closure_liftgate_locked?: boolean | null;
  closure_liftgate_closed?: boolean | null;
  closure_tailgate_locked?: boolean | null;
  closure_tailgate_closed?: boolean | null;
  tonneau_locked?: boolean | null;
  tonneau_closed?: boolean | null;
  side_bin_left_locked?: boolean | null;
  side_bin_right_locked?: boolean | null;
  side_bin_left_closed?: boolean | null;
  side_bin_right_closed?: boolean | null;
  window_fl_closed?: boolean | null;
  window_fr_closed?: boolean | null;
  window_rl_closed?: boolean | null;
  window_rr_closed?: boolean | null;
  ota_current_version?: string | null;
  ota_available_version?: string | null;
  ota_status?: string | null;
  ota_current_status?: string | null;
  wiper_fluid_low?: boolean | null;
  brake_fluid_low?: boolean | null;
  alarm_active?: boolean | null;
  service_mode?: boolean | null;
  gear_guard_locked?: boolean | null;
  gear_guard_video_status?: string | null;
  charger_derate_active?: boolean | string | null;
  charge_port_open?: boolean | string | null;
  cabin_precon_status?: string | null;
  cabin_precon_type?: string | null;
  defrost_active?: boolean | string | null;
  pet_mode_active?: boolean | string | null;
  pet_mode_temp_ok?: boolean | string | null;
  doors_locked?: boolean | null;
  open_closures?: string[] | null;
  tire_pressure_status?: string | null;
  software_update_status?: string | null;
  is_online: boolean;
  last_updated: string | null;
  last_event_at?: string | null;
  last_payload_at?: string | null;
  last_heartbeat_at?: string | null;
  last_ws_received_at?: string | null;
  last_ws_payload_received_at?: string | null;
  last_ws_heartbeat_received_at?: string | null;
  last_charge_history_sync_at?: string | null;
  last_charge_history_success_at?: string | null;
  worker_health?: string | null;
  auth_state?: string | null;
  auth_reason_code?: string | null;
  battery_level_ts?: string | null;
  range_miles_ts?: string | null;
  battery_limit_ts?: string | null;
  power_state_ts?: string | null;
  charger_status_ts?: string | null;
  time_to_end_of_charge_min_ts?: string | null;
  speed_mph_ts?: string | null;
  location_ts?: string | null;
  odometer_miles_ts?: string | null;
  telemetry_stale?: boolean;
  telemetry_stale_reason?: string | null;
  field_availability?: VehicleStatusFieldAvailabilityMap | null;
}
