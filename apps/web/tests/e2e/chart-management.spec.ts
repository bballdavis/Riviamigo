import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('chart manager and editor remain usable at desktop and phone widths', async ({ page }) => {
  const apiState = await installMocks(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/settings?section=charts');

  await expect(page.getByText('Assigned dashboards', { exact: true }).first()).toBeVisible();
  const enabled = page.getByRole('switch', { name: /Disable Battery Capacity by Mileage/ });
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  expect((await enabled.boundingBox())?.width).toBeLessThanOrEqual(44);

  const assignmentTrigger = page.getByRole('button', { name: 'Edit dashboard assignments for Battery Capacity by Mileage' });
  await assignmentTrigger.click();
  const desktopDialog = page.getByRole('dialog', { name: 'Assigned dashboards' });
  await expect(desktopDialog).toBeVisible();
  expect((await desktopDialog.boundingBox())?.width).toBeLessThan(1280);
  await expect(desktopDialog).toHaveCSS('background-color', /rgb/);
  await page.keyboard.press('Escape');
  await expect(assignmentTrigger).toBeFocused();

  await assignmentTrigger.click();
  await page.getByRole('checkbox').filter({ hasText: 'Battery' }).click();
  await page.getByRole('button', { name: 'Save assignments' }).click();
  await expect.poll(() => apiState.createdCharts.length).toBe(1);
  expect(apiState.createdCharts[0]?.config.placements).not.toContainEqual({ dashboardSlug: 'battery' });

  await page.getByRole('button', { name: 'Edit Battery Capacity by Mileage' }).click();
  await expect(page).toHaveURL(/\/settings\/charts\/chart-1$/);
  const previewTitle = page.getByText('Live preview', { exact: true });
  const basicsTitle = page.getByText('Basics', { exact: true }).last();
  const [previewBox, basicsBox] = await Promise.all([previewTitle.boundingBox(), basicsTitle.boundingBox()]);
  expect(previewBox!.x).toBeLessThan(basicsBox!.x);
  await page.getByRole('button', { name: 'display' }).click();
  await expect(page.getByText('Axis labels', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Right Y axis' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings?section=charts');
  const mobileTrigger = page.getByRole('button', { name: 'Edit dashboard assignments for Battery Capacity by Mileage' });
  await mobileTrigger.scrollIntoViewIfNeeded();
  await mobileTrigger.click();
  const mobileDialog = page.getByRole('dialog', { name: 'Assigned dashboards' });
  expect(await mobileDialog.boundingBox()).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Edit Battery Capacity by Mileage' }).click();
  const mobilePreview = await page.getByText('Live preview', { exact: true }).boundingBox();
  const mobileBasics = await page.getByText('Basics', { exact: true }).last().boundingBox();
  expect(mobilePreview!.y).toBeLessThan(mobileBasics!.y);
  await expect(page.getByRole('button', { name: 'Back to charts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
});

async function installMocks(page: Page) {
  const createdCharts: Array<{ config: { placements: Array<{ dashboardSlug: string }> } }> = [];
  const chartSeeds = readJson<Array<{ slug: string; name: string; description: string; enabled: boolean; definition: unknown }>>('../../../../packages/dashboards/src/charts/defaults/defaults.json');
  const sourceManifests = readJson<unknown[]>('../../../../packages/dashboards/src/charts/sources/sources.json');
  const dashboards = ['dashboard', 'battery', 'charging', 'efficiency', 'trips'].map((slug) => readJson<Record<string, unknown>>(`../../../../packages/dashboards/src/defaults/${slug}.json`));
  const entries = chartSeeds.map((chart, index) => ({
    effective: { id: `chart-${index + 1}`, ownerId: null, slug: chart.slug, name: chart.name, description: chart.description, isDefault: true, isLocked: false, isEnabled: chart.enabled, baselineRevision: 2, config: chart.definition },
    origin: 'system',
    permissions: { read: true, edit: true, duplicate: true, reset: false, restore: false, delete: false, lock: false },
  }));

  await page.routeWebSocket('**/v1/vehicles/live**', (socket) => socket.close());
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/auth/bootstrap') return json(route, authTokens());
    if (path === '/v1/auth/me') return json(route, { user_id: 'e2e-user', email: 'editor@riviamigo.test', role: 'user', default_vehicle_id: 'vehicle-1' });
    if (path === '/v1/auth/preferences') return json(route, { units: unitPreferences() });
    if (path === '/v1/vehicles') return json(route, { vehicles: [testVehicle()] });
    if (path === '/v1/dashboards') return json(route, dashboards);
    if (path === '/v1/charts' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { config: { placements: Array<{ dashboardSlug: string }> } };
      createdCharts.push(body);
      return json(route, { ...body, id: 'personal-override', ownerId: 'e2e-user', isDefault: false, isLocked: false });
    }
    if (path === '/v1/charts') return json(route, entries);
    if (path === '/v1/chart-sources') return json(route, sourceManifests);
    if (path === '/v1/metrics/catalog') return json(route, { metrics: [
      { id: 'battery_level', label: 'Battery Level', unit: '%', kind: 'percent', source: 'telemetry', supports_series: true, default_aggregation: 'avg' },
      { id: 'energy_charged', label: 'Energy Charged', unit: 'kWh', kind: 'energy', source: 'summary', supports_series: true, default_aggregation: 'sum' },
    ] });
    if (path === '/v1/metrics/series') return json(route, []);
    if (path.endsWith('/status')) return json(route, {});
    if (path.endsWith('/images')) return json(route, { all: [] });
    return json(route, {});
  });
  return { createdCharts };
}

function readJson<T>(path: string): T { return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T; }
function authTokens() { return { access_token: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJlMmUtdXNlciJ9.', expires_in: 3600, default_vehicle_id: 'vehicle-1' }; }
function testVehicle() { return { id: 'vehicle-1', user_id: 'e2e-user', rivian_vehicle_id: 'rivian-vehicle-1', vin: null, model: 'R1T', year: 2025, trim: 'Adventure', color: 'Forest Green', battery_capacity_kwh: 135, display_name: 'Test R1T', created_at: '2026-01-01T00:00:00Z', images: null, membership_role: 'owner' }; }
function unitPreferences() { return { mode: 'imperial', distance_unit: 'miles', speed_unit: 'mph', temperature_unit: 'fahrenheit', pressure_unit: 'psi', altitude_unit: 'feet', place_radius_unit: 'feet', efficiency_display: 'distance_per_energy' }; }
function json(route: Route, body: unknown) { return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }
