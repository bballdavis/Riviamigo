import { describe, expect, it } from 'vitest';
import { DEFAULT_DASHBOARDS, getAllWidgets } from '@riviamigo/dashboards';

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

  it('does not register outdated dashboard component names', () => {
    const registeredNames = getAllWidgets().map((widget) => `${widget.componentType}:${widget.definitionId}`.toLowerCase());

    expect(registeredNames.some((name) => name.includes('legacy'))).toBe(false);
    expect(registeredNames.some((name) => name.includes('widgetid'))).toBe(false);
  });

  it('reshapes the charging summary around the connected charging custom chip', () => {
    const charging = DEFAULT_DASHBOARDS.find((dashboard) => dashboard.slug === 'charging');
    expect(charging).toBeTruthy();

    const widgets = charging?.widgets ?? [];
    const connectedChip = widgets.find((widget) => widget.definitionId === 'charging.connection');
    expect(connectedChip).toMatchObject({
      componentType: 'custom',
      layout: { x: 6, y: 0, w: 6, h: 6 },
      options: { chargingConnectionVisibility: 'plugged' },
    });

    expect(widgets.find((widget) => widget.definitionId === 'total_cost')?.layout).toMatchObject({ x: 3, y: 2, w: 3, h: 2 });

    expect(widgets.find((widget) => widget.definitionId === 'max_charge_limit')).toMatchObject({
      options: { chargingConnectionVisibility: 'unplugged' },
      layout: { x: 6, y: 0, w: 3, h: 2 },
    });
    expect(widgets.find((widget) => widget.definitionId === 'charge_efficiency')).toMatchObject({
      options: { chargingConnectionVisibility: 'unplugged' },
      layout: { x: 9, y: 0, w: 3, h: 2 },
    });
    expect(widgets.find((widget) => widget.definitionId === 'max_charge_rate')).toMatchObject({
      options: { chargingConnectionVisibility: 'unplugged' },
      layout: { x: 6, y: 2, w: 3, h: 2 },
    });
    expect(widgets.find((widget) => widget.definitionId === 'avg_session')).toMatchObject({
      options: { chargingConnectionVisibility: 'unplugged' },
      layout: { x: 9, y: 2, w: 3, h: 2 },
    });

    expect(widgets.find((widget) => widget.id === 'd4000004-0000-0000-0000-000000000009')).toMatchObject({
      options: {},
      layout: { x: 0, y: 4, w: 3, h: 2 },
    });
    expect(widgets.find((widget) => widget.id === 'd4000004-0000-0000-0000-000000000010')).toMatchObject({
      options: {},
      layout: { x: 3, y: 4, w: 3, h: 2 },
    });
    expect(widgets.find((widget) => widget.id === 'd4000004-0000-0000-0000-000000000014')).toBeUndefined();
    expect(widgets.find((widget) => widget.id === 'd4000004-0000-0000-0000-000000000015')).toBeUndefined();
  });
});
