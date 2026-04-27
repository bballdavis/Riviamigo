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
  power_state: PowerState | null;
  charger_state: ChargerState | null;
  speed_mph: number | null;
  latitude: number | null;
  longitude: number | null;
  is_online: boolean;
  last_updated: string;
}
