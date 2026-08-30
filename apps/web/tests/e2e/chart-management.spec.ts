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
  await expect(page.getByRole('button', { name: 'sources' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'domain' })).toHaveCount(0);
  await page.getByRole('button', { name: 'curves' }).click();
  await expect(page.getByRole('combobox', { name: 'Timeframe', exact: true })).toHaveCount(0);
  await expect(page.getByText(/inherit the active dashboard timeframe/i)).toBeVisible();
  await page.getByText('Add curve', { exact: true }).click();
  const curveAvailabilityFilter = page.getByRole('button', { name: 'Showing available curves only' });
  await expect(curveAvailabilityFilter).toHaveAttribute('aria-pressed', 'true');
  await curveAvailabilityFilter.click();
  await expect(page.getByRole('button', { name: 'Showing all curves' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('textbox', { name: 'Search curves' }).fill('projected range');
  await expect(page.getByRole('button', { name: /Projected Range/ })).toBeVisible();
  await expect(page.getByText(/production chart renderer/)).toBeVisible();
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

test('bundled editor preview survives save and reload and matches the Overview production chart', async ({ page }) => {
  const apiState = await installMocks(page, { persistMutations: true });
  await page.setViewportSize({ width: 1536, height: 900 });
  await page.goto('/settings?section=charts');
  await page.getByRole('button', { name: 'Edit Battery Capacity by Mileage' }).click();
  await expect(page.getByRole('button', { name: 'Usable Capacity', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mileage', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'curves' }).click();
  await page.getByLabel('Color').first().selectOption('emerald');
  await expect(
    page.getByRole('button', { name: 'Usable Capacity', exact: true }).locator('span').first()
  ).toHaveCSS('background-color', 'rgb(16, 185, 129)');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/settings\?section=charts/);
  await expect.poll(() => apiState.createdCharts.length).toBe(1);
  expect(apiState.createdCharts[0]!.config).toEqual(
    expect.objectContaining({
      x: expect.objectContaining({ kind: 'time', field: expect.objectContaining({ field: 'timestamp' }) }),
      series: expect.arrayContaining([
        expect.objectContaining({ label: 'Usable Capacity' }),
        expect.objectContaining({ label: 'Mileage', yAxis: 'y2' }),
      ]),
    })
  );

  await page.getByRole('button', { name: 'Edit Battery Capacity by Mileage' }).click();
  await page.getByRole('button', { name: 'curves' }).click();
  await expect(page.getByLabel('Color').first()).toHaveValue('emerald');
  await expect(page.getByRole('button', { name: 'Usable Capacity', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mileage', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Usable Capacity', exact: true }).locator('span').first()
  ).toHaveCSS('background-color', 'rgb(16, 185, 129)');

  await page.goto('/');
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  await page.getByRole('option', { name: /Battery Capacity by Mileage/ }).click();
  await expect(page.getByRole('button', { name: 'Usable Capacity', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mileage', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Usable Capacity', exact: true }).locator('span').first()
  ).toHaveCSS('background-color', 'rgb(16, 185, 129)');
  await expect(page.locator('.uplot')).toHaveCount(1);
});

async function installMocks(page: Page, options: { persistMutations?: boolean } = {}) {
  const createdCharts: Array<{
    config: {
      placements: Array<{ dashboardSlug: string }>;
      x?: { kind?: string; field?: { field?: string } };
      series?: Array<{ label?: string; yAxis?: string }>;
    };
  }> = [];
  const chartSeeds = readJson<Array<{ slug: string; name: string; description: string; enabled: boolean; definition: unknown }>>('../../../../packages/dashboards/src/charts/defaults/defaults.json');
  const sourceManifests = readJson<unknown[]>('../../../../packages/dashboards/src/charts/sources/sources.json');
  const dashboards = ['dashboard', 'battery', 'charging', 'efficiency', 'trips'].map((slug) => readJson<Record<string, unknown>>(`../../../../packages/dashboards/src/defaults/${slug}.json`));
  let entries = chartSeeds.map((chart, index) => ({
    effective: { id: `chart-${index + 1}`, ownerId: null, slug: chart.slug, name: chart.name, description: chart.description, isDefault: true, isLocked: false, isEnabled: chart.enabled, baselineRevision: 5, config: chart.definition },
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
      const created = { ...body, id: 'personal-override', ownerId: 'e2e-user', isDefault: false, isLocked: false, baselineRevision: null };
      if (options.persistMutations) {
        const slug = (body as { slug?: string }).slug;
        entries = entries.map((entry) => entry.effective.slug === slug ? {
          ...entry, effective: created as typeof entry.effective, personalOverride: created,
          origin: 'override', permissions: { ...entry.permissions, reset: true, delete: true },
        } : entry);
      }
      return json(route, created);
    }
    if (path.startsWith('/v1/charts/') && route.request().method() === 'PUT') {
      const id = path.split('/').at(-1);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      let updated: unknown = body;
      entries = entries.map((entry) => {
        if (entry.effective.id !== id) return entry;
        updated = { ...entry.effective, ...body };
        return { ...entry, effective: updated as typeof entry.effective, personalOverride: updated, origin: 'override' };
      });
      return json(route, updated);
    }
    if (path === '/v1/charts/effective') {
      const placement = new URL(route.request().url()).searchParams.get('dashboard_slug');
      return json(route, entries.map((entry) => entry.effective).filter((chart) => chart.isEnabled && chart.config.placements.some((candidate) => candidate.dashboardSlug === placement)));
    }
    if (path === '/v1/charts') return json(route, entries);
    if (path === '/v1/chart-sources') return json(route, sourceManifests);
    if (path === '/v1/metrics/catalog') return json(route, { metrics: [
      { id: 'battery_level', label: 'Battery Level', unit: '%', kind: 'percent', source: 'telemetry', supports_series: true, default_aggregation: 'avg' },
      { id: 'energy_charged', label: 'Energy Charged', unit: 'kWh', kind: 'energy', source: 'summary', supports_series: true, default_aggregation: 'sum' },
    ] });
    if (path === '/v1/metrics/series') return json(route, []);
    if (path === '/v1/battery/mileage') return json(route, [
      { ts: '2026-08-01T00:00:00Z', odometer_mi: 18800, usable_kwh: 111.2, range_mi: 331, projected_max_range_mi: 334, degradation_pct: 2.1 },
      { ts: '2026-08-15T00:00:00Z', odometer_mi: 19000, usable_kwh: 111.5, range_mi: 329, projected_max_range_mi: 333, degradation_pct: 2.0 },
      { ts: '2026-08-29T00:00:00Z', odometer_mi: 19200, usable_kwh: 111.1, range_mi: 330, projected_max_range_mi: 332, degradation_pct: 2.2 },
    ]);
    if (path.endsWith('/status')) return json(route, {});
    if (path.endsWith('/images')) return json(route, { all: [] });
    return json(route, {});
  });
  return { createdCharts };
}

function readJson<T>(path: string): T { return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T; }
function authTokens() { return { access_token: 'test-access-token', expires_in: 3600, default_vehicle_id: 'vehicle-1' }; }
function testVehicle() { return { id: 'vehicle-1', user_id: 'e2e-user', rivian_vehicle_id: 'rivian-vehicle-1', vin: null, model: 'R1T', year: 2025, trim: 'Adventure', color: 'Forest Green', battery_capacity_kwh: 135, display_name: 'Test R1T', created_at: '2026-01-01T00:00:00Z', images: null, membership_role: 'owner' }; }
function unitPreferences() { return { mode: 'imperial', distance_unit: 'miles', speed_unit: 'mph', temperature_unit: 'fahrenheit', pressure_unit: 'psi', altitude_unit: 'feet', place_radius_unit: 'feet', efficiency_display: 'distance_per_energy' }; }
function json(route: Route, body: unknown) { return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }
