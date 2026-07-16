import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, useAuth } from '@riviamigo/hooks';

describe('api.vehicleStatus', () => {
  beforeEach(() => {
    api.setToken(null);
    useAuth.setState({
      accessToken: null,
      userId: null,
      defaultVehicleId: null,
      activeVehicleId: null,
      isAuthenticated: false,
    });
    vi.restoreAllMocks();
  });

  it('requests the path-based vehicle status endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        vehicle_id: 'vehicle-123',
        battery_level: 80,
        range_miles: 250,
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
      }) as Response
    );

    await api.vehicleStatus('vehicle-123');

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/vehicles/vehicle-123/status');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'include',
    });
  });

  it('updates the auth store when an automatic refresh succeeds', async () => {
    api.setToken('expired-token');
    useAuth.setState({
      accessToken: 'expired-token',
      userId: null,
      defaultVehicleId: 'old-vehicle',
      activeVehicleId: 'selected-vehicle',
      isAuthenticated: true,
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'unauthorized', message: 'expired' },
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }) as Response)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'fresh-token',
        expires_in: 900,
        default_vehicle_id: 'new-vehicle',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        vehicle_id: 'vehicle-123',
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
      }) as Response);

    await api.vehicleStatus('vehicle-123');

    expect(useAuth.getState()).toMatchObject({
      accessToken: 'fresh-token',
      defaultVehicleId: 'new-vehicle',
      activeVehicleId: 'selected-vehicle',
      isAuthenticated: true,
    });
  });
});
