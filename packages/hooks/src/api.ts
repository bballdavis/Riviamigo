/**
 * Thin typed wrapper around the Riviamigo REST API.
 * Base URL is read from VITE_API_URL or VITE_RIVIAMIGO_API_BASE_URL.
 */

import type {
  Vehicle, VehicleStatus, VehicleImages, Trip, TrackPoint, TripPowerPoint, TripDetailSeriesPoint, ChargeSession, ChargeCurvePoint, ChargeCurveAnalysisPoint,
  StatsSummary, EfficiencyByMode, EfficiencySummary, ChargingSummary, PaginatedResponse,
  AuthTokens, AuthMeResponse, ConnectResult, ApiError, AddVehicleBody, AddVehicleResult,
  ApiKeyRecord, CreateApiKeyBody, CreateApiKeyResult, ApiCatalog, RawTelemetryResponse,
  Place, PlaceSearchSuggestion, UpsertPlaceBody, VehicleHealth, BatteryHealthSummary,
  BatteryMileagePoint, RivianStewardshipResponse, MetricCatalogEntry, MetricSeriesPoint,
  MetricValueResponse, BackupOverview, UpdateBackupSettingsBody, RunBackupResponse, UnitPreferences,
  CreateBackupRestoreRequestBody, BackupRestoreRequest, IdleDrainResponse,
} from '@riviamigo/types';

// ── Schedule & live-session types ─────────────────────────────────────────────

export interface ChargingSchedule {
  id: string;
  enabled: boolean;
  start_time_minutes: number | null;
  duration_minutes: number | null;
  amperage: number | null;
  location_lat: number | null;
  location_lng: number | null;
  week_days: string[] | null;
  rivian_updated_at: string | null;
  updated_at: string;
}

export interface ChargingScheduleInput {
  enabled: boolean;
  start_time_minutes?: number | null;
  duration_minutes?: number | null;
  amperage?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  week_days?: string[] | null;
}

export interface DepartureOccurrence {
  type: 'RepeatsWeekly' | 'Once';
  days?: string[];
  time_minutes?: number;
}

export interface DepartureComfortSettings {
  seat_fl_heat?: number;
  seat_fr_heat?: number;
  seat_rl_heat?: number;
  seat_rr_heat?: number;
  cabin_temp_c?: number;
  defrost?: boolean;
}

export interface DepartureSchedule {
  id: string;
  rivian_schedule_id: string;
  name: string | null;
  enabled: boolean;
  occurrence: DepartureOccurrence | null;
  comfort_settings: DepartureComfortSettings | null;
  updated_at: string;
}

export interface DepartureScheduleInput {
  name?: string | null;
  enabled: boolean;
  occurrence?: DepartureOccurrence | null;
  comfort_settings?: DepartureComfortSettings | null;
}

export interface LiveSession {
  soc_pct: number | null;
  power_kw: number | null;
  energy_kwh: number | null;
  range_added_km: number | null;
  time_remaining_min: number | null;
  charger_type: string | null;
  ts: string;
}

export interface BackfillStatus {
  vehicle_id: string;
  history_backfilled_at: string | null;
  status: string | null;
  rivian_session_count: number | null;
  local_session_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────

function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function resolveApiBaseUrl(
  configuredBaseUrl = (() => {
    const env = typeof import.meta !== 'undefined'
      ? (import.meta as { env?: { VITE_API_URL?: string; VITE_RIVIAMIGO_API_BASE_URL?: string } }).env
      : undefined;
    return env?.VITE_API_URL ?? env?.VITE_RIVIAMIGO_API_BASE_URL ?? '';
  })(),
  location: Pick<Location, 'hostname' | 'origin'> | undefined = typeof window === 'undefined' ? undefined : window.location,
) {
  if (!configuredBaseUrl || !location) {
    return configuredBaseUrl;
  }

  try {
    const url = new URL(configuredBaseUrl, location.origin);
    // Route loopback targets through the app origin so dev traffic uses the
    // Vite proxy (`/v1`) rather than direct cross-origin calls to :3001.
    // This avoids CORS preflight amplification and keeps WS/HTTP behavior
    // consistent for both localhost and LAN clients.
    if (isLoopbackHostname(url.hostname)) {
      return '';
    }
  } catch {
    return configuredBaseUrl;
  }

  return configuredBaseUrl;
}

let _base: string | undefined;
function getBase(): string {
  if (_base === undefined) _base = resolveApiBaseUrl();
  return _base;
}

/** Override the API base URL — useful in tests and server-side rendering contexts.
 *  Pass `undefined` to clear the override and re-derive from env on next call. */
export function setApiBaseUrl(url: string | undefined): void {
  _base = url;
}

interface ApiFailureDetail {
  status: number;
  code: string;
  message: string;
  method: string;
  path: string;
  rateLimitSource?: string;
  retryAfterSeconds?: number;
}

const AUTH_REFRESH_EXCLUDED_PATHS = new Set([
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/refresh',
]);

type AuthChangeHandler = (tokens: AuthTokens | null) => void;

class ApiClient {
  private accessToken: string | null = null;
  private authChangeHandler: AuthChangeHandler | null = null;
  private refreshPromise: Promise<AuthTokens> | null = null;
  private authExpiredReported = false;

  setToken(token: string | null) {
    this.accessToken = token;
    if (token) this.authExpiredReported = false;
  }

  onAuthChange(handler: AuthChangeHandler) {
    this.authChangeHandler = handler;
  }

  private applyTokens(tokens: AuthTokens) {
    this.setToken(tokens.access_token);
    this.authExpiredReported = false;
    this.authChangeHandler?.(tokens);
  }

  private clearTokens() {
    this.setToken(null);
    this.authChangeHandler?.(null);
  }

  private refreshAccessToken(): Promise<AuthTokens> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.request<AuthTokens>(
        'POST',
        '/v1/auth/refresh',
        undefined,
        undefined,
        false,
        false,
      ).finally(() => {
        this.refreshPromise = null;
      });
    }

    return this.refreshPromise;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.accessToken) h['Authorization'] = `Bearer ${this.accessToken}`;
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number>,
    retryOnUnauthorized = true,
    reportErrors = true
  ): Promise<T> {
    let url = `${getBase()}${path}`;
    if (params) {
      const q = new URLSearchParams(
        Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
      );
      url += `?${q}`;
    }

    const res = await fetch(url, {
      method,
      headers: this.headers(),
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      const rateLimitSource = res.headers.get('x-riviamigo-ratelimit-source') ?? undefined;
      const retryAfterSeconds = (() => {
        const header = res.headers.get('retry-after');
        if (!header) return undefined;
        const parsed = Number(header);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
      })();

      if (res.status === 401 && retryOnUnauthorized && this.accessToken && !AUTH_REFRESH_EXCLUDED_PATHS.has(path)) {
        try {
          const tokens = await this.refreshAccessToken();
          this.applyTokens(tokens);
          return this.request<T>(method, path, body, params, false);
        } catch {
          this.clearTokens();
          const detail = {
            status: res.status,
            code: 'AUTH_EXPIRED',
            message: `Session expired while calling ${method} ${path}. Sign in again.`,
            method,
            path,
            rateLimitSource,
            retryAfterSeconds,
          };
          this.reportFailure(detail);
          throw Object.assign(new Error(formatApiError(detail)), { status: res.status, code: detail.code, detail });
        }
      }

      const responseBody = await res.json().catch(() => null);
      const err: ApiError = responseBody?.error ?? { code: 'unknown', message: res.statusText };
      const detail = {
        status: res.status,
        code: err.code,
        message: err.message,
        method,
        path,
        rateLimitSource,
        retryAfterSeconds,
      };
      if (reportErrors) this.reportFailure(detail);
      throw Object.assign(new Error(formatApiError(detail)), { status: res.status, code: err.code, detail });
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ── Public escape-hatch for packages that can't depend on `request` directly ──

  /** Proxy for packages/dashboards (and similar) that can't import `request` directly. */
  async apiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, path, body);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<AuthTokens> {
    return this.request('POST', '/v1/auth/login', { email, password }, undefined, true, false);
  }

  async register(email: string, password: string): Promise<AuthTokens> {
    return this.request('POST', '/v1/auth/register', { email, password }, undefined, true, false);
  }

  async logout(): Promise<void> {
    return this.request('POST', '/v1/auth/logout');
  }

  async refresh(): Promise<AuthTokens> {
    // Refresh can legitimately return 401 when no refresh cookie exists
    // (first load, logged out, expired session). Keep this path quiet.
    return this.request('POST', '/v1/auth/refresh', undefined, undefined, true, false);
  }

  async me(): Promise<AuthMeResponse> {
    return this.request('GET', '/v1/auth/me');
  }

  async getUnitPreferences(): Promise<{ units: UnitPreferences }> {
    return this.request('GET', '/v1/auth/preferences');
  }

  async updateUnitPreferences(units: UnitPreferences): Promise<{ units: UnitPreferences }> {
    return this.request('PUT', '/v1/auth/preferences', { units });
  }

  // ── Vehicles ──────────────────────────────────────────────────────────────

  async listVehicles(): Promise<Vehicle[]> {
    const res = await this.request<{ vehicles: Vehicle[] }>('GET', '/v1/vehicles');
    return res.vehicles ?? [];
  }

  async vehicleStatus(vehicleId: string): Promise<VehicleStatus> {
    return this.request('GET', `/v1/vehicles/${vehicleId}/status`);
  }

  async vehicleImages(vehicleId: string): Promise<VehicleImages> {
    return this.request('GET', `/v1/vehicles/${vehicleId}/images`);
  }

  async addVehicle(body: AddVehicleBody): Promise<AddVehicleResult> {
    return this.request('POST', '/v1/vehicles', body);
  }

  async deleteVehicle(vehicleId: string): Promise<{ ok: boolean; default_vehicle_id: string | null }> {
    return this.request('DELETE', `/v1/vehicles/${vehicleId}`);
  }

  async refreshVehicleCredentials(vehicleId: string, rivianVehicleId?: string): Promise<{ ok: boolean; vehicle_id: string }> {
    return this.request('PUT', `/v1/vehicles/${vehicleId}/credentials`, {
      rivian_vehicle_id: rivianVehicleId,
    });
  }

  async connectRivian(email: string, password: string): Promise<ConnectResult> {
    return this.request('POST', '/v1/vehicles/connect', { email, password });
  }

  async connectRivianOtp(challengeId: string, otp: string): Promise<ConnectResult> {
    return this.request('POST', '/v1/vehicles/connect/otp', { challenge_id: challengeId, otp_code: otp });
  }

  async updateVehicleBatteryConfig(
    vehicleId: string,
    body: { battery_capacity_kwh?: number; battery_config?: string }
  ): Promise<void> {
    return this.request('PUT', `/v1/vehicles/${vehicleId}/battery-config`, body);
  }

  async updateVehicleName(vehicleId: string, name: string): Promise<void> {
    return this.request('PUT', `/v1/vehicles/${vehicleId}/name`, { name });
  }

  // API access

  async listApiKeys(): Promise<ApiKeyRecord[]> {
    return this.request('GET', '/v1/api-keys');
  }

  async createApiKey(body: CreateApiKeyBody): Promise<CreateApiKeyResult> {
    return this.request('POST', '/v1/api-keys', body);
  }

  async revokeApiKey(id: string): Promise<void> {
    return this.request('DELETE', `/v1/api-keys/${id}`);
  }

  async listPlaces(): Promise<Place[]> {
    const response = await this.request<{ places: Place[] }>('GET', '/v1/places');
    return response.places ?? [];
  }

  async searchPlaceAddresses(query: string, limit = 5): Promise<PlaceSearchSuggestion[]> {
    return this.request('GET', '/v1/places/search', undefined, { q: query, limit });
  }

  async createPlace(body: UpsertPlaceBody): Promise<Place> {
    return this.request('POST', '/v1/places', body);
  }

  async updatePlace(id: string, body: UpsertPlaceBody): Promise<Place> {
    return this.request('PUT', `/v1/places/${id}`, body);
  }

  async deletePlace(id: string): Promise<void> {
    return this.request('DELETE', `/v1/places/${id}`);
  }

  async getApiCatalog(): Promise<ApiCatalog> {
    return this.request('GET', '/v1/api/catalog');
  }

  async getBackupOverview(): Promise<BackupOverview> {
    return this.request('GET', '/v1/admin/backups');
  }

  async updateBackupSettings(body: UpdateBackupSettingsBody) {
    return this.request('PUT', '/v1/admin/backups/settings', body);
  }

  async runBackupNow(): Promise<RunBackupResponse> {
    return this.request('POST', '/v1/admin/backups/run');
  }

  async requestBackupRestore(body: CreateBackupRestoreRequestBody): Promise<BackupRestoreRequest> {
    return this.request('POST', '/v1/admin/backups/restore-requests', body);
  }

  // ── Battery ───────────────────────────────────────────────────────────────

  async getSoc(vehicleId: string, from: string, to: string) {
    return this.request<{ ts: string; value: number | null }[]>('GET', '/v1/battery/soc', undefined, {
      vehicle_id: vehicleId, from, to,
    });
  }

  async getRange(vehicleId: string, from: string, to: string) {
    return this.request<{ ts: string; value: number | null }[]>('GET', '/v1/battery/range', undefined, {
      vehicle_id: vehicleId, from, to,
    });
  }

  async getPhantomDrain(vehicleId: string, from: string, to: string) {
    return this.request<{ day: string; total_soc_lost: number | null; avg_drain_rate: number | null; hours_parked: number | null }[]>(
      'GET', '/v1/battery/phantom-drain', undefined, { vehicle_id: vehicleId, from, to }
    );
  }

  async getIdleDrainPeriods(
    vehicleId: string,
    from: string,
    to: string,
    limit = 250,
    minDurationHours = 6,
  ): Promise<IdleDrainResponse> {
    return this.request(
      'GET',
      `/v1/vehicles/${vehicleId}/idle-drain`,
      undefined,
      {
        from,
        to,
        limit,
        min_duration_hours: minDurationHours,
      },
    );
  }

  async getDegradation(vehicleId: string) {
    return this.request<{ ts: string; usable_kwh: number; rated_kwh: number | null; capacity_pct: number; odometer_mi?: number | null }[]>(
      'GET', '/v1/battery/degradation', undefined, { vehicle_id: vehicleId }
    );
  }

  async getBatteryHealth(vehicleId: string): Promise<BatteryHealthSummary> {
    return this.request('GET', '/v1/battery/health', undefined, { vehicle_id: vehicleId });
  }

  async getBatteryMileage(vehicleId: string, from?: string, to?: string): Promise<BatteryMileagePoint[]> {
    const rows = await this.request<Array<Record<string, unknown>>>(
      'GET',
      '/v1/battery/mileage',
      undefined,
      {
        vehicle_id: vehicleId,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
    );

    return rows.map((row) => ({
      ts: typeof row.ts === 'string' ? row.ts : new Date().toISOString(),
      odometer_mi: finiteNumber(row.odometer_mi) ?? null,
      usable_kwh: finiteNumber(row.usable_kwh) ?? null,
      range_mi: finiteNumber(row.range_mi) ?? null,
      projected_max_range_mi: finiteNumber(row.projected_max_range_mi) ?? null,
      degradation_pct: finiteNumber(row.degradation_pct) ?? null,
    })) satisfies BatteryMileagePoint[];
  }

  // ── Trips ─────────────────────────────────────────────────────────────────

  async listTrips(vehicleId: string, from: string, to: string, page = 1, perPage = 25, search = '') {
    const offset = (page - 1) * perPage;
    const trimmedSearch = search.trim();
    const response = await this.request<PaginatedResponse<unknown> & { data?: unknown[]; limit?: number; offset?: number }>('GET', '/v1/trips', undefined, {
      vehicle_id: vehicleId,
      from,
      to,
      page,
      per_page: perPage,
      limit: perPage,
      offset,
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
    });
    const normalized = normalizePaginated(response, page, perPage);
    return {
      ...normalized,
      items: normalized.items.map(normalizeTrip),
    } satisfies PaginatedResponse<Trip>;
  }

  async getTrip(tripId: string, vehicleId: string) {
    const trip = await this.request<unknown>('GET', `/v1/trips/${tripId}`, undefined, { vehicle_id: vehicleId });
    return normalizeTrip(trip);
  }

  async getTripTrack(tripId: string, vehicleId: string) {
    return this.request<TrackPoint[]>('GET', `/v1/trips/${tripId}/track`, undefined, { vehicle_id: vehicleId });
  }

  async getSpeedProfile(tripId: string, vehicleId: string) {
    const rows = await this.request<Array<{ elapsed_s?: number; speed_mph?: number; ts?: string; value?: number | null }>>(
      'GET', `/v1/trips/${tripId}/speed`, undefined, { vehicle_id: vehicleId }
    );
    return rows
      .map((row, index) => ({
        elapsed_s: finiteNumber(row.elapsed_s) ?? index * 60,
        speed_mph: finiteNumber(row.speed_mph) ?? finiteNumber(row.value) ?? 0,
      }))
      .filter((row) => Number.isFinite(row.elapsed_s) && Number.isFinite(row.speed_mph));
  }

  async getElevationProfile(tripId: string, vehicleId: string) {
    return this.request<{ ts: string; value: number | null }[]>(
      'GET', `/v1/trips/${tripId}/elevation`, undefined, { vehicle_id: vehicleId }
    );
  }

  async getTripPowerProfile(tripId: string, vehicleId: string) {
    const rows = await this.request<Array<Record<string, unknown>>>(
      'GET', `/v1/trips/${tripId}/power`, undefined, { vehicle_id: vehicleId }
    );

    return rows
      .map((row) => ({
        ts: typeof row.ts === 'string' ? row.ts : new Date().toISOString(),
        power_kw: finiteNumber(row.power_kw) ?? null,
        regen_power_kw: finiteNumber(row.regen_power_kw) ?? null,
        speed_mph: finiteNumber(row.speed_mph) ?? null,
        battery_level: finiteNumber(row.battery_level) ?? null,
      }))
      .filter((row) => typeof row.ts === 'string') satisfies TripPowerPoint[];
  }

  async getTripDetailSeries(tripId: string, vehicleId: string) {
    const rows = await this.request<Array<Record<string, unknown>>>(
      'GET', `/v1/trips/${tripId}/series`, undefined, { vehicle_id: vehicleId }
    );

    return rows
      .map((row) => ({
        ts: typeof row.ts === 'string' ? row.ts : new Date().toISOString(),
        speed_mph: finiteNumber(row.speed_mph) ?? null,
        power_kw: finiteNumber(row.power_kw) ?? null,
        regen_power_kw: finiteNumber(row.regen_power_kw) ?? null,
        battery_level: finiteNumber(row.battery_level) ?? null,
        outside_temp_c: finiteNumber(row.outside_temp_c) ?? null,
        cabin_temp_c: finiteNumber(row.cabin_temp_c) ?? null,
        driver_temp_c: finiteNumber(row.driver_temp_c) ?? null,
        hvac_active: typeof row.hvac_active === 'boolean' ? row.hvac_active : null,
        tire_fl_psi: finiteNumber(row.tire_fl_psi) ?? null,
        tire_fr_psi: finiteNumber(row.tire_fr_psi) ?? null,
        tire_rl_psi: finiteNumber(row.tire_rl_psi) ?? null,
        tire_rr_psi: finiteNumber(row.tire_rr_psi) ?? null,
      }))
      .filter((row) => typeof row.ts === 'string') satisfies TripDetailSeriesPoint[];
  }

  // ── Charging ──────────────────────────────────────────────────────────────

  async listChargeSessions(vehicleId: string, from: string, to: string, page = 1, perPage = 25, search = '') {
    const offset = (page - 1) * perPage;
    const trimmedSearch = search.trim();
    const response = await this.request<PaginatedResponse<unknown> & { data?: unknown[]; limit?: number; offset?: number }>('GET', '/v1/charging', undefined, {
      vehicle_id: vehicleId,
      from,
      to,
      page,
      per_page: perPage,
      limit: perPage,
      offset,
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
    });
    const normalized = normalizePaginated(response, page, perPage);
    return {
      ...normalized,
      items: normalized.items.map(normalizeChargeSession),
    } satisfies PaginatedResponse<ChargeSession>;
  }

  async getChargeSession(sessionId: string, vehicleId: string) {
    const response = await this.request<unknown>('GET', `/v1/charging/${sessionId}`, undefined, { vehicle_id: vehicleId });
    return normalizeChargeSession(isRecord(response) && 'session' in response ? response.session : response);
  }

  async getChargeCurve(sessionId: string, vehicleId: string) {
    const rows = await this.request<Array<Record<string, unknown>>>(
      'GET', `/v1/charging/sessions/${sessionId}/curve`, undefined, { vehicle_id: vehicleId }
    );
    return rows.map((row) => ({
      minutes_elapsed: finiteNumber(row.minutes_elapsed) ?? null,
      soc_pct: finiteNumber(row.soc_pct) ?? finiteNumber(row.soc) ?? 0,
      power_kw: finiteNumber(row.power_kw) ?? finiteNumber(row.charge_rate_kw) ?? 0,
    })) satisfies ChargeCurvePoint[];
  }

  async getChargeCurveAnalysis(vehicleId: string, from: string, to: string) {
    const rows = await this.request<Array<Record<string, unknown>>>(
      'GET', '/v1/charging/curve-analysis', undefined, { vehicle_id: vehicleId, from, to }
    );
    return rows.map((row) => ({
      soc_pct: finiteNumber(row.soc_pct) ?? finiteNumber(row.soc) ?? 0,
      charge_rate_kw: finiteNumber(row.charge_rate_kw) ?? finiteNumber(row.power_kw) ?? 0,
      charger_type: typeof row.charger_type === 'string'
        ? row.charger_type as ChargeCurveAnalysisPoint['charger_type']
        : null,
    })) satisfies ChargeCurveAnalysisPoint[];
  }

  async getChargingSummary(vehicleId: string, from: string, to: string) {
    const summary = await this.request<{
      total_energy_kwh?: number;
      total_kwh?: number;
      total_cost_usd?: number;
      session_count?: number;
      home_kwh?: number;
      away_kwh?: number;
      unknown_location_kwh?: number;
      ac_kwh?: number;
      ac_l2_kwh?: number;
      dc_kwh?: number;
      by_type?: { ac_kwh?: number; ac_l2_kwh?: number; dc_kwh?: number };
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
      weekly?: Array<{ week_start: string; kwh?: number; energy_kwh?: number; sessions: number }>;
    }>('GET', '/v1/charging/summary', undefined, {
      vehicle_id: vehicleId, from, to,
    });
    const acKwh = (summary.ac_kwh ?? summary.by_type?.ac_kwh ?? 0) + (summary.ac_l2_kwh ?? summary.by_type?.ac_l2_kwh ?? 0);
    const dcKwh = summary.dc_kwh ?? summary.by_type?.dc_kwh ?? 0;
    return {
      total_energy_kwh: summary.total_energy_kwh ?? summary.total_kwh ?? 0,
      total_cost_usd: summary.total_cost_usd ?? null,
      session_count: summary.session_count ?? 0,
      home_kwh: summary.home_kwh ?? 0,
      away_kwh: summary.away_kwh ?? 0,
      unknown_location_kwh: summary.unknown_location_kwh ?? 0,
      ac_kwh: acKwh,
      dc_kwh: dcKwh,
      charging_cycles: summary.charging_cycles ?? null,
      charging_efficiency_pct: summary.charging_efficiency_pct ?? null,
      total_energy_used_kwh: summary.total_energy_used_kwh ?? null,
      max_charge_limit_pct: summary.max_charge_limit_pct ?? null,
      max_charge_rate_kw: summary.max_charge_rate_kw ?? null,
      typed_session_count: summary.typed_session_count ?? 0,
      known_cost_session_count: summary.known_cost_session_count ?? 0,
      unknown_cost_session_count: summary.unknown_cost_session_count ?? 0,
      free_session_count: summary.free_session_count ?? 0,
      total_range_added_km: summary.total_range_added_km ?? null,
      rivian_paid_total_usd: summary.rivian_paid_total_usd ?? null,
      network_breakdown: summary.network_breakdown ?? [],
      weekly: (summary.weekly ?? []).map((week) => ({
        week_start: week.week_start,
        energy_kwh: week.energy_kwh ?? week.kwh ?? 0,
        sessions: week.sessions,
      })),
    } satisfies ChargingSummary;
  }

  async getVehicleHealth(vehicleId: string): Promise<VehicleHealth> {
    return this.request('GET', `/v1/vehicles/${vehicleId}/health`);
  }

  async getChargingSchedule(vehicleId: string): Promise<ChargingSchedule | null> {
    return this.request('GET', `/v1/vehicles/${vehicleId}/charging-schedule`);
  }

  async putChargingSchedule(vehicleId: string, body: ChargingScheduleInput): Promise<void> {
    return this.request('PUT', `/v1/vehicles/${vehicleId}/charging-schedule`, body);
  }

  async listDepartureSchedules(vehicleId: string): Promise<DepartureSchedule[]> {
    return this.request('GET', `/v1/vehicles/${vehicleId}/departure-schedules`);
  }

  async createDepartureSchedule(vehicleId: string, body: DepartureScheduleInput): Promise<{ rivian_schedule_id: string }> {
    return this.request('POST', `/v1/vehicles/${vehicleId}/departure-schedules`, body);
  }

  async updateDepartureSchedule(vehicleId: string, scheduleId: string, body: DepartureScheduleInput): Promise<void> {
    return this.request('PATCH', `/v1/vehicles/${vehicleId}/departure-schedules/${scheduleId}`, body);
  }

  async deleteDepartureSchedule(vehicleId: string, scheduleId: string): Promise<void> {
    return this.request('DELETE', `/v1/vehicles/${vehicleId}/departure-schedules/${scheduleId}`);
  }

  async getLiveSession(vehicleId: string): Promise<LiveSession | null> {
    // 204 = no active session → returns undefined from request()
    const result = await this.request<LiveSession | undefined>('GET', `/v1/vehicles/${vehicleId}/live-session`);
    return result ?? null;
  }

  async getBackfillStatus(vehicleId: string): Promise<BackfillStatus> {
    return this.request('GET', `/v1/vehicles/${vehicleId}/backfill-status`);
  }

  async triggerBackfill(vehicleId: string): Promise<void> {
    return this.request('POST', `/v1/vehicles/${vehicleId}/backfill`);
  }

  // ── Efficiency ────────────────────────────────────────────────────────────

  async getStats(vehicleId: string): Promise<StatsSummary> {
    return this.request<StatsSummary>('GET', '/v1/stats', undefined, { vehicle_id: vehicleId });
  }

  async getEfficiencySummary(vehicleId: string, from: string, to: string) {
    const summary = await this.request<{
      avg_wh_per_mi: number;
      p10_wh_per_mi: number;
      p90_wh_per_mi: number;
      total_miles: number;
    }>('GET', '/v1/efficiency/summary', undefined, { vehicle_id: vehicleId, from, to });

    return {
      avg: summary.avg_wh_per_mi,
      p10: summary.p10_wh_per_mi,
      p90: summary.p90_wh_per_mi,
      total_miles: summary.total_miles,
    } satisfies EfficiencySummary;
  }

  async getEfficiencyByMode(vehicleId: string, from: string, to: string) {
    const rows = await this.request<Array<{
      drive_mode: string;
      avg_wh_per_mi: number;
      trip_count: number;
    }>>('GET', '/v1/efficiency/by-mode', undefined, {
      vehicle_id: vehicleId, from, to,
    });

    return rows.map((row) => ({
      drive_mode: row.drive_mode,
      avg_efficiency: row.avg_wh_per_mi,
      p10_efficiency: 0,
      p90_efficiency: 0,
      trip_count: row.trip_count,
    })) satisfies EfficiencyByMode[];
  }

  async getEfficiencyTrend(vehicleId: string, from: string, to: string) {
    return this.request<{ day: string; day_avg_wh_mi: number | null; rolling_7d_wh_mi: number | null }[]>(
      'GET', '/v1/efficiency/trend', undefined, { vehicle_id: vehicleId, from, to }
    );
  }

  async getEfficiencyVsTemp(vehicleId: string, from: string, to: string) {
    return this.request<{ temp_c_low: number; temp_c_high: number; avg_efficiency_wh_mi: number | null; trip_count: number; total_miles: number | null; avg_speed_mph: number | null }[]>(
      'GET', '/v1/efficiency/vs-temp', undefined, { vehicle_id: vehicleId, from, to }
    );
  }

  async getMetricCatalog(): Promise<MetricCatalogEntry[]> {
    const response = await this.request<{ metrics: MetricCatalogEntry[] }>('GET', '/v1/metrics/catalog');
    return response.metrics ?? [];
  }

  async getMetricValue(vehicleId: string, metric: string): Promise<MetricValueResponse> {
    return this.request('GET', '/v1/metrics/value', undefined, { vehicle_id: vehicleId, metric });
  }

  async getMetricSeries(
    vehicleId: string,
    metric: string,
    from: string,
    to: string,
    bucket = 'day',
  ): Promise<MetricSeriesPoint[]> {
    return this.request('GET', '/v1/metrics/series', undefined, {
      vehicle_id: vehicleId,
      metric,
      from,
      to,
      bucket,
    });
  }

  async getRawTelemetry(vehicleId: string, limit = 25) {
    return this.request<RawTelemetryResponse>('GET', `/v1/vehicles/${vehicleId}/raw-data`, undefined, { limit });
  }

  async getRivianStewardship(): Promise<RivianStewardshipResponse> {
    return this.request('GET', '/v1/admin/rivian/stewardship');
  }

  private reportFailure(detail: ApiFailureDetail) {
    if (detail.path === '/v1/auth/refresh' && detail.status === 401) return;

    if (detail.code === 'AUTH_EXPIRED') {
      if (this.authExpiredReported) return;
      this.authExpiredReported = true;
    }

    console.warn('[Riviamigo API] request failed', {
      status: detail.status,
      code: detail.code,
      method: detail.method,
      path: detail.path,
      rateLimitSource: detail.rateLimitSource,
      retryAfterSeconds: detail.retryAfterSeconds,
      message: truncate(detail.message, 240),
    });

    if (typeof window !== 'undefined') {
      const onLoginRoute = window.location.pathname === '/login';
      if (onLoginRoute && detail.path !== '/v1/auth/login' && detail.path !== '/v1/auth/register') {
        return;
      }

      const { title, message } = friendlyApiError(detail);
      window.dispatchEvent(new CustomEvent('riviamigo:toast', {
        detail: {
          title,
          message,
          variant: 'error',
          code: detail.code,
        },
      }));

      if (detail.code === 'AUTH_EXPIRED') {
        window.dispatchEvent(new CustomEvent('riviamigo:auth-expired', { detail }));
      }
    }
  }

}

export const api = new ApiClient();

function normalizePaginated<T>(
  response: PaginatedResponse<T> & { data?: T[]; limit?: number; offset?: number },
  requestedPage: number,
  requestedPerPage: number,
): PaginatedResponse<T> {
  const perPage = response.per_page ?? response.limit ?? requestedPerPage;
  const page = response.page ?? (response.offset !== undefined ? Math.floor(response.offset / perPage) + 1 : requestedPage);
  return {
    items: response.items ?? response.data ?? [],
    total: response.total ?? 0,
    page,
    per_page: perPage,
  };
}

function normalizeTrip(raw: unknown): Trip {
  const row = isRecord(raw) ? raw : {};
  const distance = finiteNumber(row.distance_mi) ?? finiteNumber(row.distance_miles) ?? 0;
  const durationMin = finiteNumber(row.duration_min)
    ?? (finiteNumber(row.duration_seconds) !== undefined ? finiteNumber(row.duration_seconds)! / 60 : 0);
  const efficiency = finiteNumber(row.efficiency_wh_mi) ?? finiteNumber(row.efficiency_wh_per_mile);
  const energy = finiteNumber(row.energy_used_kwh)
    ?? (finiteNumber(row.energy_wh) !== undefined ? finiteNumber(row.energy_wh)! / 1000 : undefined)
    ?? (efficiency !== undefined && distance > 0 ? efficiency * distance / 1000 : undefined);

  return {
    id: String(row.id ?? ''),
    vehicle_id: String(row.vehicle_id ?? ''),
    started_at: String(row.started_at ?? ''),
    ended_at: row.ended_at == null ? null : String(row.ended_at),
    distance_mi: distance,
    duration_min: durationMin,
    energy_used_kwh: energy ?? null,
    efficiency_wh_mi: efficiency ?? null,
    max_speed_mph: finiteNumber(row.max_speed_mph) ?? null,
    drive_mode: typeof row.drive_mode === 'string' ? row.drive_mode as Trip['drive_mode'] : null,
    soc_start: finiteNumber(row.soc_start) ?? null,
    soc_end: finiteNumber(row.soc_end) ?? null,
    start_lat: finiteNumber(row.start_lat) ?? null,
    start_lng: finiteNumber(row.start_lng) ?? null,
    end_lat: finiteNumber(row.end_lat) ?? null,
    end_lng: finiteNumber(row.end_lng) ?? null,
    start_address: typeof row.start_address === 'string' ? row.start_address : null,
    end_address: typeof row.end_address === 'string' ? row.end_address : null,
    start_place: typeof row.start_place === 'string'
      ? row.start_place
      : (typeof row.start_place_name === 'string' ? row.start_place_name : null),
    end_place: typeof row.end_place === 'string'
      ? row.end_place
      : (typeof row.end_place_name === 'string' ? row.end_place_name : null),
  };
}

const VALID_CHARGER_TYPES = new Set<string>(['AC', 'DC', 'DCFC']);

function normalizeChargeSession(raw: unknown): ChargeSession {
  const row = isRecord(raw) ? raw : {};
  const id = String(row.id ?? '');
  if (!id) throw new Error('normalizeChargeSession: missing id in response');
  const lat = finiteNumber(row.location_lat);
  const lng = finiteNumber(row.location_lng);
  const coordinateLocation =
    lat !== undefined && lng !== undefined ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : null;
  return {
    id,
    vehicle_id: String(row.vehicle_id ?? ''),
    started_at: String(row.started_at ?? ''),
    session_day_local: typeof row.session_day_local === 'string' ? row.session_day_local : null,
    ended_at: row.ended_at == null ? null : String(row.ended_at),
    location_name: typeof row.location_name === 'string' ? row.location_name : (row.is_home === true ? 'Home' : coordinateLocation),
    charger_type: typeof row.charger_type === 'string' && VALID_CHARGER_TYPES.has(row.charger_type)
      ? row.charger_type as ChargeSession['charger_type']
      : null,
    energy_added_kwh: finiteNumber(row.energy_added_kwh) ?? finiteNumber(row.kwh_added) ?? (
      finiteNumber(row.energy_added_wh) !== undefined ? finiteNumber(row.energy_added_wh)! / 1000 : null
    ),
    soc_start: finiteNumber(row.soc_start) ?? null,
    soc_end: finiteNumber(row.soc_end) ?? null,
    peak_power_kw: finiteNumber(row.peak_power_kw) ?? finiteNumber(row.max_charge_rate_kw) ?? finiteNumber(row.avg_charge_rate_kw) ?? null,
    cost_usd: finiteNumber(row.cost_usd) ?? null,
    duration_min: finiteNumber(row.duration_min) ?? finiteNumber(row.duration_minutes) ?? null,
    source: typeof row.source === 'string' ? row.source : null,
    telemetry_sample_count: finiteNumber(row.telemetry_sample_count) ?? 0,
    network_vendor: typeof row.network_vendor === 'string' ? row.network_vendor : null,
    range_added_km: finiteNumber(row.range_added_km) ?? null,
    is_free_session: typeof row.is_free_session === 'boolean' ? row.is_free_session : null,
    is_rivian_network: typeof row.is_rivian_network === 'boolean' ? row.is_rivian_network : null,
    rivian_paid_total: finiteNumber(row.rivian_paid_total) ?? null,
    rivian_charger_type: typeof row.rivian_charger_type === 'string' ? row.rivian_charger_type : null,
    currency_code: typeof row.currency_code === 'string' ? row.currency_code : null,
    rivian_city: typeof row.rivian_city === 'string' ? row.rivian_city : null,
    is_public: typeof row.is_public === 'boolean' ? row.is_public : null,
    charger_id: typeof row.charger_id === 'string' ? row.charger_id : null,
    live_current_price: finiteNumber(row.live_current_price) ?? null,
    live_current_currency: typeof row.live_current_currency === 'string' ? row.live_current_currency : null,
    live_total_charged_kwh: finiteNumber(row.live_total_charged_kwh) ?? null,
    live_range_added_km: finiteNumber(row.live_range_added_km) ?? null,
    live_power_kw: finiteNumber(row.live_power_kw) ?? null,
    live_charge_rate_kph: finiteNumber(row.live_charge_rate_kph) ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function formatApiError(detail: ApiFailureDetail) {
  return `${detail.status} ${detail.code}: ${truncate(detail.message, 160)}`;
}

function friendlyApiError(detail: ApiFailureDetail): { title: string; message: string } {
  const { status, code } = detail;
  if (code === 'AUTH_EXPIRED') return { title: 'Session expired', message: 'Please sign in again to continue.' };
  if (status === 401) return { title: 'Session expired', message: 'Please sign in again to continue.' };
  if (status === 403) return { title: 'Access denied', message: 'You don\'t have permission to do that.' };
  if (status === 404) return { title: 'Not found', message: 'The requested resource could not be found.' };
  if (status === 429) {
    const source = detail.rateLimitSource;
    const waitHint = detail.retryAfterSeconds != null ? ` Try again in about ${Math.max(1, Math.ceil(detail.retryAfterSeconds))}s.` : '';
    if (source === 'nginx') {
      return { title: 'Too many requests', message: `Edge proxy rate limit reached.${waitHint}` };
    }
    if (source === 'api') {
      return { title: 'Too many requests', message: `API rate limit reached.${waitHint}` };
    }
    return { title: 'Too many requests', message: `Please wait a moment and try again.${waitHint}` };
  }
  if (status != null && status >= 500) return { title: 'Server error', message: 'Something went wrong on our end. Please try again later.' };
  return { title: 'Something went wrong', message: truncate(detail.message, 120) || 'An unexpected error occurred.' };
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
