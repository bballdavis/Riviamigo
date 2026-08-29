import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartDataset, ChartDefinitionV1 } from '@riviamigo/types';

const richChart = vi.hoisted(() => vi.fn((_props: Record<string, unknown>) => <div data-testid="rich-chart" />));
type CapturedProps = Record<string, unknown> & { points: Array<{ ts: string | number }>; series: Array<{ values: Array<number | null>; color: string }> };
vi.mock('@riviamigo/ui/charts', () => ({
  getChartColor: (token: string) => `token:${token}`,
  RichTimeSeriesChart: richChart,
}));
vi.mock('@riviamigo/ui/hooks', () => ({ useDocumentTheme: () => false }));

import { ChartDefinitionRenderer } from '../../../../packages/dashboards/src/widgets/chart/ChartDefinitionRenderer';

const definition: ChartDefinitionV1 = {
  schemaVersion: 1,
  placements: [{ dashboardSlug: 'overview' }],
  timeframe: { mode: 'dashboard' },
  sources: [
    { id: 'first', sourceId: 'metrics.series', params: { metric: 'first_value' }, filters: [], inherit: { vehicle: true, timeframe: true } },
    { id: 'second', sourceId: 'metrics.series', params: { metric: 'second_value' }, filters: [], inherit: { vehicle: true, timeframe: true } },
  ],
  x: { field: { sourceBindingId: 'first', field: 'timestamp' }, kind: 'time' },
  series: [
    { id: 'first', label: 'First', y: { sourceBindingId: 'first', field: 'first_value' }, mark: 'area', yAxis: 'y', color: { mode: 'token', token: 'accent' }, transforms: [], visibleInLegend: true },
    { id: 'second', label: 'Second', x: { sourceBindingId: 'second', field: 'timestamp' }, y: { sourceBindingId: 'second', field: 'second_value' }, mark: 'scatter', yAxis: 'y2', color: { mode: 'custom', light: '#123456', dark: '#abcdef' }, transforms: [], visibleInLegend: false },
  ],
  axes: {
    x: { label: 'Recorded at', scale: 'linear', domain: { mode: 'auto' } },
    y: { label: 'Primary', scale: 'linear', domain: { mode: 'fixed', min: 0, max: 10 } },
    y2: { label: 'Secondary', scale: 'linear', domain: { mode: 'fixed', min: 20, max: 40 } },
  },
  display: { legend: 'hide', grid: false, tooltip: false, timeFilter: 'raw', curveSmoothness: 'smooth', showPoints: true, emptyTitle: 'Nothing yet', emptyDescription: 'Try another range.' },
  interaction: { panZoom: true, touchExplore: true, connectGaps: false },
};

const datasets: ChartDataset[] = [
  { sourceBindingId: 'first', domain: { kind: 'time', field: 'timestamp', values: ['2026-01-03', '2026-01-01'] }, fields: { first_value: { kind: 'number', values: [3, 1] } }, meta: { sourceId: 'metrics.series', sampled: false, partial: false, sourcePointCount: 2 } },
  { sourceBindingId: 'second', domain: { kind: 'time', field: 'timestamp', values: [Date.parse('2026-01-02') / 1000, Date.parse('2026-01-03') / 1000] }, fields: { timestamp: { kind: 'time', values: [Date.parse('2026-01-02') / 1000, Date.parse('2026-01-03') / 1000] }, second_value: { kind: 'number', values: [20, 30] } }, meta: { sourceId: 'metrics.series', sampled: false, partial: false, sourcePointCount: 2 } },
];

describe('ChartDefinitionRenderer', () => {
  beforeEach(() => richChart.mockClear());

  it('aligns sources by a sorted domain and forwards the saved display contract', () => {
    render(<ChartDefinitionRenderer definition={definition} datasets={datasets} height={280} />);
    const props = richChart.mock.calls[0]![0] as CapturedProps;
    expect(props.points.map((point) => typeof point.ts === 'number' ? new Date(point.ts * 1000).toISOString().slice(0, 10) : point.ts)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(props.series[0]!.values).toEqual([1, null, 3]);
    expect(props.series[1]!.values).toEqual([null, 20, 30]);
    expect(props.series[1]!.color).toBe('#123456');
    expect(props).toMatchObject({ xAxisLabel: 'Recorded at', yAxisLabel: 'Primary', yRightAxisLabel: 'Secondary', yRange: [0, 10], yRightRange: [20, 40], smoothness: 'smooth', showLegend: false, showGrid: false, showTooltip: false, showPoints: true, emptyTitle: 'Nothing yet', emptyDescription: 'Try another range.' });
  });

  it('distinguishes failed, partial, and refreshing data states', () => {
    const failed = render(<ChartDefinitionRenderer definition={definition} datasets={[]} height={280} error />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load chart data');
    failed.unmount();

    const partial = render(<ChartDefinitionRenderer definition={definition} datasets={datasets} height={280} partial />);
    expect(screen.getByRole('status')).toHaveTextContent('Some data is unavailable');
    partial.unmount();

    render(<ChartDefinitionRenderer definition={definition} datasets={datasets} height={280} refreshing />);
    expect(screen.getByRole('status')).toHaveTextContent('Updating chart');
  });
});
