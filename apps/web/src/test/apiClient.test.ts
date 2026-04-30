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
});
