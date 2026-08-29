import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBundledChartDefinition } from '@riviamigo/dashboards';
import type { ChartRecord } from '@riviamigo/types';
import { ChartEditorPage } from '../features/charts/editor/ChartEditorPage';

function firstBaselineMileageConfig(
  primaryField: string,
  primaryLabel: string,
  primaryUnit: string,
  primaryToken: 'accent' | 'emerald' | 'violet',
  showPoints = false
): ChartRecord['config'] {
  return {
    schemaVersion: 1,
    placements: [{ dashboardSlug: 'overview' }, { dashboardSlug: 'battery' }],
    timeframe: { mode: 'dashboard' },
    sources: [{ id: 'main', sourceId: 'battery.mileage', params: {}, filters: [], inherit: { vehicle: true, timeframe: true } }],
    x: { field: { sourceBindingId: 'main', field: 'odometer_miles' }, kind: 'number' },
    series: [{ id: primaryField, label: primaryLabel, y: { sourceBindingId: 'main', field: primaryField }, mark: 'line', yAxis: 'y', color: { mode: 'token', token: primaryToken }, transforms: [], visibleInLegend: true }],
    axes: { x: { scale: 'linear', domain: { mode: 'auto' } }, y: { scale: 'linear', unit: primaryUnit, domain: { mode: 'auto' } } },
    display: { legend: 'hide', grid: true, tooltip: true, timeFilter: 'raw', curveSmoothness: 'gentle', ...(showPoints ? { showPoints: true } : {}) },
    interaction: { panZoom: true, touchExplore: true, connectGaps: false },
  };
}

const chartDatasetMock = vi.hoisted(() => vi.fn());
const managerDataMock = vi.hoisted(() => ({ value: [] as unknown[] }));
const managedRuntimeMock = vi.hoisted(() => vi.fn());

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
    ManagedChartRuntime: ({ chart, height, ctx }: { chart: { slug: string; config: { series: unknown[] } }; height: number; ctx: { from: string | null; to: string | null } }) => {
      managedRuntimeMock({ chart, height, ctx });
      return <div data-testid="managed-chart-runtime" data-chart-height={height} data-series={JSON.stringify(chart.config.series)}>{chart.slug}</div>;
    },
  };
});

describe('ChartEditorPage preview data flow', () => {
  beforeEach(() => {
    chartDatasetMock.mockReset();
    chartDatasetMock.mockReturnValue({ datasets: [], isLoading: false, errors: [] });
    managedRuntimeMock.mockReset();
    managerDataMock.value = [];
  });

  it('keeps custom preview ranges stable across ordinary rerenders', () => {
    const view = render(<ChartEditorPage mode="new" />);
    const firstContext = managedRuntimeMock.mock.calls[0]?.[0].ctx;

    view.rerender(<ChartEditorPage mode="new" />);

    expect(managedRuntimeMock.mock.calls.length).toBeGreaterThan(1);
    for (const call of managedRuntimeMock.mock.calls.slice(1)) {
      expect(call[0].ctx).toEqual(expect.objectContaining({
        from: firstContext.from,
        to: firstContext.to,
      }));
    }
  });

  it('passes color and fill edits directly into the unsaved preview record', () => {
    render(<ChartEditorPage mode="new" />);
    fireEvent.click(screen.getByRole('button', { name: 'curves' }));

    expect(screen.queryByText('Plotted over')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Fill under curve' })).toBeChecked();

    fireEvent.change(screen.getByLabelText('Color'), { target: { value: 'emerald' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Fill under curve' }));

    const series = JSON.parse(screen.getByTestId('managed-chart-runtime').getAttribute('data-series') ?? '[]');
    expect(series[0]).toEqual(expect.objectContaining({
      mark: 'step',
      fill: false,
      color: { mode: 'token', token: 'emerald' },
    }));
  });

  it('renders the live preview at double height inside a 95 percent-width wrapper', () => {
    render(<ChartEditorPage mode="new" />);

    const chart = screen.getByTestId('managed-chart-runtime');
    expect(chart).toHaveAttribute('data-chart-height', '520');
    expect(chart.parentElement).toHaveClass('mx-auto', 'w-[95%]');
  });

  it('upgrades the incomplete persisted battery baseline before previewing or editing it', async () => {
    const bundled = getBundledChartDefinition('battery-capacity-mileage');
    if (!bundled) throw new Error('battery-capacity-mileage default is missing');
    const { slug, title, description, ...canonical } = bundled;
    const legacyConfig = firstBaselineMileageConfig('usable_kwh', 'Usable Capacity', 'kWh', 'violet', true);
    const personal = {
      id: 'personal-battery',
      ownerId: 'user-1',
      slug,
      name: title,
      description,
      isDefault: false,
      isLocked: false,
      isEnabled: true,
      baselineRevision: null,
      config: legacyConfig,
    };
    managerDataMock.value = [
      {
        effective: personal,
        personalOverride: personal,
        systemBase: { ...personal, id: 'system-battery', ownerId: null, baselineRevision: 4, config: canonical },
        origin: 'override',
        permissions: { read: true, edit: true, duplicate: true, reset: true, restore: false, delete: true, lock: false },
      },
    ];

    render(<ChartEditorPage mode="edit" chartId="personal-battery" />);

    await waitFor(() => {
      const preview = managedRuntimeMock.mock.calls.at(-1)?.[0].chart;
      expect(preview.config.x).toEqual({
        field: { sourceBindingId: 'main', field: 'timestamp' },
        kind: 'time',
      });
      expect(preview.config.series).toHaveLength(2);
    });
    const preview = managedRuntimeMock.mock.calls.at(-1)?.[0].chart;
    expect(preview.config.series).toEqual([
      expect.objectContaining({
        y: expect.objectContaining({ field: 'usable_kwh' }),
        fill: true,
        yAxis: 'y',
        color: { mode: 'token', token: 'violet' },
      }),
      expect.objectContaining({
        y: expect.objectContaining({ field: 'odometer_miles' }),
        fill: false,
        yAxis: 'y2',
        color: { mode: 'token', token: 'emerald' },
      }),
    ]);
    expect(screen.getByText(/legacy chart draft was upgraded/i)).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('upgrades the incomplete persisted projected-range baseline in the editor', async () => {
    const bundled = getBundledChartDefinition('projected-range-mileage');
    if (!bundled) throw new Error('projected-range-mileage default is missing');
    const { slug, title, description, ...canonical } = bundled;
    const personal: ChartRecord = {
      id: 'personal-projected',
      ownerId: 'user-1',
      slug,
      name: title,
      description,
      isDefault: false,
      isLocked: false,
      isEnabled: true,
      baselineRevision: null,
      config: firstBaselineMileageConfig('projected_max_range_mi', 'Projected Range', 'mi', 'emerald'),
    };
    managerDataMock.value = [{
      effective: personal,
      personalOverride: personal,
      systemBase: { ...personal, id: 'system-projected', ownerId: null, baselineRevision: 4, config: canonical },
      origin: 'override',
      permissions: { read: true, edit: true, duplicate: true, reset: true, restore: false, delete: true, lock: false },
    }];

    render(<ChartEditorPage mode="edit" chartId="personal-projected" />);

    await waitFor(() => {
      const preview = managedRuntimeMock.mock.calls.at(-1)?.[0].chart;
      expect(preview.config.x.kind).toBe('time');
      expect(preview.config.series.map((series: { y: { field: string } }) => series.y.field)).toEqual([
        'projected_max_range_mi',
        'odometer_miles',
      ]);
    });
    expect(screen.getByText(/legacy chart draft was upgraded/i)).toBeInTheDocument();
  });

  it('defaults the add-curve list to available curves and allows showing all', () => {
    render(<ChartEditorPage mode="new" />);

    fireEvent.click(screen.getByRole('button', { name: 'curves' }));
    fireEvent.click(screen.getByText('Add curve'));

    const filter = screen.getByRole('button', { name: 'Showing available curves only' });
    expect(filter).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(filter);
    expect(screen.getByRole('button', { name: 'Showing all curves' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('blocks unsupported advanced properties instead of previewing and saving a false bundled contract', async () => {
    const bundled = getBundledChartDefinition('battery-capacity-mileage');
    if (!bundled) throw new Error('battery-capacity-mileage default is missing');
    const { slug, title, description, ...config } = bundled;
    const personal: ChartRecord = {
      id: 'personal-battery', ownerId: 'user-1', slug, name: title, description,
      isDefault: false, isLocked: false, isEnabled: true, baselineRevision: 5, config,
    };
    managerDataMock.value = [{
      effective: personal, personalOverride: personal,
      systemBase: { ...personal, id: 'system-battery', ownerId: null, isDefault: true },
      origin: 'override',
      permissions: { read: true, edit: true, duplicate: true, reset: true, restore: false, delete: true, lock: false },
    }];

    render(<ChartEditorPage mode="edit" chartId="personal-battery" />);
    fireEvent.click(screen.getByRole('button', { name: 'advanced' }));
    const textarea = document.querySelector('textarea');
    if (!textarea) throw new Error('advanced definition textarea is missing');
    const edited = structuredClone(config);
    edited.series[0]!.transforms = [{ kind: 'scale', factor: 2 }];
    fireEvent.change(textarea, { target: { value: JSON.stringify(edited) } });

    await waitFor(() => {
      expect(screen.getByText(/Transforms are not supported by bundled production renderers/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
