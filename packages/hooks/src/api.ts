/**
 * Thin typed wrapper around the Riviamigo REST API.
 * Base URL is read from the VITE_API_URL env var (or defaults to /api).
 */

import type {
  Vehicle, VehicleStatus, Trip, TrackPoint, ChargeSession, ChargeCurvePoint,
  StatsSummary, EfficiencyByMode, ChargingSummary, PaginatedResponse,
  AuthTokens, ConnectResult, ApiError,
} from '@riviamigo/types';

const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL) || '';

class ApiClient {
  private accessToken: string | null = null;

  setToken(token: string | null) {
    this.accessToken = token;
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
    retryOnUnauthorized = true
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
        const tokens = await this.request<AuthTokens>('POST', '/v1/auth/refresh', undefined, undefined, false);
        this.setToken(tokens.access_token);
        return this.request<T>(method, path, body, params, false);
      }

      const body = await res.json().catch(() => null);
      const err: ApiError = body?.error ?? { code: 'unknown', message: res.statusText };
      throw Object.assign(new Error(err.message), { status: res.status, code: err.code });
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

  async me(): Promise<{ id: string; email: string }> {
    return this.request('GET', '/v1/auth/me');
  }

  // ── Vehicles ──────────────────────────────────────────────────────────────

  async listVehicles(): Promise<Vehicle[]> {
    const res = await this.request<{ vehicles: Vehicle[] }>('GET', '/v1/vehicles');
    return res.vehicles ?? [];
  }

  async vehicleStatus(vehicleId: string): Promise<VehicleStatus> {
    return this.request('GET', '/v1/vehicles/status', undefined, { vehicle_id: vehicleId });
  }

  async connectRivian(email: string, password: string): Promise<ConnectResult> {
    return this.request('POST', '/v1/vehicles/connect', { email, password });
  }

  async connectRivianOtp(challengeId: string, otp: string): Promise<ConnectResult> {
    return this.request('POST', '/v1/vehicles/connect/otp', { challenge_id: challengeId, otp_code: otp });
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
    return this.request<PaginatedResponse<Trip>>('GET', '/v1/trips', undefined, {
      vehicle_id: vehicleId, from, to, page, per_page: perPage,
    });
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
    return this.request<PaginatedResponse<ChargeSession>>('GET', '/v1/charging', undefined, {
      vehicle_id: vehicleId, from, to, page, per_page: perPage,
    });
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
    return this.request<ChargingSummary>('GET', '/v1/charging/summary', undefined, {
      vehicle_id: vehicleId, from, to,
    });
  }

  // ── Efficiency ────────────────────────────────────────────────────────────

  async getEfficiencySummary(vehicleId: string, from: string, to: string) {
    return this.request<{ avg: number; p10: number; p90: number }>(
      'GET', '/v1/efficiency/summary', undefined, { vehicle_id: vehicleId, from, to }
    );
  }

  async getEfficiencyByMode(vehicleId: string, from: string, to: string) {
    return this.request<EfficiencyByMode[]>('GET', '/v1/efficiency/by-mode', undefined, {
      vehicle_id: vehicleId, from, to,
    });
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
    return this.request<StatsSummary>('GET', '/v1/stats', undefined, { vehicle_id: vehicleId });
  }
}

export const api = new ApiClient();
