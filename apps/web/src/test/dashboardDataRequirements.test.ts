import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DASHBOARDS,
  collectDashboardDataRequirements,
  type WidgetInstance,
} from '@riviamigo/dashboards';

describe('dashboard data requirements', () => {
  it('deduplicates default-dashboard metric chip requests into one manifest', () => {
    const overview = DEFAULT_DASHBOARDS.find((dashboard) => dashboard.slug === 'dashboard');
    expect(overview).toBeTruthy();

    const requirements = collectDashboardDataRequirements(overview?.widgets ?? []);
    const metricIds = requirements.metrics?.map((request) => request.metric) ?? [];

    expect(metricIds).toEqual([...metricIds].sort());
    expect(new Set(metricIds).size).toBe(metricIds.length);
    expect(requirements.status).toBe(true);
    expect(metricIds.length).toBeGreaterThan(0);
  });

  it('merges duplicate metrics without losing a sparkline requirement', () => {
    const duplicate: WidgetInstance[] = [
      {
        id: 'one',
        componentType: 'sensor',
        definitionId: 'total_miles',
        title: 'Miles',
        layout: { x: 0, y: 0, w: 3, h: 2 },
        options: { metric: 'total_miles', chartType: 'none' },
      },
      {
        id: 'two',
        componentType: 'sensor',
        definitionId: 'total_miles',
        title: 'Miles',
        layout: { x: 3, y: 0, w: 3, h: 2 },
        options: { metric: 'total_miles', chartType: 'line' },
      },
    ];

    expect(collectDashboardDataRequirements(duplicate).metrics).toEqual([
      { metric: 'total_miles', include_latest: true, include_series: true },
    ]);
  });

  it('safely ignores an unknown custom widget', () => {
    const unknown = {
      id: 'unknown',
      componentType: 'custom',
      definitionId: 'future-widget',
      title: 'Future',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      options: {},
    } satisfies WidgetInstance;

    expect(collectDashboardDataRequirements([unknown])).toEqual({});
  });
});
