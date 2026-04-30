export type PowerState = 'sleep' | 'ready' | 'go' | 'drive' | 'charging' | 'unknown';
export type ChargerState = 'Disconnected' | 'Connected' | 'Charging' | 'Done' | 'Unknown';
export type DriveMode = 'sport' | 'everyday' | 'conserve' | 'off_road_auto' | 'unknown';
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
  doors_locked?: boolean | null;
  open_closures?: string[] | null;
  tire_pressure_status?: string | null;
  software_update_status?: string | null;
  is_online: boolean;
  last_updated: string | null;
  last_event_at?: string | null;
  worker_health?: string | null;
}
