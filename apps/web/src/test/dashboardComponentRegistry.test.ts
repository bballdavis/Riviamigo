import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_DASHBOARDS, getAllWidgets, getWidgetEditorMeta, sanitizeDashboardConfig } from '@riviamigo/dashboards';

describe('dashboard component registry', () => {
  it('keeps default dashboards on the current component model', () => {
    const registered = new Set(getAllWidgets().map((widget) => `${widget.componentType}:${widget.definitionId}`));

    for (const dashboard of DEFAULT_DASHBOARDS) {
      expect(dashboard.schemaVersion).toBe(2);

      for (const widget of dashboard.widgets) {
        expect(['custom', 'sensor', 'chart', 'battery', 'charging', 'table']).toContain(widget.componentType);
        expect(registered.has(`${widget.componentType}:${widget.definitionId}`)).toBe(true);
      }
    }
  });

  it('uses reusable sensor chips for default page stats outside overview too', () => {
    for (const slug of ['battery', 'charging'] as const) {
      const dashboard = DEFAULT_DASHBOARDS.find((item) => item.slug === slug);
      expect(dashboard).toBeTruthy();
      const topStats = dashboard?.widgets.filter((widget) => widget.layout.y === 0 || widget.layout.y === 2 || widget.layout.y === 4) ?? [];
      expect(topStats.some((widget) => widget.componentType === 'sensor')).toBe(true);
      expect(topStats.some((widget) => widget.componentType === 'battery' || widget.componentType === 'charging')).toBe(false);
      expect(topStats.some((widget) => widget.definitionId === 'trips.stat')).toBe(false);
    }
  });

  it('does not register outdated dashboard component names', () => {
    const registeredNames = getAllWidgets().map((widget) => `${widget.componentType}:${widget.definitionId}`.toLowerCase());

    expect(registeredNames.some((name) => name.includes('legacy'))).toBe(false);
    expect(registeredNames.some((name) => name.includes('widgetid'))).toBe(false);
  });

  it('declares fixed-size metadata for compact custom chips while keeping sensor chips resizable', () => {
    const registered = new Map(getAllWidgets().map((widget) => [`${widget.componentType}:${widget.definitionId}`, widget]));

    expect(getWidgetEditorMeta(registered.get('custom:trips.stat'))).toMatchObject({
      fixedSize: true,
      resizable: false,
    });
    expect(getWidgetEditorMeta(registered.get('custom:charging.connection'))).toMatchObject({
      fixedSize: true,
      resizable: false,
    });
    expect(getWidgetEditorMeta(registered.get('sensor:total_miles'))).toMatchObject({
      fixedSize: false,
      resizable: true,
    });
  });

  it('sanitizes restored/imported layouts using widget editor capabilities', () => {
    const sanitized = sanitizeDashboardConfig({
      schemaVersion: 2,
      id: '11111111-1111-1111-1111-111111111111',
      slug: 'layout-test',
      name: 'Layout Test',
      isDefault: false,
      isLocked: false,
      ownerId: null,
      controls: { dateRange: true },
      widgets: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          componentType: 'custom',
          definitionId: 'trips.stat',
          title: 'Trips',
          layout: { x: 10, y: 1, w: 12, h: 9 },
          options: {},
        },
        {
          id: '33333333-3333-3333-3333-333333333333',
          componentType: 'sensor',
          definitionId: 'total_miles',
          title: 'Miles',
          layout: { x: 10, y: 2, w: 12, h: 2 },
          options: {},
        },
      ],
    });

    expect(sanitized.widgets[0]?.layout).toEqual({ x: 9, y: 1, w: 3, h: 2 });
    expect(sanitized.widgets[1]?.layout).toEqual({ x: 0, y: 2, w: 12, h: 2 });
  });

  it('keeps the API overview seed aligned with the frontend default layout', () => {
    const apiOverview = JSON.parse(
      readFileSync(
        resolve(process.cwd(), '../api/dashboards/dashboard.json'),
        'utf8'
      )
    ) as { widgets: Array<{ id: string; layout: unknown }> };
    const frontendOverview = DEFAULT_DASHBOARDS.find((dashboard) => dashboard.slug === 'dashboard');

    expect(apiOverview.widgets).toEqual(frontendOverview?.widgets);
  });

  it('reshapes the charging summary around the connected charging custom chip', () => {
    const charging = DEFAULT_DASHBOARDS.find((dashboard) => dashboard.slug === 'charging');
    expect(charging).toBeTruthy();

    const widgets = charging?.widgets ?? [];
    const connectedChip = widgets.find((widget) => widget.definitionId === 'charging.connection');
    // Connection chip lives in the top-right of the top three rows. When plugged in
    // it replaces the hide-when-unplugged sensor chips that share the same coordinates.
    expect(connectedChip).toMatchObject({
      componentType: 'custom',
      layout: { x: 6, y: 0, w: 6, h: 6 },
      options: { chargingConnectionVisibility: 'plugged' },
    });

    expect(widgets.find((widget) => widget.definitionId === 'charging_total_cost')?.layout).toMatchObject({ x: 3, y: 2, w: 3, h: 2 });

    expect(widgets.find((widget) => widget.definitionId === 'charging_efficiency_summary')).toMatchObject({
      componentType: 'sensor',
      options: { chargingConnectionVisibility: 'unplugged' },
      layout: { x: 6, y: 0, w: 3, h: 2 },
    });
    expect(widgets.find((widget) => widget.definitionId === 'charging_max_limit')).toMatchObject({
      componentType: 'sensor',
      options: { chargingConnectionVisibility: 'unplugged' },
      layout: { x: 9, y: 0, w: 3, h: 2 },
    });
    expect(widgets.find((widget) => widget.definitionId === 'charging_max_rate')).toMatchObject({
      componentType: 'sensor',
      options: { chargingConnectionVisibility: 'unplugged' },
      layout: { x: 6, y: 2, w: 3, h: 2 },
    });
    expect(widgets.find((widget) => widget.definitionId === 'charging_avg_session')).toMatchObject({
      componentType: 'sensor',
      options: { chargingConnectionVisibility: 'unplugged' },
      layout: { x: 9, y: 2, w: 3, h: 2 },
    });

    expect(widgets.find((widget) => widget.id === 'd4000004-0000-0000-0000-000000000009')).toMatchObject({
      componentType: 'sensor',
      definitionId: 'charging_home_share',
      options: {},
      layout: { x: 0, y: 4, w: 3, h: 2 },
    });
    expect(widgets.find((widget) => widget.id === 'd4000004-0000-0000-0000-000000000010')).toMatchObject({
      componentType: 'sensor',
      definitionId: 'charging_dc_share',
      options: {},
      layout: { x: 3, y: 4, w: 3, h: 2 },
    });
    expect(widgets.some((widget) => widget.definitionId === 'charging_free_sessions')).toBe(false);
    expect(widgets.some((widget) => widget.definitionId === 'charging_range_added')).toBe(false);
  });
});
