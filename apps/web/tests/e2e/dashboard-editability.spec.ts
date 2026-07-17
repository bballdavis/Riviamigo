import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_DASHBOARD_VISIBILITY_STATE,
  isWidgetVisible,
  type DashboardConfig,
} from '@riviamigo/dashboards';

const dashboard = loadDashboard('dashboard');
const battery = loadDashboard('battery');
const charging = loadDashboard('charging');
const efficiency = loadDashboard('efficiency');
const trips = loadDashboard('trips');
const customDashboard: DashboardConfig = {
  ...dashboard,
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'custom-dashboard',
  name: 'Custom Dashboard',
  isDefault: false,
  isLocked: false,
  ownerId: '22222222-2222-2222-2222-222222222222',
  widgets: [
    {
      id: '33333333-3333-3333-3333-333333333333',
      componentType: 'sensor',
      definitionId: 'total_miles',
      title: 'Custom miles',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      options: {},
    },
  ],
};

const dashboards = new Map<string, DashboardConfig>([
  ['dashboard', dashboard],
  ['battery', battery],
  ['charging', charging],
  ['efficiency', efficiency],
  ['trips', trips],
  ['custom-dashboard', customDashboard],
]);

const routeCases = [
  { path: '/', slug: 'dashboard', widgetId: 'd1000001-0000-0000-0000-000000000002' },
  { path: '/battery', slug: 'battery', widgetId: 'd2000002-0000-0000-0000-000000000001' },
  { path: '/charging', slug: 'charging', widgetId: 'd4000004-0000-0000-0000-000000000001' },
  { path: '/efficiency', slug: 'efficiency', widgetId: 'd3000003-0000-0000-0000-000000000001' },
  { path: '/trips', slug: 'trips', widgetId: 'd5000005-0000-0000-0000-000000000005' },
  { path: '/d/custom-dashboard', slug: 'custom-dashboard', widgetId: '33333333-3333-3333-3333-333333333333' },
] as const;

const EDIT_CONTROL_GEOMETRY = {
  position: 'absolute',
  top: '8px',
  right: '8px',
  zIndex: '200',
  pointerEvents: 'auto',
  anchored: true,
  hit: true,
};

test.describe('dashboard editability in a browser', () => {
  test('renders the R1T fallback overview with tailgate and side-bin cover states', async ({ page }) => {
    await page.setViewportSize({ width: 1240, height: 760 });
    await installApiMocks(page, {
      vehicleStatus: {
        vehicle_id: 'vehicle-1',
        battery_level: 78,
        range_miles: 248,
        battery_limit: 85,
        door_rear_left_locked: true,
        door_front_left_locked: true,
        door_rear_right_locked: true,
        door_front_right_locked: true,
        closure_tailgate_locked: true,
        closure_liftgate_locked: false,
        closure_frunk_locked: true,
        side_bin_left_locked: false,
        side_bin_right_locked: true,
        side_bin_left_closed: true,
        side_bin_right_closed: false,
      },
    });
    await page.goto('/');

    const fallbackArtwork = page.locator('img[src="/vehicle-images/fallbacks/r1t/overview.webp"]').first();
    await expect(fallbackArtwork).toBeVisible();
    await expect(fallbackArtwork).toHaveAttribute('data-artwork-fallback', 'true');
    const fallbackTransform = await fallbackArtwork.evaluate((image) => image.style.transform);
    expect(fallbackTransform).toContain('translate(-50%, -50%) rotate(90deg) scaleX(');
    expect(Number(fallbackTransform.match(/scaleX\(([^)]+)\)/)?.[1])).toBeCloseTo(509 / 446);

    await expect(page.getByTitle('Tailgate lock')).toHaveClass(/left-\[4%\]/);
    await expect(page.getByTitle('Left side bin cover: closed')).toHaveClass(/left-\[36%\]/);
    await expect(page.getByTitle('Left side bin cover: closed')).toHaveClass(/top-\[24%\]/);
    await expect(page.getByTitle('Left side bin cover: closed')).toHaveClass(/text-status-positive/);
    await expect(page.getByTitle('Right side bin cover: open')).toHaveClass(/left-\[36%\]/);
    await expect(page.getByTitle('Right side bin cover: open')).toHaveClass(/top-\[76%\]/);
    await expect(page.getByTitle('Right side bin cover: open')).toHaveClass(/text-accent/);
    await expect(page.getByTitle('Tonneau lock')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const leftCover = page.getByTitle('Left side bin cover: closed');
    const rightCover = page.getByTitle('Right side bin cover: open');
    await leftCover.scrollIntoViewIfNeeded();
    await expect(leftCover).toBeVisible();
    await expect(rightCover).toBeVisible();
    const [leftBox, rightBox] = await Promise.all([leftCover.boundingBox(), rightCover.boundingBox()]);
    expect(leftBox?.width).toBeGreaterThanOrEqual(24);
    expect(rightBox?.width).toBeGreaterThanOrEqual(24);
  });

  for (const routeCase of routeCases) {
    test(`${routeCase.slug} exposes visible, hit-testable widget editing`, async ({ page }) => {
      await installApiMocks(page);
      await page.goto(routeCase.path);

      await expect(page.getByRole('button', { name: 'Edit dashboard' })).toBeVisible();
      await expect(page.locator('[data-widget-edit-control="true"]')).toHaveCount(0);

      await page.getByRole('button', { name: 'Edit dashboard' }).click();
      await expect(page.locator('.rgl-editor')).toBeVisible();

      const config = dashboards.get(routeCase.slug)!;
      const visibleWidgets = config.widgets.filter((widget) => isWidgetVisible(widget, DEFAULT_DASHBOARD_VISIBILITY_STATE));
      await expect(page.locator('[data-widget-frame="edit"]')).toHaveCount(visibleWidgets.length);
      const editControls = page.locator('[data-widget-edit-control="true"]');
      await expect(editControls).toHaveCount(visibleWidgets.length);

      for (let index = 0; index < visibleWidgets.length; index += 1) {
        const button = editControls.nth(index).getByRole('button', { name: 'Edit widget settings' });
        await button.scrollIntoViewIfNeeded();
        await expectEditControl(button);
      }

      const frame = page.locator(`[data-widget-id="${routeCase.widgetId}"]`);
      const editControl = frame.locator('[data-widget-edit-control="true"]');
      const editButton = editControl.getByRole('button', { name: 'Edit widget settings' });
      await editButton.scrollIntoViewIfNeeded();

      await expect(frame).toHaveAttribute('data-widget-resizable', 'true');
      await expect(editControl).toBeVisible();
      await expect(editButton).toBeVisible();
      await expect(frame.locator('.react-resizable-handle-se')).toBeVisible();
      await expectEditControl(editButton);

      await editButton.click();
      await expect(page.getByText('Editing', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Remove component' })).toBeVisible();
      await expect(frame).toHaveAttribute('data-editing', 'true');
    });
  }

  test('fixed-size widgets keep edit and move controls but never expose a resize handle', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/charging');
    await page.getByRole('button', { name: 'Edit dashboard' }).click();
    await page.getByRole('button', { name: 'Plugged in' }).click();

    const frame = page.locator('[data-widget-id="d4000004-0000-0000-0000-000000000013"]');
    await expect(frame).toHaveAttribute('data-fixed-size', 'true');
    await expect(frame).toHaveAttribute('data-widget-resizable', 'false');
    await expect(frame.getByLabel('Fixed-size widget')).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Drag to move' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Edit widget settings' })).toBeVisible();
    await expect(frame.locator('.react-resizable-handle')).toHaveCount(0);
  });

  test('resizing a non-Overview widget changes the draft and saves a user-owned copy', async ({ page }) => {
    const apiState = await installApiMocks(page);
    await page.goto('/battery');
    await page.getByRole('button', { name: 'Edit dashboard' }).click();

    const widgetId = 'd2000002-0000-0000-0000-000000000001';
    const frame = page.locator(`[data-widget-id="${widgetId}"]`);
    const handle = frame.locator('.react-resizable-handle-se');
    await handle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(350);

    const before = await frame.boundingBox();
    const handleBox = await handle.boundingBox();
    expect(before).not.toBeNull();
    expect(handleBox).not.toBeNull();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 130, startY + 90, { steps: 8 });
    await page.mouse.up();

    const after = await frame.boundingBox();
    expect(after).not.toBeNull();
    expect(after!.width).toBeGreaterThan(before!.width);
    expect(after!.height).toBeGreaterThan(before!.height);
    await expect(page.getByText('Unsaved', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Save dashboard changes' }).click();
    await expect(page.locator('.rgl-editor')).toHaveCount(0);
    expect(apiState.createdDashboards).toHaveLength(1);

    const saved = apiState.createdDashboards[0]!.config as DashboardConfig;
    const savedWidget = saved.widgets.find((widget) => widget.id === widgetId)!;
    const originalWidget = battery.widgets.find((widget) => widget.id === widgetId)!;
    expect(saved.isDefault).toBe(false);
    expect(saved.isLocked).toBe(false);
    expect(savedWidget.layout.w).toBeGreaterThan(originalWidget.layout.w);
    expect(savedWidget.layout.h).toBeGreaterThan(originalWidget.layout.h);
  });
});

test.describe('dashboard editability on coarse pointers', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('keeps component controls fully visible and actionable', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/battery');
    await page.getByRole('button', { name: 'Edit dashboard' }).click();

    const frame = page.locator('[data-widget-id="d2000002-0000-0000-0000-000000000001"]');
    const control = frame.locator('[data-widget-edit-control="true"]');
    const button = control.getByRole('button', { name: 'Edit widget settings' });
    await button.scrollIntoViewIfNeeded();

    await expect(control).toBeVisible();
    await expectEditControl(button, 1);
    await button.click();
    await expect(page.getByText('Editing', { exact: true })).toBeVisible();
  });
});

test.describe('mobile app navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('uses a full-screen, touch-safe navigation sheet', async ({ page }) => {
    await installApiMocks(page);
    await page.goto('/');

    const menuTrigger = page.getByRole('button', { name: 'Toggle navigation' });
    await expect(menuTrigger).toBeVisible();
    await menuTrigger.click();

    const sheet = page.getByRole('dialog', { name: 'Navigation' });
    await expect(sheet).toBeVisible();
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox).not.toBeNull();
    expect(sheetBox!.x).toBe(0);
    expect(sheetBox!.y).toBe(0);
    expect(sheetBox!.width).toBeGreaterThanOrEqual(390);
    expect(sheetBox!.height).toBeGreaterThanOrEqual(844);

    const overview = sheet.getByRole('button', { name: 'Overview' });
    const battery = sheet.getByRole('button', { name: 'Battery' });
    const settings = sheet.getByRole('button', { name: 'Open settings' });
    const signOut = sheet.getByRole('button', { name: 'Sign out' });
    const navigation = sheet.getByRole('navigation', { name: 'Primary navigation' });

    await expect(overview).toHaveAttribute('aria-current', 'page');
    await expect(navigation).toHaveCSS('overflow-y', 'auto');

    for (const control of [overview, battery, settings, signOut]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await battery.click();
    await expect(page).toHaveURL(/\/battery$/);
    await expect(sheet).toHaveCount(0);
  });
});

test.describe('mobile dashboard chart viewer', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('keeps efficiency bars visible and expands into the landscape chart viewer', async ({ page }) => {
    await installApiMocks(page);
    await page.addInitScript(() => {
      Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
        configurable: true,
        value: undefined,
      });
    });
    await page.route('**/v1/efficiency/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/v1/efficiency/trend') {
        return json(route, [
          { ts: '2026-07-01T08:00:00Z', trip_efficiency_wh_mi: 315, rolling_24h_wh_mi: 320 },
          { ts: '2026-07-02T08:00:00Z', trip_efficiency_wh_mi: 305, rolling_24h_wh_mi: 315 },
        ]);
      }
      if (path === '/v1/efficiency/vs-temp') {
        return json(route, [
          { temp_c_low: 5, temp_c_high: 10, avg_efficiency_wh_mi: 360, trip_count: 2, total_miles: 20, avg_speed_mph: 31 },
          { temp_c_low: 15, temp_c_high: 20, avg_efficiency_wh_mi: 310, trip_count: 4, total_miles: 42, avg_speed_mph: 39 },
        ]);
      }
      if (path === '/v1/efficiency/by-mode') {
        return json(route, [
          { drive_mode: 'all_purpose', avg_wh_per_mi: 320, trip_count: 4 },
          { drive_mode: 'sport', avg_wh_per_mi: 370, trip_count: 2 },
        ]);
      }
      return json(route, []);
    });

    await page.goto('/efficiency');
    await page.getByRole('button', { name: 'Expand chart' }).click();
    await expect(page.getByText('Rotate for a wider chart')).toBeVisible();

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('[data-mobile-chart-viewer="true"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      viewerBackground: getComputedStyle(document.querySelector('[data-mobile-chart-viewer="true"]')!).backgroundColor,
      viewerTouchAction: getComputedStyle(document.querySelector('[data-mobile-chart-viewer="true"]')!).touchAction,
      documentOverflow: getComputedStyle(document.documentElement).overflow,
      bodyPosition: getComputedStyle(document.body).position,
      appInert: document.getElementById('root')?.inert,
    }))).toEqual(expect.objectContaining({
      viewerBackground: expect.not.stringMatching(/transparent|rgba\(0,\s*0,\s*0,\s*0\)/),
      viewerTouchAction: 'none',
      documentOverflow: 'hidden',
      bodyPosition: 'fixed',
      appInert: true,
    }));
    const viewer = page.locator('[data-mobile-chart-viewer="true"]');
    const viewerControls = page.locator('[data-mobile-chart-controls="true"]');
    await expect(viewerControls).toHaveAttribute('aria-hidden', 'true');
    await viewer.click({ position: { x: 420, y: 190 } });
    await expect(viewerControls).toHaveAttribute('aria-hidden', 'false');
    await viewer.click({ position: { x: 420, y: 190 } });
    await expect(viewerControls).toHaveAttribute('aria-hidden', 'true');
    await viewer.click({ position: { x: 420, y: 190 } });
    await expect(viewerControls).toHaveAttribute('aria-hidden', 'false');
    await page.getByRole('button', { name: 'Choose chart' }).click();
    await page.getByRole('option', { name: 'Efficiency by Temperature' }).click();

    const allBars = page.locator('[data-efficiency-pill-bar="true"]');
    const bars = [];
    for (let index = 0; index < await allBars.count(); index += 1) {
      const bar = allBars.nth(index);
      if (await bar.isVisible()) bars.push(bar);
    }
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      const box = await bar.boundingBox();
      expect(box?.width).toBeGreaterThan(100);
    }
    await page.getByRole('button', { name: 'Close expanded chart' }).click();
    await expect(page.locator('[data-mobile-chart-viewer="true"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ({
      documentOverflow: getComputedStyle(document.documentElement).overflow,
      bodyPosition: getComputedStyle(document.body).position,
      appInert: document.getElementById('root')?.inert,
    }))).toEqual(expect.objectContaining({
      bodyPosition: 'static',
      appInert: false,
    }));
  });
});

function loadDashboard(slug: string): DashboardConfig {
  const path = new URL(`../../../../packages/dashboards/src/defaults/${slug}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as DashboardConfig;
}

async function installApiMocks(page: Page, options: { vehicleStatus?: Record<string, unknown> } = {}) {
  const createdDashboards: Array<{ config: DashboardConfig }> = [];

  await page.addInitScript(() => {
    window.localStorage.setItem('rm-show-dashboard-edit-button:e2e-user', 'true');
  });
  await page.routeWebSocket('**/v1/vehicles/live**', (socket) => socket.close());
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/v1/auth/bootstrap') {
      return json(route, authTokens());
    }
    if (path === '/v1/auth/me') {
      return json(route, {
        user_id: 'e2e-user',
        email: 'editor@riviamigo.test',
        role: 'user',
        default_vehicle_id: 'vehicle-1',
      });
    }
    if (path === '/v1/auth/preferences') {
      return json(route, { units: unitPreferences() });
    }
    if (path === '/v1/vehicles') {
      return json(route, { vehicles: [testVehicle()] });
    }
    if (/^\/v1\/vehicles\/[^/]+\/status$/.test(path)) {
      return json(route, options.vehicleStatus ?? {});
    }
    if (/^\/v1\/vehicles\/[^/]+\/images$/.test(path)) {
      return json(route, { all: [] });
    }
    if (path === '/v1/dashboards' && method === 'GET') {
      return json(route, Array.from(dashboards.values()));
    }
    if (path.startsWith('/v1/dashboards/by-slug/')) {
      const slug = decodeURIComponent(path.slice('/v1/dashboards/by-slug/'.length));
      return json(route, dashboards.get(slug) ?? customDashboard);
    }
    if (path === '/v1/dashboards' && method === 'POST') {
      const body = request.postDataJSON() as { config: DashboardConfig };
      createdDashboards.push(body);
      return json(route, {
        ...body.config,
        id: '44444444-4444-4444-4444-444444444444',
        ownerId: '22222222-2222-2222-2222-222222222222',
        isDefault: false,
        isLocked: false,
      });
    }

    return json(route, fallbackApiResponse(path));
  });

  return { createdDashboards };
}

async function controlHitTest(button: ReturnType<Page['locator']>) {
  return button.evaluate((buttonElement) => {
    const control = buttonElement.closest('[data-widget-edit-control="true"]');
    if (!control) throw new Error('Widget edit control is missing');
    const frame = control.closest('[data-widget-frame="edit"]');
    if (!frame) throw new Error('Widget edit frame is missing');
    const style = getComputedStyle(control);
    const controlRect = control.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const buttonRect = buttonElement.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      buttonRect.left + buttonRect.width / 2,
      buttonRect.top + buttonRect.height / 2,
    );
    return {
      opacity: Number(style.opacity),
      position: style.position,
      top: style.top,
      right: style.right,
      zIndex: style.zIndex,
      pointerEvents: style.pointerEvents,
      anchored:
        Math.abs(controlRect.top - frameRect.top - 8) <= 1 &&
        Math.abs(frameRect.right - controlRect.right - 8) <= 1,
      hit: topmost === buttonElement || buttonElement.contains(topmost),
    };
  });
}

async function expectEditControl(button: ReturnType<Page['locator']>, minimumOpacity = 0.72) {
  const state = await controlHitTest(button);
  expect(state).toMatchObject(EDIT_CONTROL_GEOMETRY);
  expect(state.opacity).toBeGreaterThanOrEqual(minimumOpacity);
}

function fallbackApiResponse(path: string): unknown {
  if (path === '/v1/metrics/catalog') return { metrics: [] };
  if (path === '/v1/metrics/value') return { value: null, ts: null };
  if (path === '/v1/metrics/series') return [];
  if (path === '/v1/battery/health') return {};
  if (path.startsWith('/v1/battery/')) return [];
  if (path === '/v1/charging/summary' || path === '/v1/charging/chart-series') return {};
  if (path === '/v1/charging') return paginated();
  if (path.startsWith('/v1/charging/')) return [];
  if (path === '/v1/trips/map') return { routes: [] };
  if (path === '/v1/trips') return paginated();
  if (path.startsWith('/v1/trips/')) return [];
  if (path === '/v1/efficiency/summary') {
    return { avg_wh_per_mi: 0, p10_wh_per_mi: 0, p90_wh_per_mi: 0, total_miles: 0 };
  }
  if (path.startsWith('/v1/efficiency/')) return [];
  if (path === '/v1/stats') return {};
  if (path === '/v1/places') return { places: [] };
  return {};
}

function paginated() {
  return { items: [], total: 0, page: 1, per_page: 25, total_pages: 0 };
}

function authTokens() {
  return {
    access_token: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJlMmUtdXNlciJ9.',
    expires_in: 3600,
    default_vehicle_id: 'vehicle-1',
  };
}

function testVehicle() {
  return {
    id: 'vehicle-1',
    user_id: 'e2e-user',
    rivian_vehicle_id: 'rivian-vehicle-1',
    vin: null,
    model: 'R1T',
    year: 2025,
    trim: 'Adventure',
    color: 'Forest Green',
    battery_capacity_kwh: 135,
    display_name: 'Test R1T',
    created_at: '2026-01-01T00:00:00Z',
    images: null,
    membership_role: 'owner',
  };
}

function unitPreferences() {
  return {
    mode: 'imperial',
    distance_unit: 'miles',
    speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    pressure_unit: 'psi',
    altitude_unit: 'feet',
    place_radius_unit: 'feet',
    efficiency_display: 'distance_per_energy',
  };
}

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}
