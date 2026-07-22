import type { ChargerType, DriveMode, VehicleMember } from './vehicle';

export interface DateRange {
  from: Date;
  to: Date;
}

export interface TimeSeriesPoint {
  ts: string;
  value: number;
}

export type MetricValueKind =
  | 'number'
  | 'percent'
  | 'distance'
  | 'energy'
  | 'temperature'
  | 'pressure'
  | 'speed';

export interface MetricCatalogEntry {
  id: string;
  label: string;
  unit: string | null;
  kind: MetricValueKind;
  source: 'summary' | 'telemetry' | 'trips' | 'charging' | 'battery';
  supports_series: boolean;
  default_aggregation: 'latest' | 'sum' | 'avg' | 'max';
}

export interface MetricValueResponse {
  metric: string;
  value: number | null;
  unit: string | null;
  label: string;
  ts: string | null;
}

export interface MetricSeriesPoint {
  ts: string;
  value: number | null;
}

export interface MetricBatchMetricRequest {
  metric: string;
  include_latest?: boolean;
  include_series?: boolean;
}

export interface MetricBatchRequest {
  vehicle_id: string;
  metrics: MetricBatchMetricRequest[];
  from?: string | null;
  to?: string | null;
  lifetime?: boolean;
  bucket?: string;
  /** `full` returns every retained source point in the requested range. */
  density?: 'compact' | 'full';
  max_points?: number;
}

export interface MetricBatchSeriesResponse {
  metric: string;
  points: MetricSeriesPoint[];
}

export interface MetricBatchResponse {
  values: MetricValueResponse[];
  series: MetricBatchSeriesResponse[];
  bucket: string;
  density: 'compact' | 'full';
  /** Present only for compact responses; full responses are intentionally uncapped. */
  max_points?: number;
}

export interface DataQualityResponse {
  vehicle_id: string;
  window_from: string;
  window_to: string;
  total_samples: number;
  samples_with_location: number;
  samples_with_battery: number;
  samples_with_power_kw: number;
  samples_with_odometer: number;
  coverage_pct: number | null;
  gap_count: number;
}

export interface PhantomDrainPoint {
  date: string;
  drain_pct: number;
}

export interface PhantomDrainPeriod {
  period_start: string | null;
  period_end: string | null;
  duration_hours: number | null;
  sleep_share_pct: number | null;
  state_coverage_pct: number | null;
  soc_start: number | null;
  soc_end: number | null;
  soc_lost_pct: number | null;
  drain_pct_per_hour: number | null;
  range_start_mi: number | null;
  range_end_mi: number | null;
  range_lost_mi: number | null;
  range_lost_per_hour_mi: number | null;
  energy_drained_kwh: number | null;
  avg_power_w: number | null;
  has_reduced_range: boolean | null;
  validation_status: 'validated' | 'excluded';
  validation_reason: string | null;
  sample_count: number;
  start_sample_at: string | null;
  end_sample_at: string | null;
  movement_detected: boolean;
  overlaps_trip: boolean;
  overlaps_charge: boolean;
}

export interface IdleDrainResponse {
  vehicle_id: string;
  periods: PhantomDrainPeriod[];
}

export interface Trip {
  id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  distance_mi: number;
  duration_min: number;
  energy_used_kwh: number | null;
  efficiency_wh_mi: number | null;
  max_speed_mph: number | null;
  drive_mode: DriveMode | null;
  soc_start: number | null;
  soc_end: number | null;
  start_lat?: number | null;
  start_lng?: number | null;
  end_lat?: number | null;
  end_lng?: number | null;
  start_address?: string | null;
  end_address?: string | null;
  start_place?: string | null;
  end_place?: string | null;
  outside_temp_c?: number | null;
  outside_temp_source?: OutsideTemperatureSource | null;
}

export interface TrackPoint {
  ts: string;
  lat: number;
  lng: number;
  speed_mph: number | null;
  altitude_m: number | null;
}

export interface TripPowerPoint {
  ts: string;
  power_kw: number | null;
  regen_power_kw: number | null;
  speed_mph: number | null;
  battery_level: number | null;
  estimated_net_power_kw?: number | null;
  power_source?: TripPowerSource;
}

export type TripPowerSource = 'direct' | 'estimated_soc' | 'unavailable';

export interface TripPowerMetadata {
  source: TripPowerSource;
  sample_count: number;
  median_interval_seconds: number | null;
  p90_interval_seconds: number | null;
  coverage_percent: number | null;
}

export interface TripDetailSeriesPoint {
  ts: string;
  speed_mph: number | null;
  power_kw: number | null;
  regen_power_kw: number | null;
  battery_level: number | null;
  outside_temp_c: number | null;
  cabin_temp_c: number | null;
  driver_temp_c: number | null;
  hvac_active: boolean | null;
  tire_fl_psi: number | null;
  tire_fr_psi: number | null;
  tire_rl_psi: number | null;
  tire_rr_psi: number | null;
  estimated_net_power_kw?: number | null;
  power_source?: TripPowerSource;
}

export type TripRouteCoordinate = [lng: number, lat: number];

export interface TripMapRoute {
  trip_id: string;
  coordinates: TripRouteCoordinate[];
}

export interface TripMapResponse {
  vehicle_id: string;
  from: string;
  to: string;
  total_trips: number;
  missing_route_count: number;
  routes: TripMapRoute[];
}

export interface TripDetailSamples {
  elapsed_s: number[];
  lat: Array<number | null>;
  lng: Array<number | null>;
  altitude_m: Array<number | null>;
  speed_mph: Array<number | null>;
  power_kw: Array<number | null>;
  regen_power_kw: Array<number | null>;
  estimated_net_power_kw?: Array<number | null>;
  battery_level: Array<number | null>;
  outside_temp_c: Array<number | null>;
  cabin_temp_c: Array<number | null>;
  driver_temp_c: Array<number | null>;
  hvac_active: Array<boolean | null>;
  tire_fl_psi: Array<number | null>;
  tire_fr_psi: Array<number | null>;
  tire_rl_psi: Array<number | null>;
  tire_rr_psi: Array<number | null>;
}

export interface TripDetailResponse {
  trip: Trip;
  sample_interval_seconds: number;
  samples: TripDetailSamples;
  power?: TripPowerMetadata;
  outside_temperature: OutsideTemperatureSeries;
}

export type OutsideTemperatureSource = 'vehicle' | 'open_meteo' | 'mixed' | 'unavailable';

export interface OutsideTemperatureSample {
  elapsed_s: number;
  ts: string;
  temperature_c: number;
  source: 'vehicle' | 'open_meteo';
}

export interface OutsideTemperatureSeries {
  source: OutsideTemperatureSource;
  attribution: { name: string; url: string } | null;
  samples: OutsideTemperatureSample[];
}

export type ExternalConnectionMode = 'remote' | 'custom' | 'disabled';
export type WeatherLocationPrecision = 'approximate' | 'exact';

export interface ExternalConnectionCacheSummary {
  entries: number;
  bytes: number;
  persistent: boolean;
  purgeable: boolean;
  description: string;
}

export interface ExternalConnectionRecord {
  id: 'rivian_account' | 'open_meteo' | 'nominatim' | 'basemap' | 'iconify' | 's3_backup';
  name: string;
  purpose: string;
  data_shared: string[];
  disabled_effect: string;
  execution: string;
  privacy_url: string | null;
  terms_url: string | null;
  editable: boolean;
  enabled: boolean;
  mode: ExternalConnectionMode;
  endpoint: string | null;
  endpoint_is_private: boolean;
  weather_precision: WeatherLocationPrecision | null;
  forecast_url: string | null;
  archive_url: string | null;
  base_url: string | null;
  light_url_template: string | null;
  dark_url_template: string | null;
  attribution: string | null;
  attribution_url: string | null;
  request_identifier: string | null;
  custom_autocomplete: boolean;
  allow_private_network: boolean;
  has_api_key: boolean;
  has_bearer_token: boolean;
  updated_at: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  request_count_today: number;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  cache: ExternalConnectionCacheSummary | null;
}

export interface ExternalConnectionsResponse {
  can_manage: boolean;
  connections: ExternalConnectionRecord[];
}

export interface UpdateExternalConnectionBody {
  enabled: boolean;
  mode: ExternalConnectionMode;
  weather_precision?: WeatherLocationPrecision | null;
  forecast_url?: string | null;
  archive_url?: string | null;
  base_url?: string | null;
  light_url_template?: string | null;
  dark_url_template?: string | null;
  attribution?: string | null;
  attribution_url?: string | null;
  request_identifier?: string | null;
  custom_autocomplete?: boolean;
  allow_private_network?: boolean;
  api_key?: string | null;
  clear_api_key?: boolean;
  bearer_token?: string | null;
  clear_bearer_token?: boolean;
}

export interface TestExternalConnectionResponse {
  ok: boolean;
  tested_at: string;
  checks: Array<{ label: string; ok: boolean; message: string }>;
  preview_data_url: string | null;
}

export interface PurgeExternalConnectionCacheResponse {
  purged_entries: number;
  message: string;
}

export interface ChargeSession {
  id: string;
  vehicle_id: string;
  started_at: string;
  session_day_local?: string | null;
  ended_at: string | null;
  location_name: string | null;
  charger_type: ChargerType | null;
  energy_added_kwh: number | null;
  duration_min: number | null;
  soc_start: number | null;
  soc_end: number | null;
  peak_power_kw: number | null;
  cost_usd: number | null;
  cost_method?: string | null;
  source?: string | null;
  api_started_at?: string | null;
  api_ended_at?: string | null;
  data_confidence?: string | null;
  telemetry_sample_count?: number;
  network_vendor?: string | null;
  range_added_km?: number | null;
  is_free_session?: boolean | null;
  is_rivian_network?: boolean | null;
  rivian_paid_total?: number | null;
  rivian_charger_type?: string | null;
  currency_code?: string | null;
  rivian_city?: string | null;
  is_public?: boolean | null;
  charger_id?: string | null;
  live_current_price?: number | null;
  live_current_currency?: string | null;
  live_total_charged_kwh?: number | null;
  live_range_added_km?: number | null;
  live_power_kw?: number | null;
  live_charge_rate_kph?: number | null;
}

export interface ChargeCurvePoint {
  minutes_elapsed?: number | null;
  soc_pct: number;
  power_kw: number;
  sample_source?: 'telemetry' | 'telemetry_1min' | 'rivian_charge_curve_points' | string;
  power_method?: 'recorded' | 'soc_delta' | string;
}

export interface ChargeCurveAnalysisPoint {
  session_id: string;
  minutes_elapsed: number | null;
  soc_pct: number | null;
  charge_rate_kw: number;
  charger_type: ChargerType | null;
  sample_source?: 'telemetry' | 'telemetry_1min' | 'rivian_charge_curve_points' | string;
  power_method?: 'recorded' | 'soc_delta' | string;
}

export interface ChargingChartDailyPoint {
  day_local: string;
  day_start: string;
  total_energy_kwh: number;
  session_count: number;
}

export interface ChargingChartSessionPoint {
  session_id: string;
  day_local: string;
  day_start: string;
  started_at: string;
  energy_added_kwh: number | null;
  cost_usd: number | null;
  charger_type: ChargerType | null;
  location_name: string | null;
}

export interface ChargingChartSeries {
  daily: ChargingChartDailyPoint[];
  daily_sessions: ChargingChartSessionPoint[];
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
  efficiency_miles: number;
  coverage_percent: number;
}

export interface ChargingSummary {
  total_energy_kwh: number;
  total_cost_usd: number | null;
  session_count: number;
  home_kwh?: number;
  away_kwh?: number;
  unknown_location_kwh?: number;
  ac_kwh?: number;
  dc_kwh?: number;
  charging_cycles?: number | null;
  charging_efficiency_pct?: number | null;
  total_energy_used_kwh?: number | null;
  max_charge_limit_pct?: number | null;
  max_charge_rate_kw?: number | null;
  typed_session_count?: number;
  known_cost_session_count?: number;
  unknown_cost_session_count?: number;
  free_session_count?: number;
  total_range_added_km?: number | null;
  rivian_paid_total_usd?: number | null;
  network_breakdown?: Array<{
    network_vendor: string | null;
    session_count: number;
    energy_kwh: number | null;
    cost_usd: number | null;
    free_sessions: number;
  }>;
  weekly: Array<{ week_start: string; energy_kwh: number; sessions: number }>;
}

export interface BatteryHealthSummary {
  usable_now_kwh: number | null;
  usable_new_kwh: number | null;
  battery_health_pct: number | null;
  estimated_degradation_pct: number | null;
  charging_cycles: number | null;
  charge_count: number;
  total_energy_added_kwh: number | null;
  total_energy_used_kwh: number | null;
  charging_efficiency_pct: number | null;
}

export interface BatteryMileagePoint {
  ts: string;
  odometer_mi: number | null;
  usable_kwh: number | null;
  range_mi: number | null;
  projected_max_range_mi: number | null;
  degradation_pct: number | null;
}

export interface VehicleHealthTires {
  ts: string;
  tire_fl_psi: number | null;
  tire_fr_psi: number | null;
  tire_rl_psi: number | null;
  tire_rr_psi: number | null;
  tire_fl_status: string | null;
  tire_fr_status: string | null;
  tire_rl_status: string | null;
  tire_rr_status: string | null;
  tire_fl_valid: boolean | null;
  tire_fr_valid: boolean | null;
  tire_rl_valid: boolean | null;
  tire_rr_valid: boolean | null;
}

export interface VehicleHealthClosures {
  ts: string;
  closure_frunk_closed: boolean | null;
  closure_liftgate_closed: boolean | null;
  closure_tailgate_closed: boolean | null;
  door_front_left_closed: boolean | null;
  door_front_right_closed: boolean | null;
  door_rear_left_closed: boolean | null;
  door_rear_right_closed: boolean | null;
}

export interface VehicleHealthSoftwareEntry {
  version: string;
  installed_at: string;
  observed_until: string | null;
}

export interface VehicleHealthVehicle {
  name: string | null;
  model: string;
  trim: string | null;
  vin: string | null;
}

export interface VehicleHealthRuntime {
  is_online: boolean | null;
  last_event_at: string | null;
  worker_health: string | null;
  worker_health_msg: string | null;
  auth_state: string | null;
  auth_reason_code: string | null;
  updated_at: string;
}

export interface VehicleHealthLatest {
  ts: string;
  twelve_volt_health: string | null;
  hv_thermal_event: string | null;
  ota_current_version: string | null;
  ota_available_version: string | null;
  ota_status: string | null;
  ota_current_status: string | null;
  is_online: boolean | null;
}

export interface VehicleHealth {
  vehicle_id: string;
  vehicle: VehicleHealthVehicle;
  generated_at: string;
  runtime: VehicleHealthRuntime | null;
  latest: VehicleHealthLatest | null;
  tires: VehicleHealthTires | null;
  closures: VehicleHealthClosures | null;
  current_software_version: string | null;
  ota_release_notes_url: string | null;
  software_history: VehicleHealthSoftwareEntry[];
  thermal_events_30d: number;
}

export interface TouPeriod {
  label: string;
  start_minute: number;
  end_minute: number;
  rate: number;
}

export interface PlaceAddress {
  id?: string | null;
  display_name: string;
  osm_id: number | null;
  latitude: number;
  longitude: number;
  road: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  raw: Record<string, unknown> | null;
}

export interface PlaceChargingProfile {
  id: string;
  name: string;
  billing_type: 'flat' | 'tou' | 'per_kwh' | 'per_minute' | 'free';
  rate: number;
  session_fee: number;
  currency: string;
  timezone: string | null;
  tou_periods: TouPeriod[];
}

export interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  is_home: boolean;
  is_work: boolean;
  address: PlaceAddress | null;
  charging: PlaceChargingProfile | null;
}

export interface PlaceSearchSuggestion extends PlaceAddress {}

export interface PlaceChargingInput {
  name?: string | null;
  billing_type: 'per_kwh' | 'tou';
  rate: number;
  session_fee?: number | null;
  currency?: string | null;
  timezone?: string | null;
  tou_periods?: TouPeriod[] | null;
}

export interface UpsertPlaceBody {
  name: string;
  radius_m?: number | null;
  is_home?: boolean;
  is_work?: boolean;
  address: PlaceAddress;
  charging?: PlaceChargingInput | null;
}

export type BackupFrequency = 'daily' | 'weekly' | 'monthly';

export type BackupTargetType = 's3';

export type BackupRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type BackupRunTrigger = 'manual' | 'scheduled' | 'restore' | 'upload' | 'pre_restore';

export type BackupArtifactStorageType = 'local' | 'uploaded' | 'safety';

export interface BackupArtifactManifest {
  artifact_kind?: string;
  format?: string;
  package?: {
    format?: string;
    format_version?: number;
    source?: {
      app_version?: string;
      database?: string;
      timescale_version?: string | null;
      migration_version?: number | null;
    };
    scope?: {
      included?: string[];
      redacted?: string[];
      excluded?: string[];
    };
    components?: Record<string, unknown>;
    restore?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export type BackupRestoreRequestStatus =
  | 'pending'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface BackupSettings {
  enabled: boolean;
  frequency: BackupFrequency;
  run_at: string;
  timezone: string;
  day_of_week: number | null;
  day_of_month: number | null;
  retention_count: number;
  target_type: BackupTargetType;
  endpoint: string;
  region: string | null;
  bucket: string;
  prefix: string;
  access_key: string | null;
  has_secret_key: boolean;
  updated_at: string | null;
}

export interface BackupRun {
  id: string;
  trigger: BackupRunTrigger;
  status: BackupRunStatus;
  artifact_key: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface BackupArtifact {
  id: string;
  run_id: string;
  storage_type: BackupArtifactStorageType;
  file_name: string;
  storage_path: string;
  size_bytes: number;
  checksum_sha256: string;
  manifest: BackupArtifactManifest;
  created_at: string;
}

export interface BackupRestoreRequest {
  id: string;
  artifact_id: string;
  requested_by: string | null;
  status: BackupRestoreRequestStatus;
  confirmation_phrase: string;
  notes: string | null;
  error_message: string | null;
  requested_at: string;
  updated_at: string;
}

export interface BackupOverview {
  settings: BackupSettings;
  recent_runs: BackupRun[];
  recent_runs_total: number;
  recent_runs_page: number;
  recent_runs_per_page: number;
  artifacts: BackupArtifact[];
  restore_requests: BackupRestoreRequest[];
  latest_successful_run: BackupRun | null;
  next_run_at: string | null;
  runtime_readiness: {
    pg_dump_available: boolean;
    run_now_allowed: boolean;
    restore_automation_available: boolean;
    restore_automation_reason?: string | null;
    reason: string | null;
  };
}

export interface RunBackupResponse {
  run: BackupRun;
  artifact: BackupArtifact;
}

export interface CreateBackupRestoreRequestBody {
  artifact_id: string;
  confirmation_phrase: string;
  notes?: string | null;
}

export type RestoreJobPhase =
  | 'queued'
  | 'safety_backup'
  | 'stopping_application'
  | 'restoring_database'
  | 'restoring_settings'
  | 'restoring_artwork'
  | 'starting_application'
  | 'verifying_health'
  | 'completed'
  | 'failed';

export interface RestoreJob {
  id: string;
  artifact_id: string;
  phase: RestoreJobPhase;
  progress_percent: number;
  message: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadBackupResponse {
  artifact: BackupArtifact;
}

export interface StartRestoreResponse {
  job: RestoreJob;
  capability_token: string;
}

export interface UpdateBackupSettingsBody {
  enabled: boolean;
  frequency: BackupFrequency;
  run_at: string;
  timezone: string;
  day_of_week: number | null;
  day_of_month: number | null;
  retention_count: number;
  target_type: BackupTargetType;
  endpoint: string;
  region: string | null;
  bucket: string;
  prefix: string;
  access_key: string | null;
  secret_key?: string | null;
  clear_secret_key?: boolean;
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

export interface CreateDemoVehicleResult {
  ok: boolean;
  vehicle_id: string;
  created: boolean;
  seeded: boolean;
  refreshed: boolean;
  seeded_at: string | null;
  window_start: string | null;
  window_end: string | null;
  counts: {
    telemetry: number;
    trips: number;
    charges: number;
    weather_samples: number;
  } | null;
}

export interface CreateDemoVehicleBody {
  model: 'R1T' | 'R1S' | 'R2S';
}

export interface AuthTokens {
  access_token: string;
  expires_in: number;
  default_vehicle_id: string | null;
}

export interface AuthMeResponse {
  user_id: string;
  email: string;
  role: UserRole;
  default_vehicle_id: string | null;
}

export interface AuthSetupResponse {
  setup_required: boolean;
}

export interface ChangePasswordBody {
  current_password: string;
  new_password: string;
}

export interface AccountInvitationPreview {
  email: string;
  expires_at: string;
}

export type UserRole = 'super_user' | 'admin' | 'user';

export type UnitMode = 'imperial' | 'metric' | 'custom';
export type DistanceUnit = 'miles' | 'kilometers';
export type SpeedUnit = 'mph' | 'kmh';
export type TemperatureUnit = 'fahrenheit' | 'celsius';
export type PressureUnit = 'psi' | 'kpa';
export type AltitudeUnit = 'feet' | 'meters';
export type PlaceRadiusUnit = 'feet' | 'meters';
export type EfficiencyDisplay = 'distance_per_energy' | 'energy_per_distance';

export interface UnitPreferences {
  mode: UnitMode;
  distance_unit: DistanceUnit;
  speed_unit: SpeedUnit;
  temperature_unit: TemperatureUnit;
  pressure_unit: PressureUnit;
  altitude_unit: AltitudeUnit;
  place_radius_unit: PlaceRadiusUnit;
  efficiency_display: EfficiencyDisplay;
}

export type ApiAccessLevel = 'read' | 'view' | 'edit' | 'admin' | (string & {});
export type ApiAccessLevelState = 'supported' | 'legacy_unmigrated' | 'unknown';

export interface ApiKeyRecord {
  id: string;
  vehicle_id: string;
  name: string;
  access_level: ApiAccessLevel;
  access_level_state?: ApiAccessLevelState;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface CreateApiKeyBody {
  vehicle_id: string;
  name: string;
}

export interface CreateApiKeyResult {
  key: string;
  record: ApiKeyRecord;
}

export interface AddVehicleMemberBody {
  email: string;
  role: 'owner' | 'manager' | 'viewer';
}

export interface UpdateVehicleMemberBody {
  role: 'owner' | 'manager' | 'viewer';
}

export interface UpdateVehicleSettingsBody {
  battery_capacity_kwh?: number;
  battery_config?: string | null;
  target_tire_pressure_psi?: number;
}

export interface VehicleMembersResponse {
  members: VehicleMember[];
}

export interface VehicleInvite {
  id: string;
  vehicle_id: string;
  invited_by: string;
  invitee_email: string;
  role: 'owner' | 'manager' | 'viewer';
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface CreateVehicleInviteBody {
  email: string;
  role: 'owner' | 'manager' | 'viewer';
  expires_in_days?: number;
}

export interface AdminUserRecord {
  id: string;
  email: string;
  role: UserRole;
  is_disabled: boolean;
  vehicle_count: number;
  created_at: string;
  updated_at: string;
}

/** Minimal vehicle identity returned to administrators for membership assignment. */
export interface AdminVehicleOption {
  id: string;
  display_name: string;
  model: string;
}

export interface CreateAccountInvitationBody {
  email: string;
  vehicle_id: string | null;
  expires_in_days?: number;
}

export interface AccountInvitation {
  id: string;
  invitee_email: string;
  vehicle_id: string | null;
  vehicle_name: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface UpdateAdminUserBody {
  email?: string;
  role?: UserRole;
  is_disabled?: boolean;
}

export interface AdminUserMembership {
  vehicle_id: string;
  role: 'owner' | 'manager' | 'viewer';
  is_default: boolean;
  created_at: string;
  model: string;
  display_name: string | null;
}

export interface AdminUserInvite {
  id: string;
  vehicle_id: string;
  vehicle_name: string;
  invitee_email: string;
  role: 'owner' | 'manager' | 'viewer';
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface AdminUserDetail {
  user: AdminUserRecord;
  memberships: AdminUserMembership[];
  invites: AdminUserInvite[];
}

export interface ApiCatalog {
  version: string;
  authentication: string;
  endpoints: Array<{
    method: string;
    path: string;
    vehicle_scoped: boolean;
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
  tire_fl_status: string | null;
  tire_fr_status: string | null;
  tire_rl_status: string | null;
  tire_rr_status: string | null;
  tire_fl_valid: boolean | null;
  tire_fr_valid: boolean | null;
  tire_rl_valid: boolean | null;
  tire_rr_valid: boolean | null;
  door_front_left_locked: boolean | null;
  door_front_right_locked: boolean | null;
  door_rear_left_locked: boolean | null;
  door_rear_right_locked: boolean | null;
  door_front_left_closed: boolean | null;
  door_front_right_closed: boolean | null;
  door_rear_left_closed: boolean | null;
  door_rear_right_closed: boolean | null;
  closure_frunk_closed: boolean | null;
  closure_liftgate_closed: boolean | null;
  closure_tailgate_closed: boolean | null;
  ota_current_version: string | null;
  ota_available_version: string | null;
  ota_status: string | null;
  ota_current_status: string | null;
  hv_thermal_event: string | null;
  twelve_volt_health: string | null;
  is_online: boolean | null;
}

export interface RawTelemetryQuery {
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
  search?: string;
  fields?: string[];
  populated_only?: boolean;
}

export interface RawTelemetryFieldCoverage {
  field: keyof RawTelemetrySample | string;
  sample_count: number;
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
    lock_samples: number;
    software_samples: number;
  };
  samples: RawTelemetrySample[];
  total?: number;
  limit?: number;
  offset?: number;
  page?: number;
  per_page?: number;
  selected_fields?: string[];
  field_coverage?: RawTelemetryFieldCoverage[];
}

export type TelemetryLaneName = 'battery' | 'drive' | 'location' | 'climate' | 'charging' | 'health';

export interface TelemetryLaneQuery {
  from?: string;
  to?: string;
  lanes?: TelemetryLaneName[];
  resolution?: 'auto' | '1m' | '5m' | '1h';
  max_points?: number;
}

export interface TelemetryLane {
  numeric: Record<string, Array<number | null>>;
  coverage: Record<string, number>;
  source: string;
}

export interface TelemetryLaneFrame {
  vehicle_id: string;
  window: {
    from: string;
    to: string;
    resolution_seconds: number;
    approximate: boolean;
  };
  spine: string[];
  lanes: Record<TelemetryLaneName, TelemetryLane>;
  truncated: boolean;
}

export interface RawEventQuery {
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
  event_type?: string;
  message_type?: string;
}

export interface RawEventSummary {
  id: string;
  received_at: string;
  event_type: string;
  message_type: string | null;
  has_json: boolean;
  has_payload: boolean;
}

export interface RawEventListResponse {
  vehicle_id: string;
  retention_days: number;
  items: RawEventSummary[];
  total: number;
  page: number;
  per_page: number;
}

export interface RawEventDetail extends RawEventSummary {
  payload: unknown;
  payload_format: 'json' | 'text' | 'empty';
}

export interface RivianStewardshipTotals {
  ws_messages_received: number;
  ws_heartbeats_received: number;
  ws_payload_messages_received: number;
  ws_control_messages_received: number;
  ws_connections_opened: number;
  ws_reconnects: number;
  outbound_messages_sent: number;
  outbound_graphql_requests: number;
  telemetry_writes_persisted: number;
  telemetry_writes_suppressed: number;
  telemetry_suppressed_duplicate: number;
  telemetry_suppressed_empty: number;
  telemetry_suppressed_threshold: number;
  collector_lock_skips: number;
  raw_events_persisted: number;
}

export interface RivianStewardshipVehicle {
  vehicle_id: string;
  display_name: string;
  worker_health: string | null;
  last_seen_at: string | null;
  last_payload_at: string | null;
  last_persisted_at: string | null;
  last_heartbeat_at: string | null;
  ws_messages_received: number;
  ws_heartbeats_received: number;
  ws_payload_messages_received: number;
  ws_reconnects: number;
  telemetry_writes_persisted: number;
  telemetry_writes_suppressed: number;
  collector_lock_skips: number;
}

export interface RivianStewardshipResponse {
  generated_at: string;
  retention_days: number;
  raw_event_persistence_enabled: boolean;
  duplicate_suppression_enabled: boolean;
  active_collectors: number;
  raw_events_retained: number;
  totals_24h: RivianStewardshipTotals;
  vehicles: RivianStewardshipVehicle[];
}
