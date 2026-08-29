import { describe, expect, it } from 'vitest';
import type { ChartDefinitionV1, ChartSourceBinding } from '@riviamigo/types';
import { normalizeChartDataset } from '../../../../packages/hooks/src/chartSources';

const binding: ChartSourceBinding = {
  id: 'main',
  sourceId: 'metrics.series',
  params: { metric: 'speed' },
  filters: [],
  inherit: { vehicle: true, timeframe: true },
};

const definition: ChartDefinitionV1 = {
  schemaVersion: 1,
  placements: [],
  timeframe: { mode: 'dashboard' },
  sources: [binding],
  x: { field: { sourceBindingId: 'main', field: 'timestamp' }, kind: 'time' },
  series: [{
    id: 'speed',
    label: 'Speed',
    x: { sourceBindingId: 'main', field: 'sample_time' },
    y: { sourceBindingId: 'main', field: 'speed' },
    mark: 'line',
    yAxis: 'y',
    color: { mode: 'token', token: 'accent' },
    transforms: [],
  }],
  axes: {
    x: { scale: 'linear', domain: { mode: 'auto' } },
    y: { scale: 'linear', domain: { mode: 'auto' } },
  },
  display: { legend: 'hide', grid: true, tooltip: true, timeFilter: 'raw', curveSmoothness: 'gentle' },
  interaction: { panZoom: true, touchExplore: true, connectGaps: false },
};

describe('normalizeChartDataset', () => {
  it('materializes per-series X fields and removes missing global X rows without shifting values', () => {
    const dataset = normalizeChartDataset([
      { timestamp: '2026-01-01T00:00:00Z', sample_time: '2026-01-01T00:00:01Z', speed: 10 },
      { sample_time: '2026-01-01T00:00:02Z', speed: 999 },
      { timestamp: '2026-01-01T00:00:03Z', sample_time: '2026-01-01T00:00:04Z', speed: 30 },
    ], binding, definition);

    expect(dataset.domain.values).toEqual(['2026-01-01T00:00:00Z', '2026-01-01T00:00:03Z']);
    expect(dataset.fields.sample_time).toMatchObject({ kind: 'time', values: ['2026-01-01T00:00:01Z', '2026-01-01T00:00:04Z'] });
    expect(dataset.fields.speed?.values).toEqual([10, 30]);
  });

  it('uses a binding-specific curve domain when another data group owns the shared X field', () => {
    const secondary: ChartSourceBinding = { ...binding, id: 'secondary', params: { metric: 'temperature' } };
    const multiSource: ChartDefinitionV1 = {
      ...definition,
      sources: [binding, secondary],
      series: [{
        ...definition.series[0]!,
        id: 'temperature',
        x: { sourceBindingId: 'secondary', field: 'sample_time' },
        y: { sourceBindingId: 'secondary', field: 'temperature' },
      }],
    };

    const dataset = normalizeChartDataset([
      { sample_time: '2026-01-01T00:00:02Z', temperature: 70 },
      { sample_time: '2026-01-01T00:00:04Z', temperature: 72 },
    ], secondary, multiSource);

    expect(dataset.domain).toMatchObject({ field: 'sample_time', values: ['2026-01-01T00:00:02Z', '2026-01-01T00:00:04Z'] });
    expect(dataset.fields.temperature?.values).toEqual([70, 72]);
  });
});
