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

export interface ConnectResult {
  status: 'connected' | 'otp_required';
  requires_otp: boolean;
  challenge_id: string | null;
  vehicle_id: string | null;
}

export interface AuthTokens {
  access_token: string;
  expires_in: number;
  default_vehicle_id: string | null;
}
