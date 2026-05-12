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
  vin: string | null;
  model: string;
  year: number | null;
  trim: string | null;
  color: string | null;
  battery_capacity_kwh: number | null;
  display_name: string;
  created_at: string;
  images?: VehicleImages | null;
}

export interface VehicleImages {
  all: VehicleImage[];
  side?: VehicleImagePair | null;
  overhead?: VehicleImagePair | null;
  front?: VehicleImagePair | null;
  rear?: VehicleImagePair | null;
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

export interface VehicleStatus {
  vehicle_id: string;
  battery_level: number | null;
  range_miles: number | null;
  battery_capacity_kwh?: number | null;
  battery_limit?: number | null;
  power_state: PowerState | null;
  charger_state: ChargerState | null;
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
  ota_current_version?: string | null;
  ota_available_version?: string | null;
  ota_status?: string | null;
  ota_current_status?: string | null;
  doors_locked?: boolean | null;
  open_closures?: string[] | null;
  tire_pressure_status?: string | null;
  software_update_status?: string | null;
  is_online: boolean;
  last_updated: string | null;
  last_event_at?: string | null;
  worker_health?: string | null;
}
