/**
 * Thin typed wrapper around the Riviamigo REST API.
 * Base URL is read from the VITE_API_URL env var (or defaults to /api).
 */

import type {
  Vehicle, VehicleStatus, VehicleImages, Trip, TrackPoint, ChargeSession, ChargeCurvePoint, ChargeCurveAnalysisPoint,
  StatsSummary, EfficiencyByMode, EfficiencySummary, ChargingSummary, PaginatedResponse,
  AuthTokens, AuthMeResponse, ConnectResult, ApiError, AddVehicleBody, AddVehicleResult,
  ApiKeyRecord, CreateApiKeyBody, CreateApiKeyResult, ApiCatalog, RawTelemetryResponse,
  Place, PlaceSearchSuggestion, UpsertPlaceBody, VehicleHealth, BatteryHealthSummary,
  BatteryMileagePoint, RivianStewardshipResponse, MetricCatalogEntry, MetricSeriesPoint,
  MetricValueResponse, BackupOverview, UpdateBackupSettingsBody, RunBackupResponse,
  CreateBackupRestoreRequestBody, BackupRestoreRequest,
} from '@riviamigo/types';

const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL) || '';

interface ApiFailureDetail {
  status: number;
  code: string;
  message: string;
  method: string;
  path: string;
}

type AuthChangeHandler = (tokens: AuthTokens | null) => void;

class ApiClient {
  private accessToken: string | null = null;
  private authChangeHandler: AuthChangeHandler | null = null;

  setToken(token: string | null) {
    this.accessToken = token;
  }

  onAuthChange(handler: AuthChangeHandler) {
    this.authChangeHandler = handler;
  }

  private applyTokens(tokens: AuthTokens) {
    this.setToken(tokens.access_token);
    this.authChangeHandler?.(tokens);
  }

  private clearTokens() {
    this.setToken(null);
    this.authChangeHandler?.(null);
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
    let url = `${BASE}${path}`;
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
      if (res.status === 401 && retryOnUnauthorized && path !== '/v1/auth/refresh') {
        try {
          const tokens = await this.request<AuthTokens>('POST', '/v1/auth/refresh', undefined, undefined, false, false);
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
      };
      if (reportErrors) this.reportFailure(detail);
      throw Object.assign(new Error(formatApiError(detail)), { status: res.status, code: err.code, detail });
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<AuthTokens> {
    return this.request('POST', '/v1/auth/login', { email, password });
  }

  async register(email: string, password: string): Promise<AuthTokens> {
    return this.request('POST', '/v1/auth/register', { email, password });
  }

  async logout(): Promise<void> {
    return this.request('POST', '/v1/auth/logout');
  }

  async refresh(): Promise<AuthTokens> {
    return this.request('POST', '/v1/auth/refresh');
  }

  async me(): Promise<AuthMeResponse> {
    return this.request('GET', '/v1/auth/me');
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

  async getDegradation(vehicleId: string) {
    return this.request<{ ts: string; usable_kwh: number; rated_kwh: number | null; capacity_pct: number; odometer_mi?: number | null }[]>(
      'GET', '/v1/battery/degradation', undefined, { vehicle_id: vehicleId }
    );
  }

  async getBatteryHealth(vehicleId: string): Promise<BatteryHealthSummary> {
    return this.request('GET', '/v1/battery/health', undefined, { vehicle_id: vehicleId });
  }

  async getBatteryMileage(vehicleId: string): Promise<BatteryMileagePoint[]> {
    return this.request('GET', '/v1/battery/mileage', undefined, { vehicle_id: vehicleId });
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

  // ── Charging ──────────────────────────────────────────────────────────────

  async listChargeSessions(vehicleId: string, from: string, to: string, page = 1, perPage = 25) {
    const offset = (page - 1) * perPage;
    const response = await this.request<PaginatedResponse<unknown> & { data?: unknown[]; limit?: number; offset?: number }>('GET', '/v1/charging', undefined, {
      vehicle_id: vehicleId, from, to, page, per_page: perPage, limit: perPage, offset,
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
      weekly?: Array<{ week_start: string; kwh?: number; energy_kwh?: number; sessions: number }>;
    }>('GET', '/v1/charging/summary', undefined, {
      vehicle_id: vehicleId, from, to,
    });
    const acKwh = (summary.ac_kwh ?? summary.by_type?.ac_kwh ?? 0) + (summary.ac_l2_kwh ?? summary.by_type?.ac_l2_kwh ?? 0);
    const dcKwh = summary.dc_kwh ?? summary.by_type?.dc_kwh ?? 0;
    return {
      total_energy_kwh: summary.total_energy_kwh ?? summary.total_kwh ?? 0,
      total_cost_usd: summary.total_cost_usd ?? 0,
      session_count: summary.session_count ?? 0,
      home_kwh: summary.home_kwh ?? 0,
      away_kwh: summary.away_kwh ?? 0,
      ac_kwh: acKwh,
      dc_kwh: dcKwh,
      charging_cycles: summary.charging_cycles ?? null,
      charging_efficiency_pct: summary.charging_efficiency_pct ?? null,
      total_energy_used_kwh: summary.total_energy_used_kwh ?? null,
      max_charge_limit_pct: summary.max_charge_limit_pct ?? null,
      max_charge_rate_kw: summary.max_charge_rate_kw ?? null,
      typed_session_count: summary.typed_session_count ?? 0,
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

  // ── Efficiency ────────────────────────────────────────────────────────────

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
    return this.request<{ temp_c_low: number; temp_c_high: number; avg_efficiency_wh_mi: number | null; trip_count: number }[]>(
      'GET', '/v1/efficiency/vs-temp', undefined, { vehicle_id: vehicleId, from, to }
    );
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async getStats(vehicleId: string) {
    const stats = await this.request<{
      total_miles: number;
      total_trips: number;
      total_kwh_charged: number;
      lifetime_efficiency_wh_mi: number | null;
      total_charging_sessions: number;
      estimated_total_cost_usd: number | null;
    }>('GET', '/v1/stats/summary', undefined, { vehicle_id: vehicleId });

    return {
      total_miles: stats.total_miles,
      total_trips: stats.total_trips,
      total_energy_kwh: stats.total_kwh_charged,
      avg_efficiency_wh_mi: stats.lifetime_efficiency_wh_mi,
      total_charge_sessions: stats.total_charging_sessions,
      total_cost_usd: stats.estimated_total_cost_usd,
    } satisfies StatsSummary;
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
    const message = formatApiError(detail);
    console.warn('[Riviamigo API] request failed', {
      status: detail.status,
      code: detail.code,
      method: detail.method,
      path: detail.path,
      message: truncate(detail.message, 240),
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('riviamigo:toast', {
        detail: {
          title: 'Request failed',
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

function normalizeChargeSession(raw: unknown): ChargeSession {
  const row = isRecord(raw) ? raw : {};
  const lat = finiteNumber(row.location_lat);
  const lng = finiteNumber(row.location_lng);
  const coordinateLocation =
    lat !== undefined && lng !== undefined ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : null;
  return {
    id: String(row.id ?? ''),
    vehicle_id: String(row.vehicle_id ?? ''),
    started_at: String(row.started_at ?? ''),
    ended_at: row.ended_at == null ? null : String(row.ended_at),
    location_name: typeof row.location_name === 'string' ? row.location_name : (row.is_home === true ? 'Home' : coordinateLocation),
    charger_type: typeof row.charger_type === 'string' ? row.charger_type as ChargeSession['charger_type'] : null,
    energy_added_kwh: finiteNumber(row.energy_added_kwh) ?? finiteNumber(row.kwh_added) ?? (
      finiteNumber(row.energy_added_wh) !== undefined ? finiteNumber(row.energy_added_wh)! / 1000 : null
    ),
    soc_start: finiteNumber(row.soc_start) ?? null,
    soc_end: finiteNumber(row.soc_end) ?? null,
    peak_power_kw: finiteNumber(row.peak_power_kw) ?? finiteNumber(row.max_charge_rate_kw) ?? finiteNumber(row.avg_charge_rate_kw) ?? null,
    cost_usd: finiteNumber(row.cost_usd) ?? null,
    duration_min: finiteNumber(row.duration_min) ?? finiteNumber(row.duration_minutes) ?? null,
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

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
