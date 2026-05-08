import { describe, expect, it } from 'vitest';
import { DEFAULT_DASHBOARDS, getAllWidgets } from '@riviamigo/dashboards';

describe('dashboard component registry', () => {
  it('keeps default dashboards on the current component model', () => {
    const registered = new Set(getAllWidgets().map((widget) => `${widget.componentType}:${widget.definitionId}`));

    for (const dashboard of DEFAULT_DASHBOARDS) {
      expect(dashboard.schemaVersion).toBe(2);

      for (const widget of dashboard.widgets) {
        expect(['custom', 'sensor', 'chart', 'battery', 'table']).toContain(widget.componentType);
        expect(registered.has(`${widget.componentType}:${widget.definitionId}`)).toBe(true);
      }
    }
  });

  it('does not register outdated dashboard component names', () => {
    const registeredNames = getAllWidgets().map((widget) => `${widget.componentType}:${widget.definitionId}`.toLowerCase());

    expect(registeredNames.some((name) => name.includes('legacy'))).toBe(false);
    expect(registeredNames.some((name) => name.includes('widgetid'))).toBe(false);
  });
});
