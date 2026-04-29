import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@riviamigo/hooks';
describe('api.vehicleStatus', () => {
    beforeEach(() => {
        api.setToken(null);
        vi.restoreAllMocks();
    });
    it('requests the path-based vehicle status endpoint', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
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
        }));
        await api.vehicleStatus('vehicle-123');
        expect(fetchMock).toHaveBeenCalledWith('/v1/vehicles/vehicle-123/status', expect.objectContaining({
            method: 'GET',
            credentials: 'include',
        }));
    });
});
