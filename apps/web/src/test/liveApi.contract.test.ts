import { describe, expect, it } from 'vitest';

const apiKey = import.meta.env.VITE_RIVIAMIGO_DEV_API_KEY as string | undefined;
const baseUrl = (import.meta.env.VITE_RIVIAMIGO_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

const runIfConfigured = apiKey ? describe : describe.skip;

async function liveGet(path: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  expect(response.status, `${path} returned ${response.status}: ${text}`).toBeLessThan(400);
  return body as any;
}

runIfConfigured('live API dashboard contract', () => {
  it('can exercise dashboard data endpoints through the dev API key', async () => {
    const vehicles = await liveGet('/v1/vehicles');
    const vehicle = vehicles.vehicles?.[0];

    expect(vehicle?.id, 'A connected local vehicle is required for the live contract test.').toBeTruthy();

    const vehicleId = vehicle.id;
    const from = '2026-04-01T00:00:00Z';
    const to = '2026-04-29T23:59:59Z';

    const [status, charging, efficiency, raw] = await Promise.all([
      liveGet(`/v1/vehicles/${vehicleId}/status`),
      liveGet(`/v1/charging?vehicle_id=${vehicleId}&from=${from}&to=${to}&page=1&per_page=5`),
      liveGet(`/v1/efficiency/summary?vehicle_id=${vehicleId}&from=${from}&to=${to}`),
      liveGet(`/v1/vehicles/${vehicleId}/raw-data?limit=5`),
    ]);

    expect(status.vehicle_id).toBe(vehicleId);
    expect(Array.isArray(charging.items ?? charging.data)).toBe(true);
    expect(typeof efficiency.p90_wh_per_mi).toBe('number');
    expect(Array.isArray(raw.samples)).toBe(true);
  });
});
