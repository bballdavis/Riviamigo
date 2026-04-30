import type { ChargerType, DriveMode } from './vehicle';

export interface DateRange {
  from: Date;
  to: Date;
}

export interface TimeSeriesPoint {
  ts: string;
  value: number;
}

export interface PhantomDrainPoint {
  date: string;
  drain_pct: number;
}

export interface Trip {
  id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  distance_mi: number;
  energy_used_kwh: number | null;
  efficiency_wh_mi: number | null;
  max_speed_mph: number | null;
  drive_mode: DriveMode | null;
  soc_start: number | null;
  soc_end: number | null;
}

export interface TrackPoint {
  ts: string;
  lat: number;
  lng: number;
  speed_mph: number | null;
  altitude_m: number | null;
}

export interface ChargeSession {
  id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  location_name: string | null;
  charger_type: ChargerType | null;
  energy_added_kwh: number | null;
  soc_start: number | null;
  soc_end: number | null;
  peak_power_kw: number | null;
  cost_usd: number | null;
}

export interface ChargeCurvePoint {
  soc_pct: number;
  power_kw: number;
}

export interface StatsSummary {
  total_miles: number;
  total_trips: number;
  total_energy_kwh: number;
  avg_efficiency_wh_mi: number | null;
  total_charge_sessions: number;
  total_cost_usd: number | null;
}

export interface EfficiencyByMode {
  drive_mode: string;
  avg_efficiency: number;
  p10_efficiency: number;
  p90_efficiency: number;
  trip_count: number;
}

export interface EfficiencySummary {
  avg: number;
  p10: number;
  p90: number;
  total_miles: number;
}

export interface ChargingSummary {
  total_energy_kwh: number;
  total_cost_usd: number;
  session_count: number;
  weekly: Array<{ week_start: string; energy_kwh: number; sessions: number }>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface ConnectedRivianVehicle {
  id: string;
  name: string | null;
  vin: string | null;
  model: string | null;
  model_year: number | null;
}

export interface ConnectResult {
  status: 'connected' | 'otp_required';
  requires_otp: boolean;
  challenge_id: string | null;
  vehicle_id: string | null;
  vehicles: ConnectedRivianVehicle[];
}

export interface AddVehicleBody {
  rivian_vehicle_id: string;
  name?: string | null;
  home_lat?: number | null;
  home_lng?: number | null;
  model?: string | null;
  trim?: string | null;
  vin?: string | null;
}

export interface AddVehicleResult {
  vehicle_id: string;
}

export interface AuthTokens {
  access_token: string;
  expires_in: number;
  default_vehicle_id: string | null;
}

export interface AuthMeResponse {
  user_id: string;
  email: string;
  role: string;
  default_vehicle_id: string | null;
}

export type ApiAccessLevel = 'view' | 'edit' | 'admin';

export interface ApiKeyRecord {
  id: string;
  vehicle_id: string;
  name: string;
  access_level: ApiAccessLevel;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface CreateApiKeyBody {
  vehicle_id: string;
  name: string;
  access_level: ApiAccessLevel;
}

export interface CreateApiKeyResult {
  key: string;
  record: ApiKeyRecord;
}

export interface ApiCatalog {
  access_levels: Array<{
    level: ApiAccessLevel;
    description: string;
    allows: string[];
    restricts: string[];
  }>;
  endpoints: Array<{
    method: string;
    path: string;
    minimum_access: ApiAccessLevel;
    purpose: string;
  }>;
}

export interface RawTelemetrySample {
  ts: string;
  latitude: number | null;
  longitude: number | null;
  altitude_m: number | null;
  speed_mph: number | null;
  battery_level: number | null;
  battery_capacity_wh: number | null;
  distance_to_empty_mi: number | null;
  battery_limit: number | null;
  power_state: string | null;
  charger_state: string | null;
  charger_status: string | null;
  time_to_end_of_charge_min: number | null;
  drive_mode: string | null;
  gear_status: string | null;
  cabin_temp_c: number | null;
  driver_temp_c: number | null;
  outside_temp_c: number | null;
  hvac_active: boolean | null;
  power_kw: number | null;
  regen_power_kw: number | null;
  heading_deg: number | null;
  odometer_miles: number | null;
  tire_fl_psi: number | null;
  tire_fr_psi: number | null;
  tire_rl_psi: number | null;
  tire_rr_psi: number | null;
  hv_thermal_event: string | null;
  twelve_volt_health: string | null;
  is_online: boolean | null;
}

export interface RawTelemetryResponse {
  vehicle_id: string;
  coverage: {
    first_event_at: string | null;
    last_event_at: string | null;
    sample_count: number;
    odometer_samples: number;
    battery_samples: number;
    range_samples: number;
    outside_temp_samples: number;
    power_samples: number;
    regen_samples: number;
    tire_pressure_samples: number;
  };
  samples: RawTelemetrySample[];
}
