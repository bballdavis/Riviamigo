/**
 * Tests for DashboardChartWidget — one per chart source type.
 *
 * Strategy:
 * - Mock uPlot so it doesn't need a real canvas/DOM.
 * - Mock each data hook to return either real-shaped data or empty arrays.
 * - Assert the chart container renders (not the "no data" empty state) when
 *   data is present, and shows the empty state when data is absent.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatTemp } from '@riviamigo/ui/lib/utils';
import {
  BUNDLED_RENDERER_CAPABILITIES,
  getBundledChartDefinition,
  getChartDefinition,
  getDefaultBySlug,
  getWidget,
} from '@riviamigo/dashboards';
import type { ChartDefinitionV1, ChartRecord } from '@riviamigo/types';
import chartSeeds from '../../../../packages/dashboards/src/charts/defaults/defaults.json';
import {
  CURRENT_BUNDLED_BASELINE_REVISION,
  LEGACY_BUNDLED_CHART_BASELINE_REVISION,
  LEGACY_BUNDLED_CHART_CONTRACTS,
} from './fixtures/legacyBundledChartContracts';
import {
  ChargeSessionCurveDetail,
  ManagedChartRuntime,
  getBatteryCapacityMileageYRange,
  getProjectedRangeMileageYRange,
  usesBundledChartRenderer,
} from '../../../../packages/dashboards/src/widgets/chart/DashboardChartWidget';

const originalMatchMedia = window.matchMedia;

function setMatchMedia(mobile = false, portrait = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('orientation') ? portrait : mobile,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  setMatchMedia(false);
  localStorage.clear();
  for (const key of Object.keys(mockFavoriteState.chart_favorites)) {
    delete mockFavoriteState.chart_favorites[key];
  }
  mockUpdateDashboardChartFavorite.mockClear();
  mockEffectiveCharts.mockReset();
  mockEffectiveCharts.mockImplementation((placement: string | null) => ({
    data: chartSeeds
      .map((seed) => chartRecord(seed.slug))
      .filter((chart) =>
        placement == null
          ? false
          : chart.config.placements.some((candidate) => candidate.dashboardSlug === placement)
      ),
    isSuccess: true,
    isLoading: false,
    isError: false,
  }));
  mockUseChartDatasets.mockReset();
  mockUseChartDatasets.mockReturnValue({
    datasets: [batteryDefinitionDataset()],
    isLoading: false,
    isFetching: false,
    isPartial: false,
    errors: [],
  });
});

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: originalMatchMedia,
  });
});

// ── uPlot mock ────────────────────────────────────────────────────────────────
vi.mock('uplot', () => {
  const UPlot = class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts: unknown, _data: unknown, _root: HTMLElement) {}
    destroy() {}
    setData() {}
    setSize() {}
    cursor = { idx: null, left: 0, top: 0 };
    width = 400;
  };
  (UPlot as unknown as Record<string, unknown>).paths = {
    bars: () => () => null,
  };
  return { default: UPlot };
});

describe('DashboardChartWidget - smoothing controls', () => {
  it('never changes the renderer for a bundled slug, even when its saved definition is edited', () => {
    const seed = chartRecord('battery-capacity-mileage');
    expect(usesBundledChartRenderer(seed)).toBe(true);
    expect(
      usesBundledChartRenderer({
        ...seed,
        config: { ...seed.config, placements: [{ dashboardSlug: 'overview' }] },
      })
    ).toBe(true);
    expect(
      usesBundledChartRenderer({
        ...seed,
        config: {
          ...seed.config,
          axes: { ...seed.config.axes, y: { ...seed.config.axes.y, label: 'Edited label' } },
        },
      })
    ).toBe(true);
  });
  it('locks every existing chart slug to its established renderer after series edits', () => {
    for (const seed of chartSeeds) {
      const record = chartRecord(seed.slug);
      const first = record.config.series[0];
      const edited = first
        ? {
            ...record,
            config: {
              ...record.config,
              series: [
                { ...first, label: `${first.label} edited`, fill: false },
                ...record.config.series.slice(1),
              ],
            },
          }
        : record;
      expect(usesBundledChartRenderer(edited), seed.slug).toBe(true);
    }
  });
  it('preserves the hand-authored pre-migration visual contract for every bundled chart', () => {
    expect(LEGACY_BUNDLED_CHART_BASELINE_REVISION).toBe(
      'dbd7ae58be996e6eb5a1b01582ab73f46fb388af'
    );
    expect(CURRENT_BUNDLED_BASELINE_REVISION).toBe(5);
    for (const seed of chartSeeds) {
      const expected = LEGACY_BUNDLED_CHART_CONTRACTS[seed.slug];
      expect(expected, `missing immutable oracle entry for ${seed.slug}`).toBeDefined();
      const chart = getBundledChartDefinition(seed.slug);
      expect(chart, seed.slug).toBeDefined();
      if (!chart || !expected) continue;
      const config = chart;
      expect(`${config.x.kind}:${config.x.field.field}`, seed.slug).toBe(expected.x);
      expect(config.sources[0]?.sourceId, seed.slug).toBe(
        expected.source === 'battery_capacity_mileage' ? 'battery.mileage' :
          expected.source === 'battery_degradation' ? 'battery.degradation' :
            expected.source === 'soc_history' ? 'metrics.series' :
              expected.source === 'charging_curve_analysis' ? 'charging.curve-analysis' :
                expected.source === 'charging_sessions_energy' || expected.source === 'charging_weekly_energy' ? 'charging.sessions' :
                  expected.source === 'efficiency_mode' ? 'efficiency.drive-mode' :
                    expected.source === 'efficiency_tags' ? 'efficiency.trip-tags' :
                      expected.source === 'efficiency_temperature' ? 'efficiency.temperature' :
                        expected.source === 'efficiency_trend' ? 'efficiency.trend' :
                          expected.source === 'phantom_drain' ? 'battery.idle-drain' :
                            expected.source === 'projected_range_mileage' ? 'battery.mileage' :
                              'trips.tire-pressure-timeline'
      );
      expect(config.series.map((series) => [
        series.id, series.label, series.mark, series.fill === true ? 'fill' : 'no-fill',
        series.yAxis, series.color?.mode === 'token' ? series.color.token : 'custom',
      ].join('|')), seed.slug).toEqual(expected.series);
      const yDomain = config.axes.y.domain.mode === 'fixed'
        ? `fixed:${config.axes.y.domain.min}:${config.axes.y.domain.max}`
        : `auto${config.axes.y.domain.includeZero ? ':includeZero' : ''}`;
      expect(config.axes.y.unit, seed.slug).toBe(expected.axes.yUnit);
      expect(yDomain, seed.slug).toBe(expected.axes.yDomain);
      expect(config.axes.y2?.unit, seed.slug).toBe(expected.axes.y2Unit);
      expect(config.display.legend, seed.slug).toBe(expected.display.legend);
      expect(config.display.curveSmoothness, seed.slug).toBe(expected.display.smoothness);
      expect(config.interaction.connectGaps, seed.slug).toBe(expected.display.connectGaps);
      expect(config.display.emptyTitle, seed.slug).toBe(expected.emptyTitle);
      expect(getChartDefinition(seed.slug)?.source, seed.slug).toBe(expected.source);
      expect(
        BUNDLED_RENDERER_CAPABILITIES.find((capability) => capability.slug === seed.slug)?.renderer,
        seed.slug
      ).toBe(expected.renderer);
    }
  });

  it('routes every bundled slug through its historical production renderer family', () => {
    for (const seed of chartSeeds) {
      const expected = LEGACY_BUNDLED_CHART_CONTRACTS[seed.slug];
      if (!expected) throw new Error(`missing immutable oracle entry for ${seed.slug}`);
      const view = renderChart(seed.slug);
      expect(
        view.container.querySelector(`[data-chart-renderer="${expected.renderer}"]`),
        seed.slug
      ).toBeTruthy();
      view.unmount();
    }
  });

  it('normalizes the incomplete persisted battery baseline before the shared managed runtime renders it', () => {
    const stale = chartRecord('battery-capacity-mileage');
    stale.config = firstBaselineMileageConfig('usable_kwh', 'Usable Capacity', 'kWh', 'violet', true);

    render(<ManagedChartRuntime chart={stale} ctx={CTX} height={260} />);

    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series',
      'Usable Capacity|Mileage'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series-modes',
      'Usable Capacity:area|Mileage:line'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-x-time', 'true');
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series-colors',
      'Usable Capacity:var(--rm-chart-violet)|Mileage:#10b981'
    );
  });
  it('normalizes the incomplete persisted projected-range baseline in the same runtime', () => {
    const stale = chartRecord('projected-range-mileage');
    stale.config = firstBaselineMileageConfig('projected_max_range_mi', 'Projected Range', 'mi', 'emerald');

    render(<ManagedChartRuntime chart={stale} ctx={CTX} height={260} />);

    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series',
      'Projected Max Range|Mileage'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-x-time', 'true');
  });
  it('keeps the standard renderer when managed metadata is reordered', () => {
    const seed = chartRecord('battery-capacity-mileage');
    const reordered = {
      ...seed,
      config: {
        interaction: seed.config.interaction,
        display: seed.config.display,
        axes: seed.config.axes,
        series: seed.config.series,
        x: seed.config.x,
        sources: seed.config.sources,
        timeframe: seed.config.timeframe,
        placements: seed.config.placements,
        schemaVersion: seed.config.schemaVersion,
      },
    };
    expect(usesBundledChartRenderer(reordered)).toBe(true);
  });

  it('keeps assigned Overview loading and errors from falling back to the fixed catalog', () => {
    const instance = assignedOverviewInstance();
    mockEffectiveCharts.mockReturnValue({
      data: [],
      isSuccess: false,
      isLoading: true,
      isError: false,
    });
    const loading = renderWidget(instance, { ...CTX, dashboardSlug: 'dashboard' });
    expect(mockEffectiveCharts).toHaveBeenCalledWith('overview');
    expect(screen.getByRole('status')).toHaveTextContent('Loading assigned charts');
    expect(screen.queryByRole('button', { name: 'Chart' })).toBeNull();

    loading.unmount();
    mockEffectiveCharts.mockReturnValue({
      data: [],
      isSuccess: false,
      isLoading: false,
      isError: true,
    });
    renderWidget(instance, { ...CTX, dashboardSlug: 'dashboard' });
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load assigned charts');
    expect(screen.queryByRole('button', { name: 'Chart' })).toBeNull();
  });

  it('uses the same assignment-backed runtime for a page catalog without managed metadata', () => {
    renderWidget(
      {
        ...makeInstance('projected-range-mileage', true),
        options: {
          chartId: 'projected-range-mileage',
          chartIds: ['projected-range-mileage'],
          page: 'battery' as const,
          showPicker: true,
        },
      },
      { ...CTX, dashboardSlug: 'battery' }
    );

    expect(mockEffectiveCharts).toHaveBeenCalledWith('battery');
    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent(
      'Projected Range by Mileage'
    );
  });

  it('uses the shared frame for assigned Overview charts and a true empty catalog', () => {
    const instance = assignedOverviewInstance();
    mockEffectiveCharts.mockReturnValue({
      data: [chartRecord('soc-history'), chartRecord('projected-range-mileage')],
      isSuccess: true,
      isLoading: false,
      isError: false,
    });
    const populated = renderWidget(instance, { ...CTX, dashboardSlug: 'dashboard' });
    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent(
      'Projected Range by Mileage'
    );
    expect(screen.getByRole('button', { name: 'Chart settings' })).toBeInTheDocument();

    populated.unmount();
    mockEffectiveCharts.mockReturnValue({
      data: [],
      isSuccess: true,
      isLoading: false,
      isError: false,
    });
    renderWidget(instance, { ...CTX, dashboardSlug: 'dashboard' });
    expect(
      screen.getByText('No enabled charts are assigned to this dashboard.')
    ).toBeInTheDocument();
  });

  it('renders an assigned built-in chart with the same dashboard renderer used on its native page', () => {
    const assigned = chartRecord('battery-capacity-mileage');
    mockEffectiveCharts.mockReturnValue({
      data: [assigned],
      isSuccess: true,
      isLoading: false,
      isError: false,
    });

    renderWidget(
      {
        ...assignedOverviewInstance(),
        options: {
          chartId: 'battery-capacity-mileage',
          chartIds: ['battery-capacity-mileage'],
          page: 'overview' as const,
          showPicker: true,
        },
      },
      { ...CTX, dashboardSlug: 'dashboard' }
    );

    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series',
      'Usable Capacity|Mileage'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series-modes',
      'Usable Capacity:area|Mileage:line'
    );
  });

  it('keeps the complete Battery Capacity render contract identical on Overview and its native dashboard', () => {
    const native = renderChart('battery-capacity-mileage');
    const nativeContract = renderedRichChartContract();
    native.unmount();

    const assigned = chartRecord('battery-capacity-mileage');
    mockEffectiveCharts.mockReturnValue({
      data: [assigned],
      isSuccess: true,
      isLoading: false,
      isError: false,
    });
    renderWidget(
      {
        ...assignedOverviewInstance(),
        options: {
          chartId: assigned.slug,
          chartIds: [assigned.slug],
          page: 'overview' as const,
          showPicker: true,
        },
      },
      { ...CTX, dashboardSlug: 'dashboard' }
    );

    expect(renderedRichChartContract()).toEqual(nativeContract);
  });

  it('keeps the production rich renderer while honoring an edited bundled record', () => {
    const assigned = chartRecord('battery-capacity-mileage');
    assigned.config = {
      ...assigned.config,
      series: assigned.config.series.map((series, index) =>
        index === 0
          ? { ...series, color: { mode: 'token' as const, token: 'sky' as const }, fill: false }
          : series
      ),
    };
    mockUseChartDatasets.mockReturnValue({
      datasets: [batteryDefinitionDataset()],
      isLoading: false,
      isFetching: false,
      isPartial: false,
      errors: [],
    });
    mockEffectiveCharts.mockReturnValue({
      data: [assigned],
      isSuccess: true,
      isLoading: false,
      isError: false,
    });

    renderWidget(
      {
        ...assignedOverviewInstance(),
        options: {
          chartId: assigned.slug,
          chartIds: [assigned.slug],
          page: 'overview' as const,
          showPicker: true,
        },
      },
      { ...CTX, dashboardSlug: 'dashboard' }
    );

    expect(usesBundledChartRenderer(assigned)).toBe(true);
    expect(mockUseChartDatasets).not.toHaveBeenCalled();
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series',
      'Usable Capacity|Mileage'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series-modes',
      'Usable Capacity:line|Mileage:line'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series-colors',
      'Usable Capacity:var(--rm-chart-sky)|Mileage:#10b981'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-y-range', '0|132');
  });

  it('keeps an assigned Overview chart selection active across parent rerenders', () => {
    const instance = assignedOverviewInstance();
    const charts = [chartRecord('soc-history'), chartRecord('projected-range-mileage')];
    mockEffectiveCharts.mockReturnValue({
      data: charts,
      isSuccess: true,
      isLoading: false,
      isError: false,
    });
    const rendered = renderWidget(instance, { ...CTX, dashboardSlug: 'dashboard' });

    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    fireEvent.click(screen.getByRole('option', { name: 'State of Charge' }));
    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent('State of Charge');

    rendered.rerender(
      <DashboardChartWidget
        instance={{ ...instance }}
        ctx={{ ...CTX, dashboardSlug: 'dashboard' }}
      />
    );

    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent('State of Charge');
  });
  it('uses projected range by mileage as the Overview app default', () => {
    const overview = getDefaultBySlug('dashboard');
    const chart = overview?.widgets.find((widget) => widget.definitionId === 'catalog');

    expect((chart?.options as Record<string, unknown> | undefined)?.chartId).toBe(
      'projected-range-mileage'
    );
  });

  it('uses projected range by mileage for new overview chart widgets', () => {
    const chart = getWidget('chart', 'catalog');

    expect(chart?.defaultOptions).toMatchObject({
      page: 'overview',
      chartId: 'projected-range-mileage',
    });
  });

  it('falls back to projected range by mileage when an overview chart has no saved chart ID', () => {
    renderWidget({
      ...makeInstance('soc-history', true),
      options: {
        chartIds: ['soc-history', 'projected-range-mileage'],
        page: 'overview' as const,
        showPicker: true,
      },
    });

    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent(
      'Projected Range by Mileage'
    );
  });

  it('does not force the tire-pressure timeline into the Trips dashboard', () => {
    const trips = getDefaultBySlug('trips');
    const chart = trips?.widgets.find((widget) => widget.options?.['chartId'] === 'tire-pressure-trips');

    expect(chart).toBeUndefined();
  });

  it('persists an explicitly selected default for this component across remounts', () => {
    const instance = {
      ...makeInstance('soc-history', true),
      options: {
        chartId: 'soc-history',
        chartIds: ['soc-history', 'projected-range-mileage'],
        page: 'overview' as const,
        showPicker: true,
      },
    };
    const ctx = { ...CTX, dashboardSlug: 'dashboard' };
    const firstRender = renderWidget(instance, ctx);

    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    expect(
      screen.getByRole('button', { name: 'State of Charge is the default chart' })
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Projected Range by Mileage as default' })
    );
    expect(
      screen.getByRole('button', { name: 'Projected Range by Mileage is the default chart' })
    ).toBeDisabled();
    expect(mockUpdateDashboardChartFavorite).toHaveBeenCalledWith({
      key: 'dashboard:test-soc-history',
      chartId: 'projected-range-mileage',
    });
    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent('State of Charge');

    firstRender.unmount();
    renderWidget(instance, ctx);

    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent(
      'Projected Range by Mileage'
    );
  });

  it('does not use the legacy browser storage value for chart defaults', () => {
    localStorage.setItem(
      'rm-dashboard-chart-defaults',
      JSON.stringify({
        'dashboard:test-soc-history': 'projected-range-mileage',
      })
    );

    renderWidget(
      {
        ...makeInstance('soc-history', true),
        options: {
          chartId: 'soc-history',
          chartIds: ['soc-history', 'projected-range-mileage'],
          page: 'overview' as const,
          showPicker: true,
        },
      },
      { ...CTX, dashboardSlug: 'dashboard' }
    );

    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent('State of Charge');
  });

  it('keeps a saved favorite when a managed catalog gains a new chart', () => {
    mockFavoriteState.chart_favorites['dashboard:dashboard-a:test-soc-history'] =
      'projected-range-mileage';
    mockEffectiveCharts.mockReturnValue({
      data: [
        chartRecord('soc-history'),
        chartRecord('projected-range-mileage'),
        chartRecord('tire-pressure-trips'),
      ],
      isSuccess: true,
      isLoading: false,
      isError: false,
    });
    renderWidget(
      {
        ...makeInstance('soc-history', true),
        managed: true,
        managedKey: 'overview.chart-catalog',
        options: {
          chartId: 'soc-history',
          chartIds: ['soc-history'],
          page: 'overview' as const,
          showPicker: true,
        },
      },
      { ...CTX, dashboardSlug: 'dashboard', dashboardConfigId: 'dashboard-a' }
    );

    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent(
      'Projected Range by Mileage'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    expect(screen.getByRole('option', { name: 'Tire Pressure and Trips' })).toBeInTheDocument();
  });

  it.each(chartSeeds.map((seed) => [seed.slug, seed.name] as const))(
    'keeps the saved %s favorite when its bundled definition advances',
    (favoriteSlug, favoriteName) => {
      mockFavoriteState.chart_favorites['dashboard:dashboard-a:test-soc-history'] = favoriteSlug;
      const advancedFavorite = chartRecord(favoriteSlug);
      advancedFavorite.config = {
        ...advancedFavorite.config,
        display: {
          ...advancedFavorite.config.display,
          grid: !advancedFavorite.config.display.grid,
        },
      };
      mockEffectiveCharts.mockReturnValue({
        data: chartSeeds.map((seed) =>
          seed.slug === favoriteSlug ? advancedFavorite : chartRecord(seed.slug)
        ),
        isSuccess: true,
        isLoading: false,
        isError: false,
      });

      renderWidget(
        {
          ...makeInstance('soc-history', true),
          managed: true,
          managedKey: 'overview.chart-catalog',
          options: {
            chartId: 'soc-history',
            chartIds: ['soc-history'],
            page: 'overview' as const,
            showPicker: true,
          },
        },
        { ...CTX, dashboardSlug: 'dashboard', dashboardConfigId: 'dashboard-a' }
      );

      expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent(favoriteName);
    }
  );

  it('isolates chart defaults across dashboard config IDs', () => {
    const instance = {
      ...makeInstance('soc-history', true),
      options: {
        chartId: 'soc-history',
        chartIds: ['soc-history', 'projected-range-mileage'],
        page: 'overview' as const,
        showPicker: true,
      },
    };

    const firstRender = renderWidget(instance, {
      ...CTX,
      dashboardSlug: 'dashboard',
      dashboardConfigId: 'dashboard-a',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Projected Range by Mileage as default' })
    );
    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent('State of Charge');

    firstRender.unmount();
    const dashboardARender = renderWidget(instance, {
      ...CTX,
      dashboardSlug: 'dashboard',
      dashboardConfigId: 'dashboard-a',
    });
    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent(
      'Projected Range by Mileage'
    );

    dashboardARender.unmount();
    renderWidget(instance, {
      ...CTX,
      dashboardSlug: 'dashboard',
      dashboardConfigId: 'dashboard-b',
    });
    expect(screen.getByRole('button', { name: 'Chart' })).toHaveTextContent('State of Charge');
  });

  it('shows the display-filter slider without a chart picker', () => {
    const instance = {
      ...makeInstance('soc-history', false),
      options: {
        chartId: 'soc-history',
        chartIds: ['soc-history'],
        page: undefined,
        showPicker: false,
        timeFilter: 'raw',
      },
    };

    render(<DashboardChartWidget instance={instance} ctx={CTX} />);
    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    const slider = screen.getByLabelText('Display filter');
    expect(slider).toBeTruthy();
    expect(slider.getAttribute('value')).toBe('0');
    expect(screen.queryByLabelText('Time minimum')).toBeNull();
  });

  it('keeps the shared chart search field to a single in-bounds focus border', () => {
    renderWidget({
      ...makeInstance('soc-history', true),
      options: {
        chartId: 'soc-history',
        chartIds: ['soc-history', 'projected-range-mileage'],
        page: 'overview' as const,
        showPicker: true,
      },
    });

    const search = screen.getByLabelText('Search charts');
    expect(search.className).toContain('focus:border-accent');
    expect(search.className).toContain('focus-visible:!outline-none');
    expect(search.className).toContain('focus-visible:!outline-offset-0');
    expect(search.className).toContain('focus-visible:ring-0');
    expect(search.className).not.toContain('focus:ring-1');

    const chartSelector = screen.getByRole('button', { name: 'Chart' });
    expect(chartSelector.className).toContain('focus-visible:!outline-none');
    expect(chartSelector.className).toContain('focus-visible:ring-0');

    const settings = screen.getByRole('button', { name: 'Chart settings' });
    expect(settings.className).toContain('focus-visible:!outline-none');
    expect(settings.className).toContain('focus-visible:ring-0');
  });

  it('maps saved smoothing values to the chart filter default and preserves a zero value as raw', () => {
    const filtered = renderWidget({
      ...makeInstance('soc-history'),
      options: {
        ...makeInstance('soc-history').options,
        curveSmoothing: 0.2,
      },
    });
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-time-filter', '15m');

    filtered.unmount();
    renderWidget({
      ...makeInstance('soc-history'),
      options: {
        ...makeInstance('soc-history').options,
        chartSettings: { 'soc-history': { smoothing: 0 } },
      },
    });
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-time-filter', 'raw');
  });

  it('writes only the new time-filter setting after editing a legacy chart', () => {
    const updateWidgetOptions = vi.fn();
    renderWidget(
      {
        ...makeInstance('soc-history'),
        options: {
          ...makeInstance('soc-history').options,
          chartSettings: { 'soc-history': { smoothing: 0.2 } },
        },
      },
      { ...CTX, updateWidgetOptions }
    );

    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));
    fireEvent.change(screen.getByLabelText('Display filter'), { target: { value: '2' } });

    expect(updateWidgetOptions).toHaveBeenLastCalledWith(
      'test-soc-history',
      expect.objectContaining({
        chartSettings: { 'soc-history': { timeFilter: '1h' } },
      })
    );
  });

  it('persists curve smoothness independently from the display filter', () => {
    const updateWidgetOptions = vi.fn();
    renderWidget(makeInstance('soc-history'), { ...CTX, updateWidgetOptions });
    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));
    fireEvent.change(screen.getByLabelText('Curve smoothness'), { target: { value: '2' } });
    expect(updateWidgetOptions).toHaveBeenLastCalledWith(
      'test-soc-history',
      expect.objectContaining({ chartSettings: { 'soc-history': { smoothness: 'smooth' } } })
    );

    fireEvent.change(screen.getByLabelText('Display filter'), { target: { value: '2' } });
    expect(updateWidgetOptions).toHaveBeenLastCalledWith(
      'test-soc-history',
      expect.objectContaining({
        chartSettings: { 'soc-history': { smoothness: 'smooth', timeFilter: '1h' } },
      })
    );
  });

  it('applies the display filter and curve smoothness to both projected-range curves', () => {
    renderChart('projected-range-mileage');
    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    fireEvent.change(screen.getByLabelText('Display filter'), { target: { value: '2' } });
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-time-filter', '1h');
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series-filterable',
      'Projected Max Range:true|Mileage:true'
    );

    fireEvent.change(screen.getByLabelText('Curve smoothness'), { target: { value: '2' } });
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-chart-smoothness', 'smooth');
  });

  it('persists projected-range display controls through the account dashboard save seam', () => {
    const updateWidgetOptions = vi.fn();
    renderWidget(makeInstance('projected-range-mileage'), { ...CTX, updateWidgetOptions });
    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    fireEvent.change(screen.getByLabelText('Display filter'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Curve smoothness'), { target: { value: '2' } });

    expect(updateWidgetOptions).toHaveBeenLastCalledWith(
      'test-projected-range-mileage',
      expect.objectContaining({
        chartSettings: {
          'projected-range-mileage': {
            timeFilter: '1h',
            smoothness: 'smooth',
          },
        },
      })
    );
    expect(localStorage.getItem('rm-dashboard-chart-defaults')).toBeNull();
  });

  it('uses the same centered dialog layout on mobile viewports', () => {
    setMatchMedia(true);
    renderChart('soc-history');

    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    const dialog = screen.getByRole('dialog', { name: /chart settings/i });
    expect(dialog.className).toContain('max-w-xl');
    expect(dialog.className).toContain('max-h-[calc(100dvh-1.5rem)]');
  });

  it('shows an empty shared-settings state for unsupported chart families', () => {
    renderChart('efficiency-mode');

    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    expect(screen.getByText(/does not expose shared display controls yet/i)).toBeTruthy();
  });

  it('keeps manual axis changes local outside dashboard edit mode', () => {
    renderChart('battery-capacity-mileage');

    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    const axisCard = screen.getByText('Mileage').closest('div.rounded-lg');
    expect(axisCard).toBeTruthy();
    fireEvent.click(within(axisCard as HTMLElement).getByRole('button', { name: 'Manual' }));
    fireEvent.change(screen.getByLabelText('Mileage minimum'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Mileage maximum'), { target: { value: '9000' } });

    expect(screen.getByTestId('rich-chart').getAttribute('data-y-right-range')).toBe('1000|9000');
  });

  it('persists per-chart manual ranges through the edit-mode widget seam', () => {
    const updateWidgetOptions = vi.fn();
    const editCtx = { ...CTX, updateWidgetOptions };

    renderWidget(makeInstance('projected-range-mileage'), editCtx);

    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    const axisCard = screen.getByText('Projected max range').closest('div.rounded-lg');
    expect(axisCard).toBeTruthy();
    fireEvent.click(within(axisCard as HTMLElement).getByRole('button', { name: 'Manual' }));
    fireEvent.change(screen.getByLabelText('Projected max range minimum'), {
      target: { value: '240' },
    });
    fireEvent.change(screen.getByLabelText('Projected max range maximum'), {
      target: { value: '360' },
    });

    expect(screen.getByTestId('rich-chart').getAttribute('data-y-range')).toBe('240|360');
    expect(updateWidgetOptions).toHaveBeenLastCalledWith(
      'test-projected-range-mileage',
      expect.objectContaining({
        chartSettings: {
          'projected-range-mileage': expect.objectContaining({
            axes: {
              y: { mode: 'manual', min: 240, max: 360 },
            },
          }),
        },
      })
    );
  });

  it('keeps settings isolated when switching between charts in the same widget', () => {
    const instance = {
      ...makeInstance('soc-history', true),
      options: {
        chartId: 'soc-history',
        chartIds: ['soc-history', 'projected-range-mileage'],
        page: undefined,
        showPicker: true,
      },
    };

    renderWidget(instance);
    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    const axisCard = within(screen.getByRole('dialog', { name: 'Chart settings' }))
      .getByText('State of Charge', { selector: 'p' })
      .closest('div.rounded-lg');
    expect(axisCard).toBeTruthy();
    fireEvent.click(within(axisCard as HTMLElement).getByRole('button', { name: 'Manual' }));
    fireEvent.change(screen.getByLabelText('State of Charge minimum'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('State of Charge maximum'), { target: { value: '90' } });

    expect(screen.getByTestId('rich-chart').getAttribute('data-y-range')).toBe('10|90');

    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    fireEvent.click(screen.getByRole('option', { name: /projected range by mileage/i }));
    expect(screen.getByTestId('rich-chart').getAttribute('data-y-range')).not.toBe('10|90');

    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    fireEvent.click(screen.getByRole('option', { name: /state of charge/i }));
    expect(screen.getByTestId('rich-chart').getAttribute('data-y-range')).toBe('10|90');
  });
});

describe('DashboardChartWidget mobile viewer', () => {
  function viewerInstance() {
    return {
      ...makeInstance('efficiency-trend', true),
      options: {
        chartId: 'efficiency-trend',
        chartIds: ['efficiency-trend', 'efficiency-temperature', 'efficiency-mode'],
        page: 'efficiency' as const,
        showPicker: true,
      },
    };
  }

  it('opens a widget-scoped chart picker in the landscape viewer without persisting the selection', async () => {
    setMatchMedia(true, false);
    const updateWidgetOptions = vi.fn();
    renderWidget(viewerInstance(), { ...CTX, updateWidgetOptions });

    const expand = screen.getByRole('button', { name: 'Expand chart' });
    fireEvent.click(expand);

    const dialog = screen.getByRole('dialog', { name: /efficiency trend expanded chart/i });
    expect(dialog.getAttribute('data-mobile-chart-viewer')).toBe('true');
    expect(dialog.className).toContain('bg-bg-page');
    expect(dialog.className).toContain('touch-none');
    fireEvent.click(screen.getByRole('button', { name: 'Choose chart' }));
    expect(screen.getByRole('option', { name: 'Efficiency by Temperature' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'State of Charge' })).toBeNull();

    fireEvent.click(screen.getByRole('option', { name: 'Efficiency by Drive Mode' }));
    expect(
      screen.getByRole('dialog', { name: /efficiency by drive mode expanded chart/i })
    ).toBeTruthy();
    expect(updateWidgetOptions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close expanded chart' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(expand));
  });

  it('shows the rotate prompt before rendering the expanded chart in portrait', () => {
    setMatchMedia(true, true);
    renderWidget(viewerInstance());

    fireEvent.click(screen.getByRole('button', { name: 'Expand chart' }));
    const title = screen.getByText('Rotate for a wider chart');
    expect(title).toBeTruthy();
    expect(title.closest('.bg-accent.text-fg-on-accent')).toBeTruthy();
    expect(screen.queryByTestId('rich-chart')).toBeNull();
  });

  it('fades viewer controls once after entry and restores them with a chart tap', () => {
    vi.useFakeTimers();
    setMatchMedia(true, false);
    renderWidget(viewerInstance());

    fireEvent.click(screen.getByRole('button', { name: 'Expand chart' }));
    const dialog = screen.getByRole('dialog', { name: /efficiency trend expanded chart/i });
    const controls = dialog.querySelector('[data-mobile-chart-controls="true"]');
    expect(controls?.getAttribute('aria-hidden')).toBe('false');

    act(() => vi.advanceTimersByTime(1000));
    expect(controls?.getAttribute('aria-hidden')).toBe('true');
    expect(controls?.className).toContain('opacity-0');

    fireEvent.pointerDown(dialog, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 200,
      clientY: 160,
    });
    fireEvent.pointerUp(dialog, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 160 });
    expect(controls?.getAttribute('aria-hidden')).toBe('false');

    vi.useRealTimers();
  });
});

describe('DashboardChartRenderer - display-filter data flow', () => {
  it('renders an older persisted mileage-domain definition on its numeric odometer x axis', () => {
    const record = chartRecord('battery-capacity-mileage');
    const persistedDefinition: ChartDefinitionV1 = {
      ...record.config,
      x: {
        field: { sourceBindingId: 'main', field: 'odometer_miles' },
        kind: 'number',
      },
      series: record.config.series.filter((series) => series.y.field === 'usable_kwh'),
      axes: {
        ...record.config.axes,
        x: { ...record.config.axes.x, unit: 'mi' },
      },
    };
    mockBatteryMileage.mockReturnValueOnce({
      data: [
        { ts: '2024-01-02T00:00:00Z', odometer_mi: null, usable_kwh: 999, range_mi: 999 },
        { ts: '2024-01-03T00:00:00Z', odometer_mi: 7000, usable_kwh: 118, range_mi: 315 },
        { ts: '2024-01-01T00:00:00Z', odometer_mi: 5000, usable_kwh: 120, range_mi: 320 },
      ],
      isLoading: false,
    });

    render(
      <DashboardChartRenderer
        chartId="battery-capacity-mileage"
        managedDefinition={persistedDefinition}
        ctx={CTX}
        height={300}
      />
    );

    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-x-time', 'false');
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-x-values', '5000|7000');
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-series', 'Usable Capacity');
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series-values',
      'Usable Capacity:120,118'
    );
  });

  it('keeps time-domain mileage definitions ordered by their persisted timestamp field', () => {
    const record = chartRecord('projected-range-mileage');
    mockBatteryMileage.mockReturnValueOnce({
      data: [
        { ts: '2024-01-03T00:00:00Z', odometer_mi: 7000, usable_kwh: 118, range_mi: 315 },
        { ts: '2024-01-01T00:00:00Z', odometer_mi: 5000, usable_kwh: 120, range_mi: 320 },
      ],
      isLoading: false,
    });

    render(
      <DashboardChartRenderer
        chartId="projected-range-mileage"
        managedDefinition={record.config}
        ctx={CTX}
        height={300}
      />
    );

    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-x-time', 'true');
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-x-values',
      '2024-01-01T00:00:00Z|2024-01-03T00:00:00Z'
    );
  });

  it('passes the time filter through to the chart renderer', () => {
    mockSoc.mockReturnValueOnce({
      data: [
        { ts: '2024-01-01T00:00:00Z', value: 10 },
        { ts: '2024-01-02T00:00:00Z', value: 40 },
        { ts: '2024-01-03T00:00:00Z', value: 10 },
      ],
      isLoading: false,
    });

    render(<DashboardChartRenderer chartId="soc-history" ctx={CTX} height={300} timeFilter="1h" />);

    expect(screen.getByTestId('rich-chart').getAttribute('data-time-filter')).toBe('1h');
  });
});

// ── Hook mocks ────────────────────────────────────────────────────────────────
const mockSoc = vi.fn(() => ({
  data: [{ ts: '2024-01-01T00:00:00Z', value: 79 }],
  isLoading: false,
}));
const mockRange = vi.fn(() => ({
  data: [{ ts: '2024-01-01T00:00:00Z', value: 210 }],
  isLoading: false,
}));
const mockChargingChartSeries = vi.fn(() => ({
  data: {
    daily: [
      {
        day_local: '2024-01-01',
        day_start: '2024-01-01T00:00:00Z',
        total_energy_kwh: 40,
        session_count: 2,
      },
      {
        day_local: '2024-01-02',
        day_start: '2024-01-02T00:00:00Z',
        total_energy_kwh: 15,
        session_count: 1,
      },
    ],
    daily_sessions: [
      {
        session_id: 's1',
        day_local: '2024-01-01',
        day_start: '2024-01-01T00:00:00Z',
        started_at: '2024-01-01T10:00:00Z',
        energy_added_kwh: 24,
        cost_usd: 2.4,
        charger_type: 'AC',
        location_name: 'Home',
      },
      {
        session_id: 's2',
        day_local: '2024-01-01',
        day_start: '2024-01-01T00:00:00Z',
        started_at: '2024-01-01T17:00:00Z',
        energy_added_kwh: 16,
        cost_usd: 5.6,
        charger_type: 'DC',
        location_name: 'Office',
      },
      {
        session_id: 's3',
        day_local: '2024-01-02',
        day_start: '2024-01-02T00:00:00Z',
        started_at: '2024-01-02T09:00:00Z',
        energy_added_kwh: 15,
        cost_usd: 1.5,
        charger_type: 'AC',
        location_name: 'Home',
      },
    ],
  },
  isLoading: false,
}));
const mockChargeCurve = vi.fn(() => ({
  data: [{ minutes_elapsed: 0, soc_pct: 20, power_kw: 11.5 }],
  isLoading: false,
}));
const mockChargeCurveAnalysis = vi.fn(() => ({
  data: [
    {
      session_id: 's1',
      minutes_elapsed: 0,
      soc_pct: 20,
      charge_rate_kw: 11.5,
      charger_type: 'ac',
      sample_source: 'telemetry',
      power_method: 'soc_delta',
    },
    {
      session_id: 's1',
      minutes_elapsed: 5,
      soc_pct: 70,
      charge_rate_kw: 6.5,
      charger_type: 'ac',
      sample_source: 'telemetry',
      power_method: 'soc_delta',
    },
    {
      session_id: 's2',
      minutes_elapsed: 0,
      soc_pct: 25,
      charge_rate_kw: 150,
      charger_type: 'dc',
      sample_source: 'telemetry',
      power_method: 'soc_delta',
    },
    {
      session_id: 's2',
      minutes_elapsed: 10,
      soc_pct: 80,
      charge_rate_kw: 70,
      charger_type: 'dc',
      sample_source: 'telemetry',
      power_method: 'soc_delta',
    },
  ],
  isLoading: false,
}));
const mockEfficiencyTrend = vi.fn(() => ({
  data: [{ ts: '2024-01-01T08:00:00Z', trip_efficiency_wh_mi: 320, rolling_24h_wh_mi: 315 }],
  isLoading: false,
}));
const mockEfficiencyByMode = vi.fn(() => ({
  data: [
    {
      drive_mode: 'all_purpose',
      avg_efficiency: 318,
      p10_efficiency: 0,
      p90_efficiency: 0,
      trip_count: 5,
    },
  ],
  isLoading: false,
}));
type MockEfficiencyByTagResponse = {
  data: Array<{
    tag_id: string | null;
    tag_name: string;
    trip_count: number;
    total_miles: number;
    efficiency_miles: number;
    avg_efficiency_wh_mi: number | null;
    coverage: number;
  }>;
  isLoading: boolean;
};
const mockEfficiencyByTag = vi.fn<(...args: unknown[]) => MockEfficiencyByTagResponse>(
  (..._args) => ({
    data: [
      {
        tag_id: 'tag-rack',
        tag_name: 'Bike rack',
        trip_count: 4,
        total_miles: 68,
        efficiency_miles: 51,
        avg_efficiency_wh_mi: 325,
        coverage: 0.75,
      },
    ],
    isLoading: false,
  })
);
const mockTripTags = vi.fn<
  (...args: unknown[]) => {
    data: Array<{ id: string; vehicle_id: string; name: string }>;
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<unknown>;
  }
>((..._args) => ({
  data: [{ id: 'tag-rack', vehicle_id: 'vehicle-1', name: 'Bike rack' }],
  isLoading: false,
  isError: false,
  refetch: async () => undefined,
}));
type MockEfficiencyVsTempPoint = {
  temp_c_low: number;
  temp_c_high: number;
  avg_efficiency_wh_mi: number | null;
  trip_count: number;
  total_miles?: number | null;
  avg_speed_mph?: number | null;
};

const mockEfficiencyVsTemp = vi.fn<() => { data: MockEfficiencyVsTempPoint[]; isLoading: boolean }>(
  () => ({
    data: [{ temp_c_low: 15, temp_c_high: 20, avg_efficiency_wh_mi: 300, trip_count: 3 }],
    isLoading: false,
  })
);
const mockPhantomDrainPeriods = vi.fn(() => ({
  data: {
    vehicle_id: 'vehicle-1',
    periods: [
      {
        period_start: '2024-01-01T20:00:00Z',
        period_end: '2024-01-02T08:00:00Z',
        duration_hours: 12,
        sleep_share_pct: 0.9,
        state_coverage_pct: 0.95,
        soc_start: 80,
        soc_end: 77.6,
        soc_lost_pct: 2.4,
        drain_pct_per_hour: 0.2,
        range_start_mi: 260,
        range_end_mi: 252,
        range_lost_mi: 8,
        range_lost_per_hour_mi: 0.67,
        energy_drained_kwh: 3,
        avg_power_w: 250,
        has_reduced_range: false,
        validation_status: 'validated' as const,
        validation_reason: null,
        sample_count: 12,
        start_sample_at: '2024-01-01T20:00:00Z',
        end_sample_at: '2024-01-02T08:00:00Z',
        movement_detected: false,
        overlaps_trip: false,
        overlaps_charge: false,
      },
    ],
  },
  isLoading: false,
}));
const mockDegradation = vi.fn(() => ({
  data: [
    {
      ts: '2024-01-01T00:00:00Z',
      usable_kwh: 120,
      rated_kwh: null,
      capacity_pct: 92,
      odometer_mi: 5000,
    },
  ],
  isLoading: false,
}));
const mockBatteryMileage = vi.fn(
  (): {
    data: Array<{
      ts: string;
      odometer_mi: number | null;
      usable_kwh: number | null;
      range_mi: number | null;
      projected_max_range_mi?: number | null;
      degradation_pct?: number | null;
    }>;
    isLoading: boolean;
  } => ({
    data: [
      { ts: '2024-01-01T00:00:00Z', odometer_mi: 5000, usable_kwh: 120, range_mi: 320 },
    ],
    isLoading: false,
  })
);
const mockFavoriteState = { chart_favorites: {} as Record<string, string> };
const mockDashboardChartFavorites = vi.fn(() => ({ data: mockFavoriteState, isSuccess: true }));
const mockUpdateDashboardChartFavorite = vi.fn(
  ({ key, chartId }: { key: string; chartId: string }) => {
    mockFavoriteState.chart_favorites[key] = chartId;
  }
);
const mockEffectiveCharts = vi.fn(
  (
    _placement: string | null
  ): {
    data: ReturnType<typeof chartRecord>[];
    isSuccess: boolean;
    isLoading: boolean;
    isError: boolean;
  } => ({ data: [], isSuccess: false, isLoading: true, isError: false })
);
const mockUseChartDatasets = vi.fn();

vi.mock('@riviamigo/hooks', () => ({
  useEffectiveCharts: (placement: string | null) => mockEffectiveCharts(placement),
  useChartDatasets: (...args: unknown[]) => mockUseChartDatasets(...args),
  useSocHistory: () => mockSoc(),
  useRangeHistory: () => mockRange(),
  useChargingChartSeries: () => mockChargingChartSeries(),
  useChargeCurve: () => mockChargeCurve(),
  useChargeCurveAnalysis: () => mockChargeCurveAnalysis(),
  useEfficiencyTrend: () => mockEfficiencyTrend(),
  useEfficiencyByMode: () => mockEfficiencyByMode(),
  useEfficiencyByTag: (...args: unknown[]) => mockEfficiencyByTag(...args),
  useEfficiencyVsTemp: () => mockEfficiencyVsTemp(),
  useTripTags: (...args: unknown[]) => mockTripTags(...args),
  usePhantomDrainPeriods: () => mockPhantomDrainPeriods(),
  useDegradation: () => mockDegradation(),
  useBatteryMileage: () => mockBatteryMileage(),
  useTirePressureTimeline: () => ({ data: { samples: [], trips: [] }, isLoading: false }),
  useVehicles: () => ({ data: [] }),
  useDashboardChartFavorites: () => mockDashboardChartFavorites(),
  useUpdateDashboardChartFavorite: () => ({ mutate: mockUpdateDashboardChartFavorite }),
}));

vi.mock('@riviamigo/ui/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/ui/lib/utils')>();
  return { ...actual };
});

vi.mock('@riviamigo/ui/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/ui/charts')>();
  return {
    ...actual,
    CHART_COLORS: {
      accent: '#f97316',
      emerald: '#10b981',
      grid: 'rgba(255,255,255,0.06)',
      muted: '#94a3b8',
    },
    DailyChargeSessionsChart: ({
      daily,
      dailySessions,
      emptyTitle,
      seriesColor,
      yRange,
    }: {
      daily: Array<{ day_local: string; total_energy_kwh: number }>;
      dailySessions: Array<{ session_id: string; day_local: string }>;
      emptyTitle: string;
      seriesColor?: string;
      yRange?: [number, number];
    }) =>
      daily.length > 0 || dailySessions.length > 0 ? (
        <div
          data-testid="daily-charge-sessions-chart"
          data-chart-renderer="daily-charge-sessions"
          data-day-count={String(daily.length)}
          data-session-count={String(dailySessions.length)}
          data-series-color={seriesColor ?? ''}
          data-y-range={yRange?.join('|') ?? ''}
        />
      ) : (
        <div>{emptyTitle}</div>
      ),
    DailyEnergyBarChart: ({
      daily,
      emptyTitle,
      seriesColor,
      yRange,
    }: {
      daily: Array<{ day_local: string; total_energy_kwh: number }>;
      emptyTitle: string;
      seriesColor?: string;
      yRange?: [number, number];
    }) =>
      daily.length > 0 ? (
        <div data-chart-renderer="daily-energy-bars">
          {daily.map((day) => (
            <div
              key={day.day_local}
              data-testid="daily-energy-bar"
              data-series-color={seriesColor ?? ''}
              data-y-range={yRange?.join('|') ?? ''}
            />
          ))}
        </div>
      ) : (
        <div>{emptyTitle}</div>
      ),
    EfficiencyPillBarChart: ({
      data,
      emptyTitle,
    }: {
      data: Array<{
        label: string;
        value: number;
        distance?: number | null;
        speed?: number | null;
        coverage?: number | null;
      }>;
      emptyTitle: string;
    }) =>
      data.length === 0 ? (
        <div>{emptyTitle}</div>
      ) : (
        <div data-testid="efficiency-pill-chart" data-chart-renderer="efficiency-pill-bars">
          {data.map((point) => (
            <div
              key={point.label}
              data-testid="efficiency-pill-label"
              data-distance={point.distance == null ? '' : String(point.distance)}
              data-speed={point.speed == null ? '' : String(point.speed)}
              data-coverage={point.coverage == null ? '' : String(point.coverage)}
            >
              {point.label}
            </div>
          ))}
        </div>
      ),
    RichTimeSeriesChart: ({
      points,
      series,
      emptyTitle,
      timeFilter,
      smoothness,
      xRange,
      xTime,
      yRange,
      yRightRange,
      xSplits,
      height,
      connectGaps,
      yAxisValueFormatter,
      yRightAxisValueFormatter,
      yValueFormatter,
      yUnit,
      rendererId,
    }: {
      points: Array<{ ts: string | number | Date }>;
      series: Array<{
        label: string;
        color?: string;
        mode?: string;
        tooltipOnly?: boolean;
        filterable?: boolean;
        values?: Array<number | null>;
        tooltipDetails?: Array<string | null | undefined>;
        pointSize?: number;
      }>;
      emptyTitle: string;
      timeFilter?: string;
      smoothness?: string;
      xRange?: [number, number];
      xTime?: boolean;
      yRange?: [number, number];
      yRightRange?: [number, number];
      xSplits?: number[];
      height?: number;
      connectGaps?: boolean;
      yAxisValueFormatter?: (value: number | null | undefined, unit?: string) => string;
      yRightAxisValueFormatter?: (value: number | null | undefined, unit?: string) => string;
      yValueFormatter?: (value: number | null | undefined, unit?: string) => string;
      yUnit?: string;
      rendererId?: string;
    }) =>
      points.length === 0 ? (
        <div data-chart-renderer={rendererId ?? 'rich-time-series'}>{emptyTitle}</div>
      ) : (
        <div
          data-testid="rich-chart"
          data-chart-renderer={rendererId ?? 'rich-time-series'}
          data-time-filter={timeFilter ?? 'raw'}
          data-chart-smoothness={smoothness ?? 'gentle'}
          data-series={series.map((item) => item.label).join('|')}
          data-series-filterable={series
            .map((item) => `${item.label}:${item.filterable === false ? 'false' : 'true'}`)
            .join('|')}
          data-series-colors={series.map((item) => `${item.label}:${item.color ?? ''}`).join('|')}
          data-series-modes={series.map((item) => `${item.label}:${item.mode ?? ''}`).join('|')}
          data-series-values={series
            .map(
              (item) => `${item.label}:${item.values?.map((value) => value ?? '').join(',') ?? ''}`
            )
            .join('|')}
          data-tooltip-details={series
            .map((item) => `${item.label}:${item.tooltipDetails?.filter(Boolean).join(',') ?? ''}`)
            .join('|')}
          data-tooltip-only-series={series
            .filter((item) => item.tooltipOnly)
            .map((item) => item.label)
            .join('|')}
          data-x-range={xRange ? xRange.join('|') : ''}
          data-x-time={xTime === false ? 'false' : 'true'}
          data-x-values={points.map((point) => String(point.ts)).join('|')}
          data-x-splits={xSplits?.join('|') ?? ''}
          data-height={height ?? ''}
          data-point-sizes={series.map((item) => `${item.label}:${item.pointSize ?? ''}`).join('|')}
          data-y-range={yRange ? yRange.join('|') : ''}
          data-y-right-range={yRightRange ? yRightRange.join('|') : ''}
          data-connect-gaps={connectGaps ? 'true' : 'false'}
          data-has-y-axis-formatter={yAxisValueFormatter ? 'true' : 'false'}
          data-has-y-right-axis-formatter={yRightAxisValueFormatter ? 'true' : 'false'}
          data-has-y-formatter={yValueFormatter ? 'true' : 'false'}
          data-y-format-sample={yValueFormatter ? yValueFormatter(112.1, yUnit) : ''}
        />
      ),
  };
});

// ── Subject ───────────────────────────────────────────────────────────────────
// Import after mocks are registered.
import {
  buildPhantomDrainDailySeries,
  DashboardChartWidget,
  DashboardChartRenderer,
} from '../../../../packages/dashboards/src/widgets/chart/DashboardChartWidget';

const CTX = {
  vehicleId: 'vehicle-1',
  from: '2024-01-01T00:00:00Z',
  to: '2024-01-31T23:59:59Z',
  chargeSessionId: 'session-1',
};

function makeInstance(chartId: string, showPicker = false) {
  return {
    id: `test-${chartId}`,
    componentType: 'chart' as const,
    definitionId: 'catalog',
    title: chartId,
    layout: { x: 0, y: 0, w: 12, h: 8 },
    options: { chartId, chartIds: [chartId], page: undefined, showPicker },
  };
}

function chartRecord(slug: string) {
  const seed = chartSeeds.find((candidate) => candidate.slug === slug);
  if (!seed) throw new Error(`Missing bundled chart ${slug}`);
  return {
    id: `chart-${seed.slug}`,
    ownerId: null,
    slug: seed.slug,
    name: seed.name,
    description: seed.description,
    isDefault: true,
    isLocked: false,
    isEnabled: true,
    config: seed.definition as ChartDefinitionV1,
  };
}

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

function batteryDefinitionDataset() {
  return {
    sourceBindingId: 'main',
    domain: { kind: 'time' as const, field: 'timestamp', values: ['2024-01-01T00:00:00Z'] },
    fields: {
      timestamp: { kind: 'time' as const, values: ['2024-01-01T00:00:00Z'] },
      usable_kwh: { kind: 'number' as const, values: [120] },
      odometer_miles: { kind: 'number' as const, values: [5000] },
    },
    meta: { sourceId: 'battery.mileage', sampled: false, partial: false, sourcePointCount: 1 },
  };
}

function assignedOverviewInstance() {
  return {
    ...makeInstance('projected-range-mileage', true),
    managed: true,
    managedKey: 'overview.chart-catalog',
    options: {
      chartId: 'projected-range-mileage',
      chartIds: ['projected-range-mileage'],
      page: 'overview' as const,
      showPicker: true,
    },
  };
}

function renderWidget(
  instance: React.ComponentProps<typeof DashboardChartWidget>['instance'],
  ctx: React.ComponentProps<typeof DashboardChartWidget>['ctx'] = CTX
) {
  return render(<DashboardChartWidget instance={instance} ctx={ctx} />);
}

function renderChart(chartId: string) {
  const instance = makeInstance(chartId);
  return renderWidget(instance);
}

function renderedRichChartContract() {
  const chart = screen.getByTestId('rich-chart');
  return Object.fromEntries(
    [...chart.attributes]
      .filter((attribute) => attribute.name.startsWith('data-'))
      .map((attribute) => [attribute.name, attribute.value])
  );
}

// A chart has rendered (has data) when it doesn't show the empty-state div.
function expectChartHasData(emptyTitle: string) {
  expect(screen.queryByText(emptyTitle)).toBeNull();
}

function expectChartEmpty(emptyTitle: string) {
  expect(screen.getByText(emptyTitle)).toBeTruthy();
}

describe('DashboardChartWidget — soc_history', () => {
  it('renders chart when soc data is present', () => {
    renderChart('soc-history');
    expectChartHasData('No state of charge history for this period');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toBe(
      'State of Charge|Active Range'
    );
    expect(screen.getByTestId('rich-chart').getAttribute('data-tooltip-only-series')).toBe(
      'Active Range'
    );
  });

  it('shows empty state when no soc data', () => {
    mockSoc.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('soc-history');
    expectChartEmpty('No state of charge history for this period');
  });
});

describe('DashboardChartWidget — legacy range_history', () => {
  it('resolves saved range history selections to the combined SoC chart', () => {
    renderChart('range-history');
    expectChartHasData('No state of charge history for this period');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toBe(
      'State of Charge|Active Range'
    );
  });
});

describe('DashboardChartWidget — charge_level', () => {
  it('renders chart when session data is present', () => {
    renderChart('charge-level');
    expectChartHasData('No charge level data for this period');
  });

  it('shows empty state when no sessions', () => {
    mockSoc.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('charge-level');
    expectChartEmpty('No charge level data for this period');
  });
});

describe('DashboardChartWidget — charging_sessions_energy', () => {
  it('renders chart when session data is present', () => {
    renderChart('charging-sessions-energy');
    expectChartHasData('No charging sessions for this period');
    expect(screen.getByTestId('daily-charge-sessions-chart').getAttribute('data-day-count')).toBe(
      '2'
    );
    expect(
      screen.getByTestId('daily-charge-sessions-chart').getAttribute('data-session-count')
    ).toBe('3');
  });

  it('shows empty state when no sessions', () => {
    mockChargingChartSeries.mockReturnValueOnce({
      data: { daily: [], daily_sessions: [] },
      isLoading: false,
    });
    renderChart('charging-sessions-energy');
    expectChartEmpty('No charging sessions for this period');
  });

  it('forwards edited color and fixed range through the established sessions renderer', () => {
    const definition = structuredClone(getBundledChartDefinition('charging-sessions-energy')!);
    definition.series[0]!.color = { mode: 'token', token: 'emerald' };
    definition.axes.y.domain = { mode: 'fixed', min: 2, max: 42 };
    render(
      <DashboardChartRenderer
        chartId="charging-sessions-energy"
        managedDefinition={definition}
        ctx={CTX}
        height={320}
      />
    );
    expect(screen.getByTestId('daily-charge-sessions-chart')).toHaveAttribute(
      'data-series-color',
      'var(--rm-chart-emerald)'
    );
    expect(screen.getByTestId('daily-charge-sessions-chart')).toHaveAttribute(
      'data-y-range',
      '2|42'
    );
  });
});

describe('DashboardChartWidget — charging_weekly_energy', () => {
  it('renders chart when daily data is present', () => {
    renderChart('charging-weekly-energy');
    expectChartHasData('No charging energy for this period');
    expect(screen.getAllByTestId('daily-energy-bar')).toHaveLength(2);
  });

  it('forwards edited color and fixed range through the established energy renderer', () => {
    const definition = structuredClone(getBundledChartDefinition('charging-weekly-energy')!);
    definition.series[0]!.color = { mode: 'token', token: 'emerald' };
    definition.axes.y.domain = { mode: 'fixed', min: 1, max: 81 };
    render(
      <DashboardChartRenderer
        chartId="charging-weekly-energy"
        managedDefinition={definition}
        ctx={CTX}
        height={320}
      />
    );
    const bars = screen.getAllByTestId('daily-energy-bar');
    expect(bars[0]).toHaveAttribute('data-series-color', 'var(--rm-chart-emerald)');
    expect(bars[0]).toHaveAttribute('data-y-range', '1|81');
  });

  it('shows empty state when no daily data', () => {
    mockChargingChartSeries.mockReturnValueOnce({
      data: { daily: [], daily_sessions: [] },
      isLoading: false,
    });
    renderChart('charging-weekly-energy');
    expectChartEmpty('No charging energy for this period');
  });
});

describe('ChargeSessionCurveDetail', () => {
  it('keeps the selected-session trace outside the managed chart catalog', () => {
    render(<ChargeSessionCurveDetail ctx={CTX} height={300} />);
    expectChartHasData('No charging curve is available for this session');
  });

  it('shows empty state when the session has no curve data', () => {
    mockChargeCurve.mockReturnValueOnce({ data: [], isLoading: false });
    render(<ChargeSessionCurveDetail ctx={CTX} height={300} />);
    expectChartEmpty('No charging curve is available for this session');
  });
});

describe('DashboardChartWidget — charging_curve_analysis', () => {
  it('renders cross-session charge curve analysis data', () => {
    renderChart('charging-curve-analysis');
    expectChartHasData('No charging curve history is available for this period');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toContain(
      'Observed trend'
    );
    expect(screen.getByRole('button', { name: 'Switch to Best observed' })).toHaveTextContent(
      'Trend: Observed'
    );
    expect(screen.getByTestId('rich-chart').getAttribute('data-tooltip-details')).toContain(
      'SoC/time estimate'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-x-range', '0|100');
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-x-splits',
      '0|10|20|30|40|50|60|70|80|90|100'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-point-sizes',
      expect.stringContaining('Verified DC sessions:6')
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series-colors',
      expect.stringContaining('Verified DC sessions:#f97316')
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series-colors',
      expect.stringContaining('Verified DC sessions:#10b981')
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute(
      'data-series-modes',
      expect.stringContaining('Observed trend:line')
    );
    expect(screen.getByTestId('rich-chart').getAttribute('data-tooltip-details')).toContain(
      '25 SoC; SoC/time estimate'
    );
  });

  it('cycles the in-chart trend overlay through observed, best, and off without changing chart height', () => {
    renderChart('charging-curve-analysis');
    const chart = screen.getByTestId('rich-chart');
    const initialHeight = chart.getAttribute('data-height');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Best observed' }));

    expect(screen.getByRole('button', { name: 'Switch to Off' })).toHaveTextContent(
      'Trend: Best observed'
    );
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toContain(
      'Best observed trend (P75)'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-height', initialHeight ?? '');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Off' }));
    expect(screen.getByRole('button', { name: 'Switch to Observed' })).toHaveTextContent(
      'Trend: Off'
    );
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).not.toContain('trend');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toContain(
      'Verified DC sessions'
    );
    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-height', initialHeight ?? '');
  });

  it('keeps every raw session point while fitting observed and best local-regression trends', () => {
    mockChargeCurveAnalysis.mockReturnValueOnce({
      data: [
        {
          session_id: 'slow',
          minutes_elapsed: 0,
          soc_pct: 20,
          charge_rate_kw: 100,
          charger_type: 'dc',
          sample_source: 'telemetry',
          power_method: 'soc_delta',
        },
        {
          session_id: 'slow',
          minutes_elapsed: 1,
          soc_pct: 21,
          charge_rate_kw: 96,
          charger_type: 'dc',
          sample_source: 'telemetry',
          power_method: 'soc_delta',
        },
        {
          session_id: 'slow',
          minutes_elapsed: 2,
          soc_pct: 22,
          charge_rate_kw: 92,
          charger_type: 'dc',
          sample_source: 'telemetry',
          power_method: 'soc_delta',
        },
        {
          session_id: 'fast',
          minutes_elapsed: 0,
          soc_pct: 20,
          charge_rate_kw: 200,
          charger_type: 'dc',
          sample_source: 'telemetry',
          power_method: 'recorded',
        },
        {
          session_id: 'fast',
          minutes_elapsed: 1,
          soc_pct: 21,
          charge_rate_kw: 190,
          charger_type: 'dc',
          sample_source: 'telemetry',
          power_method: 'recorded',
        },
        {
          session_id: 'fast',
          minutes_elapsed: 2,
          soc_pct: 22,
          charge_rate_kw: 180,
          charger_type: 'dc',
          sample_source: 'telemetry',
          power_method: 'recorded',
        },
        {
          session_id: 'fast',
          minutes_elapsed: 3,
          soc_pct: 23,
          charge_rate_kw: 170,
          charger_type: 'dc',
          sample_source: 'telemetry',
          power_method: 'recorded',
        },
      ],
      isLoading: false,
    });
    renderChart('charging-curve-analysis');

    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toContain(
      'Verified DC sessions'
    );
    const observedTrend = screen
      .getByTestId('rich-chart')
      .getAttribute('data-series-values')
      ?.split('|')
      .find((series) => series.startsWith('Observed trend:'));
    expect(observedTrend?.split(':')[1]?.split(',').filter(Boolean)).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Best observed' }));
    const bestTrend = screen
      .getByTestId('rich-chart')
      .getAttribute('data-series-values')
      ?.split('|')
      .find((series) => series.startsWith('Best observed trend (P75):'));
    expect(bestTrend?.split(':')[1]).not.toBe(observedTrend?.split(':')[1]);
  });

  it('uses spaced x-axis labels on mobile', () => {
    setMatchMedia(true);
    renderChart('charging-curve-analysis');

    expect(screen.getByTestId('rich-chart')).toHaveAttribute('data-x-splits', '0|20|40|60|80|100');
  });

  it('shows empty state when no curve-analysis data exists', () => {
    mockChargeCurveAnalysis.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('charging-curve-analysis');
    expectChartEmpty('No charging curve history is available for this period');
  });

  it('keeps fallback samples visible when the source is approximate historical curve data', () => {
    mockChargeCurveAnalysis.mockReturnValueOnce({
      data: [
        {
          session_id: 's9',
          minutes_elapsed: 0,
          soc_pct: 18,
          charge_rate_kw: 160,
          charger_type: 'dc',
          sample_source: 'rivian_charge_curve_points',
          power_method: 'recorded',
        },
        {
          session_id: 's9',
          minutes_elapsed: 5,
          soc_pct: 42,
          charge_rate_kw: 120,
          charger_type: 'dc',
          sample_source: 'rivian_charge_curve_points',
          power_method: 'recorded',
        },
      ],
      isLoading: false,
    });

    renderChart('charging-curve-analysis');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toContain(
      'Estimated history'
    );
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toContain(
      'Observed trend'
    );
  });
});

describe('DashboardChartWidget — efficiency_trend', () => {
  it('renders chart when trend data is present', () => {
    renderChart('efficiency-trend');
    expectChartHasData('No efficiency data for this period');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toBe(
      'Trip efficiency|24-hour avg'
    );
  });

  it('shows empty state when no trend data', () => {
    mockEfficiencyTrend.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('efficiency-trend');
    expectChartEmpty('No efficiency data for this period');
  });
});

describe('DashboardChartWidget — efficiency_temperature', () => {
  it('renders chart when temp data is present', () => {
    renderChart('efficiency-temperature');
    expectChartHasData('No outside-temperature telemetry is available for this range yet');
  });

  it('sorts temperature buckets from highest to lowest', () => {
    mockEfficiencyVsTemp.mockReturnValueOnce({
      data: [
        { temp_c_low: 0, temp_c_high: 5, avg_efficiency_wh_mi: 330, trip_count: 1 },
        { temp_c_low: 20, temp_c_high: 25, avg_efficiency_wh_mi: 290, trip_count: 2 },
        { temp_c_low: 10, temp_c_high: 15, avg_efficiency_wh_mi: 310, trip_count: 3 },
      ],
      isLoading: false,
    });

    renderChart('efficiency-temperature');

    expect(screen.getAllByTestId('efficiency-pill-label').map((node) => node.textContent)).toEqual([
      formatTemp(20),
      formatTemp(10),
      formatTemp(0),
    ]);
  });

  it('drops buckets without efficiency values and preserves rounded distance and speed metadata', () => {
    mockEfficiencyVsTemp.mockReturnValueOnce({
      data: [
        {
          temp_c_low: 0,
          temp_c_high: 5,
          avg_efficiency_wh_mi: null,
          trip_count: 1,
          total_miles: 4.4,
          avg_speed_mph: 20.1,
        },
        {
          temp_c_low: 20,
          temp_c_high: 25,
          avg_efficiency_wh_mi: 290,
          trip_count: 2,
          total_miles: 7.6,
          avg_speed_mph: 31.2,
        },
        {
          temp_c_low: 10,
          temp_c_high: 15,
          avg_efficiency_wh_mi: 310,
          trip_count: 3,
          total_miles: 12.2,
          avg_speed_mph: null,
        },
      ],
      isLoading: false,
    });

    renderChart('efficiency-temperature');

    const rows = screen.getAllByTestId('efficiency-pill-label');
    expect(rows.map((node) => node.textContent)).toEqual([formatTemp(20), formatTemp(10)]);
    expect(rows[0]?.getAttribute('data-distance')).toBe('8');
    expect(rows[0]?.getAttribute('data-speed')).toBe('31.2');
    expect(rows[1]?.getAttribute('data-distance')).toBe('12');
    expect(rows[1]?.getAttribute('data-speed')).toBe('');
  });

  it('shows empty state when no temp data', () => {
    mockEfficiencyVsTemp.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('efficiency-temperature');
    expectChartEmpty('No outside-temperature telemetry is available for this range yet');
  });
});

describe('DashboardChartWidget — efficiency_mode', () => {
  it('renders chart when mode data is present', () => {
    renderChart('efficiency-mode');
    expectChartHasData('No drive mode efficiency data for this period');
  });

  it('shows empty state when no mode data', () => {
    mockEfficiencyByMode.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('efficiency-mode');
    expectChartEmpty('No drive mode efficiency data for this period');
  });
});

describe('DashboardChartWidget — efficiency_tags', () => {
  it('renders tag labels with trip distance and efficiency coverage', () => {
    renderChart('efficiency-tags');

    const row = screen.getByTestId('efficiency-pill-label');
    expect(row).toHaveTextContent('Bike rack');
    expect(row).toHaveAttribute('data-distance', '68');
    expect(row).toHaveAttribute('data-coverage', '0.75');
  });

  it('keeps the untagged cohort visible when tags exist', () => {
    mockEfficiencyByTag.mockReturnValueOnce({
      data: [
        {
          tag_id: null,
          tag_name: 'Untagged',
          trip_count: 2,
          total_miles: 30,
          efficiency_miles: 30,
          avg_efficiency_wh_mi: 310,
          coverage: 1,
        },
      ],
      isLoading: false,
    });
    renderChart('efficiency-tags');
    expect(screen.getByTestId('efficiency-pill-label')).toHaveTextContent('Untagged');
  });

  it('uses the same selected tag cohort for the by-tag chart hook', () => {
    const filter = { tagIds: ['tag-bike', 'tag-rack'], tagMatch: 'any' as const, untagged: false };
    renderWidget(makeInstance('efficiency-tags'), { ...CTX, tripTagFilter: filter });
    expect(mockEfficiencyByTag).toHaveBeenLastCalledWith(CTX.vehicleId, CTX.from, CTX.to, filter);
  });

  it('keeps no-tag onboarding ahead of a synthetic untagged API row', () => {
    mockTripTags.mockReturnValueOnce({
      data: [],
      isLoading: false,
      isError: false,
      refetch: async () => undefined,
    });
    mockEfficiencyByTag.mockReturnValueOnce({
      data: [
        {
          tag_id: null,
          tag_name: 'Untagged',
          trip_count: 2,
          total_miles: 30,
          efficiency_miles: 30,
          avg_efficiency_wh_mi: 310,
          coverage: 1,
        },
      ],
      isLoading: false,
    });
    renderWidget(makeInstance('efficiency-tags'), { ...CTX, canManageTripTags: true });
    expect(screen.getByText(/Create one with the Tags filter above/i)).toBeTruthy();
    expect(screen.queryByTestId('efficiency-pill-chart')).toBeNull();
  });

  it('offers recovery when the shared tag catalog cannot be loaded', () => {
    mockTripTags.mockReturnValueOnce({
      data: [],
      isLoading: false,
      isError: true,
      refetch: async () => undefined,
    });
    renderChart('efficiency-tags');
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn’t load shared tags/i);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('explains a filtered empty cohort without discarding the selected filters', () => {
    mockEfficiencyByTag.mockReturnValueOnce({ data: [], isLoading: false });
    renderWidget(makeInstance('efficiency-tags'), {
      ...CTX,
      tripTagFilter: { tagIds: ['tag-rack'], tagMatch: 'all', untagged: false },
    });
    expect(screen.getByText(/No trips match these tag filters/i)).toBeTruthy();
  });
});

describe('DashboardChartWidget — phantom_drain', () => {
  it('renders chart when drain data is present', () => {
    renderChart('phantom-drain');
    expectChartHasData('No phantom drain data for this period');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toBe(
      'Drain session 1|Daily average rate|Parked|Drain sessions'
    );
    expect(screen.getByTestId('rich-chart').getAttribute('data-tooltip-only-series')).toBe(
      'Daily average rate|Parked|Drain sessions'
    );
  });

  it('shows empty state when no drain data', () => {
    mockPhantomDrainPeriods.mockReturnValueOnce({
      data: { vehicle_id: 'vehicle-1', periods: [] },
      isLoading: false,
    });
    renderChart('phantom-drain');
    expectChartEmpty('No phantom drain data for this period');
  });
});

describe('buildPhantomDrainDailySeries', () => {
  const basePeriod = mockPhantomDrainPeriods().data.periods[0]!;

  it('keeps a same-day daily bar equal to the table rate', () => {
    const period = {
      ...basePeriod,
      period_start: '2024-01-03T08:00:00Z',
      period_end: '2024-01-03T16:00:00Z',
      duration_hours: 8,
      soc_lost_pct: 4,
      drain_pct_per_hour: 0.5,
    };

    const [point] = buildPhantomDrainDailySeries([period]);

    expect(point?.drainRate).toBeCloseTo(period.drain_pct_per_hour);
    expect(point?.parkedHours).toBeCloseTo(period.duration_hours);
    expect(point?.socLost).toBeCloseTo(period.soc_lost_pct);
  });

  it('splits a parked period across local days and preserves its duration-weighted drain rate', () => {
    const period = basePeriod;
    const points = buildPhantomDrainDailySeries([period]);

    expect(points.length).toBeGreaterThan(1);
    expect(points.reduce((sum, point) => sum + point.parkedHours, 0)).toBeCloseTo(12);
    expect(points.reduce((sum, point) => sum + point.socLost, 0)).toBeCloseTo(2.4);
    points.forEach((point) => expect(point.drainRate).toBeCloseTo(0.2));
  });

  it('aggregates multiple same-day periods into one daily bar', () => {
    const periods = [
      {
        ...basePeriod,
        period_start: '2024-01-04T08:00:00Z',
        period_end: '2024-01-04T14:00:00Z',
        duration_hours: 6,
        soc_lost_pct: 3,
        drain_pct_per_hour: 0.5,
      },
      {
        ...basePeriod,
        period_start: '2024-01-04T16:00:00Z',
        period_end: '2024-01-04T18:00:00Z',
        duration_hours: 2,
        soc_lost_pct: 2,
        drain_pct_per_hour: 1,
      },
    ];

    const [point] = buildPhantomDrainDailySeries(periods);

    expect(point?.periodCount).toBe(2);
    expect(point?.parkedHours).toBeCloseTo(8);
    expect(point?.socLost).toBeCloseTo(5);
    expect(point?.drainRate).toBeCloseTo(0.625);
  });

  it('ignores excluded periods and malformed period boundaries', () => {
    const excluded = { ...basePeriod, validation_status: 'excluded' as const };
    const malformed = { ...basePeriod, period_start: 'not-a-date' };

    expect(buildPhantomDrainDailySeries([excluded, malformed])).toEqual([]);
  });
});

describe('DashboardChartWidget — battery_degradation', () => {
  it('renders chart when degradation data is present', () => {
    renderChart('battery-degradation');
    expectChartHasData('No battery health history recorded yet');
  });

  it('shows empty state when no degradation data', () => {
    mockDegradation.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('battery-degradation');
    expectChartEmpty('No battery health history recorded yet');
  });
});

describe('DashboardChartWidget — battery_capacity_mileage', () => {
  it('renders chart when mileage data is present', () => {
    renderChart('battery-capacity-mileage');
    expectChartHasData('No battery capacity mileage data recorded yet');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toBe(
      'Usable Capacity|Mileage'
    );
    expect(screen.getByTestId('rich-chart').getAttribute('data-series-modes')).toBe(
      'Usable Capacity:area|Mileage:line'
    );
    expect(screen.getByTestId('rich-chart').getAttribute('data-y-range')).toBe('0|132');
    expect(screen.getByTestId('rich-chart').getAttribute('data-connect-gaps')).toBe('true');
    expect(screen.getByTestId('rich-chart').getAttribute('data-has-y-axis-formatter')).toBe('true');
    expect(screen.getByTestId('rich-chart').getAttribute('data-has-y-right-axis-formatter')).toBe(
      'true'
    );
  });

  it('uses decimal battery-capacity labels when whole numbers would collapse distinct values', () => {
    mockBatteryMileage.mockReturnValueOnce({
      data: [
        { ts: '2024-01-01T00:00:00Z', odometer_mi: 14500, usable_kwh: 111.6, range_mi: 320 },
        { ts: '2024-01-02T00:00:00Z', odometer_mi: 15000, usable_kwh: 111.8, range_mi: 321 },
        { ts: '2024-01-03T00:00:00Z', odometer_mi: 15500, usable_kwh: 112.1, range_mi: 322 },
      ],
      isLoading: false,
    });

    renderChart('battery-capacity-mileage');

    expect(screen.getByTestId('rich-chart').getAttribute('data-has-y-formatter')).toBe('true');
    expect(screen.getByTestId('rich-chart').getAttribute('data-y-format-sample')).toBe('112.1 kWh');
  });

  it('keeps whole-number battery-capacity labels when integer precision remains meaningful', () => {
    mockBatteryMileage.mockReturnValueOnce({
      data: [
        { ts: '2024-01-01T00:00:00Z', odometer_mi: 14500, usable_kwh: 108, range_mi: 300 },
        { ts: '2024-01-02T00:00:00Z', odometer_mi: 15000, usable_kwh: 112.1, range_mi: 315 },
        { ts: '2024-01-03T00:00:00Z', odometer_mi: 15500, usable_kwh: 116, range_mi: 330 },
      ],
      isLoading: false,
    });

    renderChart('battery-capacity-mileage');

    expect(screen.getByTestId('rich-chart').getAttribute('data-has-y-formatter')).toBe('true');
    expect(screen.getByTestId('rich-chart').getAttribute('data-y-format-sample')).toBe('112 kWh');
  });

  it('shows empty state when no mileage data', () => {
    mockBatteryMileage.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('battery-capacity-mileage');
    expectChartEmpty('No battery capacity mileage data recorded yet');
  });

  it('uses zero through the observed maximum for the automatic y-axis', () => {
    expect(getBatteryCapacityMileageYRange([null, 111.6, 112.1, 110.8])).toEqual([0, 124]);
    expect(getBatteryCapacityMileageYRange([0])).toEqual([0, 1]);
    expect(getBatteryCapacityMileageYRange([])).toBeUndefined();
  });
});

describe('DashboardChartWidget — projected_range_mileage', () => {
  it('renders chart when mileage data is present', () => {
    renderChart('projected-range-mileage');
    expectChartHasData('No projected range mileage data recorded yet');
    expect(screen.getByTestId('rich-chart').getAttribute('data-connect-gaps')).toBe('true');
  });

  it('shows empty state when no mileage data', () => {
    mockBatteryMileage.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('projected-range-mileage');
    expectChartEmpty('No projected range mileage data recorded yet');
  });

  it('rounds the projected range axis to 200 and the next 25-mile step', () => {
    expect(getProjectedRangeMileageYRange([null, 334, 333.4, 328])).toEqual([200, 350]);
  });
});

describe('DashboardChartWidget — unknown chart id', () => {
  it('shows unknown chart error for unrecognised id', () => {
    // DashboardChartWidget falls back to a valid chart when the id is unrecognised.
    // Test DashboardChartRenderer directly to verify the error path.
    render(<DashboardChartRenderer chartId="does-not-exist" ctx={CTX} height={300} />);
    expect(screen.getByText(/unknown chart/i)).toBeTruthy();
  });
});
