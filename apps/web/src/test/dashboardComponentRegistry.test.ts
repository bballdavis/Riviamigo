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
      options: { forceShow: false },
    });

    expect(widgets.find((widget) => widget.definitionId === 'home_share')?.layout).toMatchObject({ x: 0, y: 4, w: 3, h: 2 });
    expect(widgets.find((widget) => widget.definitionId === 'dc_share')?.layout).toMatchObject({ x: 3, y: 4, w: 3, h: 2 });
    expect(widgets.find((widget) => widget.definitionId === 'total_cost')?.layout).toMatchObject({ x: 3, y: 2, w: 3, h: 2 });

    const absorbedIds = new Set(['avg_session', 'charge_efficiency', 'max_charge_rate', 'max_charge_limit']);
    expect(widgets.some((widget) => absorbedIds.has(widget.definitionId))).toBe(false);
  });
});
