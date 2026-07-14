import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@riviamigo/hooks';

describe('api client dashboard contracts', () => {
  beforeEach(() => {
    api.setToken('test-token');
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it('treats zero-coordinate trip and charge locations as missing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: 'charge-1',
        vehicle_id: 'vehicle-1',
        started_at: '2026-06-08T21:30:00Z',
        ended_at: '2026-06-09T03:00:00Z',
        location_lat: 0,
        location_lng: 0,
        location_name: '0.0000, 0.0000',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    ).mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: 'trip-1',
        vehicle_id: 'vehicle-1',
        started_at: '2026-06-09T12:00:00Z',
        ended_at: '2026-06-09T13:00:00Z',
        distance_mi: 12,
        duration_min: 60,
        start_lat: 0,
        start_lng: 0,
        end_lat: 0,
        end_lng: 0,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    const charge = await api.getChargeSession('charge-1', 'vehicle-1');
    const trip = await api.getTrip('trip-1', 'vehicle-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(charge.location_name).toBeNull();
    expect(charge.location_name).not.toBe('0.0000, 0.0000');
    expect(charge.ended_at).toBe('2026-06-09T03:00:00Z');
    expect(trip.start_lat).toBeNull();
    expect(trip.start_lng).toBeNull();
    expect(trip.end_lat).toBeNull();
    expect(trip.end_lng).toBeNull();
  });

  it('preserves trip place and address labels while normalizing coordinates', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: 'trip-2',
        vehicle_id: 'vehicle-1',
        started_at: '2026-06-16T22:45:00Z',
        ended_at: '2026-06-16T23:05:00Z',
        distance_miles: 12,
        duration_seconds: 1200,
        efficiency_wh_per_mile: 320,
        start_lat: 29.81831,
        start_lng: -95.38817,
        end_lat: 29.84793,
        end_lng: -95.50235,
        start_place: 'Home - Test',
        start_address: 'North Main Street, Houston, TX 77009',
        end_place_name: 'Aurora Street, Houston',
        end_address: 'Aurora Street, Houston, TX 77058',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    const trip = await api.getTrip('trip-2', 'vehicle-1');

    expect(trip.start_place).toBe('Home - Test');
    expect(trip.start_address).toBe('North Main Street, Houston, TX 77009');
    expect(trip.end_place).toBe('Aurora Street, Houston');
    expect(trip.end_address).toBe('Aurora Street, Houston, TX 77058');
    expect(trip.start_lat).toBe(29.81831);
    expect(trip.end_lng).toBe(-95.50235);
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

  it('sends unsaved external connection settings to the synthetic test route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        tested_at: '2026-07-14T12:00:00Z',
        checks: [{ label: 'Synthetic request', ok: true, message: 'ok' }],
        preview_data_url: null,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );
    const draft = {
      enabled: true,
      mode: 'custom' as const,
      forecast_url: 'https://weather.example/v1/forecast',
      archive_url: 'https://weather.example/v1/archive',
      weather_precision: 'approximate' as const,
    };

    const result = await api.testExternalConnection('open_meteo', draft);

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/settings/external-connections/open_meteo/test');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify(draft) }));
    expect(result.checks).toEqual([{ label: 'Synthetic request', ok: true, message: 'ok' }]);
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

  it('writes shared vehicle settings through the consolidated vehicle settings route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    await api.updateVehicleSettings('vehicle-1', {
      battery_capacity_kwh: 135,
      battery_config: 'R1T / R1S Large (Gen 1)',
      target_tire_pressure_psi: 48,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/vehicles/vehicle-1/settings');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT' });
  });

  it('requests an administrator artwork refresh through the first-party vehicle route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, vehicle_id: 'vehicle-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    await api.refreshVehicleArtwork('vehicle-1');

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/admin/vehicles/vehicle-1/images/remirror');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('purges only the local vehicle artwork cache through the first-party vehicle route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, vehicle_id: 'vehicle-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    await api.purgeVehicleArtworkCache('vehicle-1');

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/admin/vehicles/vehicle-1/images/cache/purge');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('loads protected artwork with the existing bearer session rather than a cookie or URL token', async () => {
    api.setToken('session-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<svg />', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } }) as Response,
    );

    await api.authenticatedAsset('/v1/vehicle-image-cache/vehicle-1/artwork.webp');

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/vehicle-image-cache/vehicle-1/artwork.webp');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    });
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

  it('quietly treats bootstrap without a resumable session as no auth state', async () => {
    const authExpired = vi.fn();
    const toast = vi.fn();
    window.addEventListener('riviamigo:auth-expired', authExpired);
    window.addEventListener('riviamigo:toast', toast as EventListener);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }) as Response,
    );

    await expect(api.resumeSession()).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/auth/bootstrap');
    expect(authExpired).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();

    window.removeEventListener('riviamigo:auth-expired', authExpired);
    window.removeEventListener('riviamigo:toast', toast as EventListener);
  });

  it('returns tokens from a successful bootstrap session resume', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        access_token: 'fresh-token',
        expires_in: 900,
        default_vehicle_id: 'vehicle-1',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    await expect(api.resumeSession()).resolves.toMatchObject({
      access_token: 'fresh-token',
      default_vehicle_id: 'vehicle-1',
    });
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

  it('routes backup downloads through the shared auth-expired flow', async () => {
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

    await expect(api.downloadBackupArtifact('artifact-1')).rejects.toMatchObject({
      status: 401,
      code: 'AUTH_EXPIRED',
    });

    expect(authExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener('riviamigo:auth-expired', authExpired);
  });

  it('emits distinct toast messages for nginx vs api 429 responses', async () => {
    const toast = vi.fn();
    window.addEventListener('riviamigo:toast', toast as EventListener);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' },
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'x-riviamigo-ratelimit-source': 'nginx',
          'retry-after': '2',
        },
      }) as Response,
    );
    await expect(api.vehicleStatus('vehicle-1')).rejects.toMatchObject({ status: 429 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' },
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'x-riviamigo-ratelimit-source': 'api',
          'x-riviamigo-ratelimit-class': 'auth_metadata',
          'retry-after': '2',
        },
      }) as Response,
    );
    await expect(api.me()).rejects.toMatchObject({ status: 429 });

    const details = toast.mock.calls
      .map(([event]) => (event as CustomEvent).detail?.message)
      .filter((message): message is string => typeof message === 'string');

    expect(details.some((message) => message.includes('Edge proxy rate limit reached'))).toBe(true);
    expect(details.some((message) => message.includes('API rate limit reached'))).toBe(true);

    window.removeEventListener('riviamigo:toast', toast as EventListener);
  });

  it('backs off repeated requests against the same exhausted limiter bucket', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' },
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'x-riviamigo-ratelimit-source': 'api',
          'x-riviamigo-ratelimit-class': 'auth_write',
          'retry-after': '2',
        },
      }) as Response,
    );

    await expect(api.updateVehicleSettings('vehicle-1', { target_tire_pressure_psi: 48 })).rejects.toMatchObject({ status: 429 });
    await expect(api.updateVehicleSettings('vehicle-1', { target_tire_pressure_psi: 48 })).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2100);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    await api.updateVehicleSettings('vehicle-1', { target_tire_pressure_psi: 48 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
