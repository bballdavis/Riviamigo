/**
 * Thin typed wrapper around the Riviamigo REST API.
 * Base URL is read from the VITE_API_URL env var (or defaults to /api).
 */

import type {
  Vehicle, VehicleStatus, VehicleImages, Trip, TrackPoint, ChargeSession, ChargeCurvePoint,
  StatsSummary, EfficiencyByMode, EfficiencySummary, ChargingSummary, PaginatedResponse,
  AuthTokens, AuthMeResponse, ConnectResult, ApiError, AddVehicleBody, AddVehicleResult,
  ApiKeyRecord, CreateApiKeyBody, CreateApiKeyResult, ApiCatalog, RawTelemetryResponse,
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

  async getApiCatalog(): Promise<ApiCatalog> {
    return this.request('GET', '/v1/api/catalog');
  }

  // ── Battery ───────────────────────────────────────────────────────────────

  async getSoc(vehicleId: string, from: string, to: string) {
    return this.request<{ ts: string; soc: number }[]>('GET', '/v1/battery/soc', undefined, {
      vehicle_id: vehicleId, from, to,
    });
  }

  async getRange(vehicleId: string, from: string, to: string) {
    return this.request<{ ts: string; range_mi: number }[]>('GET', '/v1/battery/range', undefined, {
      vehicle_id: vehicleId, from, to,
    });
  }

  async getPhantomDrain(vehicleId: string, from: string, to: string) {
    return this.request<{ date: string; drain_pct: number }[]>(
      'GET', '/v1/battery/phantom-drain', undefined, { vehicle_id: vehicleId, from, to }
    );
  }

  async getDegradation(vehicleId: string) {
    return this.request<{ ts: string; usable_kwh: number; rated_kwh: number | null; capacity_pct: number }[]>(
      'GET', '/v1/battery/degradation', undefined, { vehicle_id: vehicleId }
    );
  }

  // ── Trips ─────────────────────────────────────────────────────────────────

  async listTrips(vehicleId: string, from: string, to: string, page = 1, perPage = 25) {
    const offset = (page - 1) * perPage;
    const response = await this.request<PaginatedResponse<Trip> & { data?: Trip[]; limit?: number; offset?: number }>('GET', '/v1/trips', undefined, {
      vehicle_id: vehicleId, from, to, page, per_page: perPage, limit: perPage, offset,
    });
    return normalizePaginated(response, page, perPage);
  }

  async getTrip(tripId: string, vehicleId: string) {
    return this.request<Trip>('GET', `/v1/trips/${tripId}`, undefined, { vehicle_id: vehicleId });
  }

  async getTripTrack(tripId: string, vehicleId: string) {
    return this.request<TrackPoint[]>('GET', `/v1/trips/${tripId}/track`, undefined, { vehicle_id: vehicleId });
  }

  async getSpeedProfile(tripId: string, vehicleId: string) {
    return this.request<{ elapsed_s: number; speed_mph: number }[]>(
      'GET', `/v1/trips/${tripId}/speed`, undefined, { vehicle_id: vehicleId }
    );
  }

  async getElevationProfile(tripId: string, vehicleId: string) {
    return this.request<{ ts: string; value: number | null }[]>(
      'GET', `/v1/trips/${tripId}/elevation`, undefined, { vehicle_id: vehicleId }
    );
  }

  // ── Charging ──────────────────────────────────────────────────────────────

  async listChargeSessions(vehicleId: string, from: string, to: string, page = 1, perPage = 25) {
    const offset = (page - 1) * perPage;
    const response = await this.request<PaginatedResponse<ChargeSession> & { data?: ChargeSession[]; limit?: number; offset?: number }>('GET', '/v1/charging', undefined, {
      vehicle_id: vehicleId, from, to, page, per_page: perPage, limit: perPage, offset,
    });
    return normalizePaginated(response, page, perPage);
  }

  async getChargeSession(sessionId: string, vehicleId: string) {
    return this.request<ChargeSession>('GET', `/v1/charging/${sessionId}`, undefined, { vehicle_id: vehicleId });
  }

  async getChargeCurve(sessionId: string, vehicleId: string) {
    return this.request<ChargeCurvePoint[]>(
      'GET', `/v1/charging/${sessionId}/curve`, undefined, { vehicle_id: vehicleId }
    );
  }

  async getChargingSummary(vehicleId: string, from: string, to: string) {
    const summary = await this.request<{
      total_energy_kwh?: number;
      total_kwh?: number;
      total_cost_usd?: number;
      session_count?: number;
      weekly?: Array<{ week_start: string; kwh?: number; energy_kwh?: number; sessions: number }>;
    }>('GET', '/v1/charging/summary', undefined, {
      vehicle_id: vehicleId, from, to,
    });
    return {
      total_energy_kwh: summary.total_energy_kwh ?? summary.total_kwh ?? 0,
      total_cost_usd: summary.total_cost_usd ?? 0,
      session_count: summary.session_count ?? 0,
      weekly: (summary.weekly ?? []).map((week) => ({
        week_start: week.week_start,
        energy_kwh: week.energy_kwh ?? week.kwh ?? 0,
        sessions: week.sessions,
      })),
    } satisfies ChargingSummary;
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

  async getRawTelemetry(vehicleId: string, limit = 25) {
    return this.request<RawTelemetryResponse>('GET', `/v1/vehicles/${vehicleId}/raw-data`, undefined, { limit });
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

function formatApiError(detail: ApiFailureDetail) {
  return `${detail.status} ${detail.code}: ${truncate(detail.message, 160)}`;
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}
