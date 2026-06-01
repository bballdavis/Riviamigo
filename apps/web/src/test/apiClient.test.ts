import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@riviamigo/hooks';

describe('api client dashboard contracts', () => {
  beforeEach(() => {
    api.setToken('test-token');
    vi.restoreAllMocks();
  });

  it('calls the backend charging route that actually exists and normalizes pagination', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        data: [{ id: 'charge-1', started_at: '2026-04-29T12:00:00Z', energy_added_kwh: 12 }],
        total: 1,
        limit: 25,
        offset: 0,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    const result = await api.listChargeSessions('vehicle-1', '2026-04-01T00:00:00Z', '2026-04-29T23:59:59Z');

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/charging?');
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('/v1/charging/sessions');
    expect(result.items).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.per_page).toBe(25);
  });

  it('normalizes null-free efficiency summary values for widgets', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        avg_wh_per_mi: 0,
        p10_wh_per_mi: 0,
        p90_wh_per_mi: 0,
        total_miles: 0,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    const result = await api.getEfficiencySummary('vehicle-1', '2026-04-01T00:00:00Z', '2026-04-29T23:59:59Z');

    expect(result).toEqual({ avg: 0, p10: 0, p90: 0, total_miles: 0 });
  });

  it('reads raw telemetry diagnostics for the settings data viewer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        vehicle_id: 'vehicle-1',
        coverage: {
          first_event_at: null,
          last_event_at: null,
          sample_count: 0,
          odometer_samples: 0,
          battery_samples: 0,
          range_samples: 0,
          outside_temp_samples: 0,
          power_samples: 0,
          regen_samples: 0,
          tire_pressure_samples: 0,
        },
        samples: [],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    const result = await api.getRawTelemetry('vehicle-1', 10);

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/vehicles/vehicle-1/raw-data?limit=10');
    expect(result.coverage.sample_count).toBe(0);
  });

  it('uses the admin backup routes exposed by the settings page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        settings: {
          enabled: false,
          frequency: 'weekly',
          run_at: '03:00',
          timezone: 'UTC',
          day_of_week: 0,
          day_of_month: null,
          retention_count: 8,
          target_type: 's3',
          endpoint: '',
          region: null,
          bucket: '',
          prefix: 'riviamigo',
          access_key: null,
          has_secret_key: false,
          updated_at: null,
        },
        recent_runs: [],
        recent_runs_total: 0,
        recent_runs_page: 1,
        recent_runs_per_page: 10,
        artifacts: [],
        restore_requests: [],
        latest_successful_run: null,
        next_run_at: null,
        runtime_readiness: {
          pg_dump_available: true,
          run_now_allowed: true,
          reason: null,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    await api.getBackupOverview({ page: 2, perPage: 10 });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/admin/backups?page=2&per_page=10');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }) as Response);

    await api.updateBackupSettings({
      enabled: true,
      frequency: 'weekly',
      run_at: '03:00',
      timezone: 'UTC',
      day_of_week: 0,
      day_of_month: null,
      retention_count: 8,
      target_type: 's3',
      endpoint: '',
      region: null,
      bucket: 'riviamigo-backups',
      prefix: 'riviamigo',
      access_key: null,
    });

    expect(fetchMock.mock.calls[1]?.[0]).toContain('/v1/admin/backups/settings');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT' });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      run: { id: 'run-1' },
      artifact: { id: 'artifact-1' },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }) as Response);

    await api.runBackupNow();

    expect(fetchMock.mock.calls[2]?.[0]).toContain('/v1/admin/backups/run');
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'POST' });

    fetchMock.mockResolvedValueOnce(new Response(new Blob(['backup-data'], { type: 'application/octet-stream' }), {
      status: 200,
      headers: {
        'Content-Disposition': 'attachment; filename="backup-20260504T120000Z.dump"',
      },
    }) as Response);

    const download = await api.downloadBackupArtifact('artifact-1');
    expect(download.fileName).toBe('backup-20260504T120000Z.dump');
    expect(fetchMock.mock.calls[3]?.[0]).toContain('/v1/admin/backups/artifacts/artifact-1/download');
  });

  it('preserves login 401 responses instead of rewriting them as auth-expired', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    await expect(api.login('driver@example.com', 'wrong-password')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/auth/login');
  });

  it('coalesces simultaneous automatic refreshes behind one refresh request', async () => {
    api.setToken('expired-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/v1/auth/refresh')) {
        return new Response(JSON.stringify({
          access_token: 'fresh-token',
          expires_in: 900,
          default_vehicle_id: 'vehicle-1',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }) as Response;
      }

      const auth = init?.headers as Record<string, string> | undefined;
      if (auth?.Authorization === 'Bearer fresh-token') {
        return new Response(JSON.stringify({
          vehicle_id: 'vehicle-1',
          battery_level: 81,
          range_miles: 251,
          power_state: null,
          charger_state: null,
          speed_mph: 0,
          latitude: null,
          longitude: null,
          is_online: true,
          last_updated: '2026-04-29T00:00:00Z',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }) as Response;
      }

      return new Response(JSON.stringify({
        error: { code: 'unauthorized', message: 'expired' },
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }) as Response;
    });

    await Promise.all([
      api.vehicleStatus('vehicle-1'),
      api.vehicleStatus('vehicle-1'),
    ]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('reports a failed shared refresh once for a burst of 401s', async () => {
    api.setToken('expired-token');
    const authExpired = vi.fn();
    window.addEventListener('riviamigo:auth-expired', authExpired);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        error: { code: 'unauthorized', message: 'expired' },
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    await expect(Promise.all([
      api.vehicleStatus('vehicle-1'),
      api.vehicleStatus('vehicle-1'),
    ])).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_EXPIRED',
    });

    expect(authExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener('riviamigo:auth-expired', authExpired);
  });
});
