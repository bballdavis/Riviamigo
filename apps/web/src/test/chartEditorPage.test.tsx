import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartEditorPage } from '../features/charts/editor/ChartEditorPage';

const chartDatasetMock = vi.hoisted(() => vi.fn());
const managerDataMock = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({
  useChartManager: () => ({ data: managerDataMock.value }),
  useChartSources: () => ({ data: undefined }),
  useChartDatasets: chartDatasetMock,
  useMetricCatalog: () => ({ data: [] }),
  useResolvedVehicleSelection: () => ({ effectiveVehicleId: 'vehicle-1' }),
  useCreateChart: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateChart: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock('@riviamigo/dashboards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/dashboards')>();
  return {
    ...actual,
    ManagedChartRuntime: ({ chart }: { chart: { slug: string } }) => <div data-testid="managed-chart-runtime">{chart.slug}</div>,
  };
});

describe('ChartEditorPage preview data flow', () => {
  beforeEach(() => {
    chartDatasetMock.mockReset();
    chartDatasetMock.mockReturnValue({ datasets: [], isLoading: false, errors: [] });
    managerDataMock.value = [];
  });

  it('keeps custom preview ranges stable across ordinary rerenders', () => {
    const view = render(<ChartEditorPage mode="new" />);
    const firstCall = chartDatasetMock.mock.calls[0];

    view.rerender(<ChartEditorPage mode="new" />);

    expect(chartDatasetMock.mock.calls.length).toBeGreaterThan(1);
    expect(chartDatasetMock.mock.calls[1]?.[0]).not.toBeNull();
    for (const call of chartDatasetMock.mock.calls.slice(1)) {
      expect(call[1]).toEqual(expect.objectContaining({
        from: firstCall?.[1].from,
        to: firstCall?.[1].to,
      }));
    }
  });

  it('skips generic dataset fetching for bundled previews', async () => {
    const { getBundledChartDefinition } = await import('@riviamigo/dashboards');
    const bundled = getBundledChartDefinition('soc-history');
    managerDataMock.value = [{
      effective: {
        id: 'chart-1', ownerId: null, slug: 'soc-history', name: 'State of Charge',
        isDefault: true, isLocked: true, isEnabled: true, config: bundled,
      },
    }];

    const view = render(<ChartEditorPage mode="edit" chartId="chart-1" />);
    await vi.waitFor(() => expect(chartDatasetMock).toHaveBeenCalled());

    expect(chartDatasetMock.mock.calls.at(-1)?.[0]).toBeNull();
    view.unmount();
  });
});
