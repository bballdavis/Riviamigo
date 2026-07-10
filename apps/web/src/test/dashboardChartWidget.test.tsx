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
import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatTemp } from '@riviamigo/ui/lib/utils';
import { getProjectedRangeMileageYRange } from '../../../../packages/dashboards/src/widgets/chart/DashboardChartWidget';

const originalMatchMedia = window.matchMedia;

function setMatchMedia(mobile = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (_query: string) => ({
      matches: mobile,
      media: '(max-width: 639px)',
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
  it('shows smoothing settings without a chart picker and reveals the slider after toggle-on', () => {
    const instance = {
      ...makeInstance('soc-history', false),
      options: {
        chartId: 'soc-history',
        chartIds: ['soc-history'],
        page: undefined,
        showPicker: false,
        curveSmoothing: 0,
      },
    };

    render(<DashboardChartWidget instance={instance} ctx={CTX} />);
    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('slider')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const slider = screen.getByRole('slider');
    expect(slider).toBeTruthy();
    expect(slider.getAttribute('value')).toBe('0.05');
    expect(screen.queryByLabelText('Time minimum')).toBeNull();
  });

  it('uses a bottom-sheet layout on mobile viewports', () => {
    setMatchMedia(true);
    renderChart('soc-history');

    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    const dialog = screen.getByRole('dialog', { name: /chart settings/i });
    expect(dialog.className).toContain('inset-x-2');
    expect(dialog.className).toContain('bottom-2');
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

    expect(screen.getByTestId('rich-chart').getAttribute('data-x-range')).toBe('1000|9000');
  });

  it('persists per-chart manual ranges through the edit-mode widget seam', () => {
    const updateWidgetOptions = vi.fn();
    const editCtx = { ...CTX, updateWidgetOptions };

    renderWidget(makeInstance('projected-range-mileage'), editCtx);

    fireEvent.click(screen.getByRole('button', { name: /chart settings/i }));

    const axisCard = screen.getByText('Projected max range').closest('div.rounded-lg');
    expect(axisCard).toBeTruthy();
    fireEvent.click(within(axisCard as HTMLElement).getByRole('button', { name: 'Manual' }));
    fireEvent.change(screen.getByLabelText('Projected max range minimum'), { target: { value: '240' } });
    fireEvent.change(screen.getByLabelText('Projected max range maximum'), { target: { value: '360' } });

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
      }),
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

describe('DashboardChartRenderer - smoothing data flow', () => {
  it('passes the smoothing amount through to the chart renderer', () => {
    mockSoc.mockReturnValueOnce({
      data: [
        { ts: '2024-01-01T00:00:00Z', value: 10 },
        { ts: '2024-01-02T00:00:00Z', value: 40 },
        { ts: '2024-01-03T00:00:00Z', value: 10 },
      ],
      isLoading: false,
    });

    render(<DashboardChartRenderer chartId="soc-history" ctx={CTX} height={300} smoothing={1} />);

    expect(screen.getByTestId('rich-chart').getAttribute('data-smoothing')).toBe('1');
  });
});

// ── Hook mocks ────────────────────────────────────────────────────────────────
const mockSoc = vi.fn(() => ({ data: [{ ts: '2024-01-01T00:00:00Z', value: 79 }], isLoading: false }));
const mockRange = vi.fn(() => ({ data: [{ ts: '2024-01-01T00:00:00Z', value: 210 }], isLoading: false }));
const mockChargingChartSeries = vi.fn(() => ({
  data: {
    daily: [
      { day_local: '2024-01-01', day_start: '2024-01-01T00:00:00Z', total_energy_kwh: 40, session_count: 2 },
      { day_local: '2024-01-02', day_start: '2024-01-02T00:00:00Z', total_energy_kwh: 15, session_count: 1 },
    ],
    daily_sessions: [
      {
        session_id: 's1', day_local: '2024-01-01', day_start: '2024-01-01T00:00:00Z',
        started_at: '2024-01-01T10:00:00Z', energy_added_kwh: 24, charger_type: 'AC', location_name: 'Home',
      },
      {
        session_id: 's2', day_local: '2024-01-01', day_start: '2024-01-01T00:00:00Z',
        started_at: '2024-01-01T17:00:00Z', energy_added_kwh: 16, charger_type: 'DC', location_name: 'Office',
      },
      {
        session_id: 's3', day_local: '2024-01-02', day_start: '2024-01-02T00:00:00Z',
        started_at: '2024-01-02T09:00:00Z', energy_added_kwh: 15, charger_type: 'AC', location_name: 'Home',
      },
    ],
  },
  isLoading: false,
}));
const mockChargeCurve = vi.fn(() => ({ data: [{ minutes_elapsed: 0, soc_pct: 20, power_kw: 11.5 }], isLoading: false }));
const mockChargeCurveAnalysis = vi.fn(() => ({
  data: [
    { session_id: 's1', minutes_elapsed: 0, soc_pct: 20, charge_rate_kw: 11.5, charger_type: 'ac', sample_source: 'telemetry' },
    { session_id: 's1', minutes_elapsed: 5, soc_pct: 70, charge_rate_kw: 6.5, charger_type: 'ac', sample_source: 'telemetry' },
    { session_id: 's2', minutes_elapsed: 0, soc_pct: 25, charge_rate_kw: 150, charger_type: 'dc', sample_source: 'telemetry' },
    { session_id: 's2', minutes_elapsed: 10, soc_pct: 80, charge_rate_kw: 70, charger_type: 'dc', sample_source: 'telemetry' },
  ],
  isLoading: false,
}));
const mockEfficiencyTrend = vi.fn(() => ({
  data: [{ day: '2024-01-01', day_avg_wh_mi: 320, rolling_7d_wh_mi: 315 }],
  isLoading: false,
}));
const mockEfficiencyByMode = vi.fn(() => ({
  data: [{ drive_mode: 'all_purpose', avg_efficiency: 318, p10_efficiency: 0, p90_efficiency: 0, trip_count: 5 }],
  isLoading: false,
}));
type MockEfficiencyVsTempPoint = {
  temp_c_low: number;
  temp_c_high: number;
  avg_efficiency_wh_mi: number | null;
  trip_count: number;
  total_miles?: number | null;
  avg_speed_mph?: number | null;
};

const mockEfficiencyVsTemp = vi.fn<() => { data: MockEfficiencyVsTempPoint[]; isLoading: boolean }>(() => ({
  data: [{ temp_c_low: 15, temp_c_high: 20, avg_efficiency_wh_mi: 300, trip_count: 3 }],
  isLoading: false,
}));
const mockPhantomDrainPeriods = vi.fn(() => ({
  data: {
    vehicle_id: 'vehicle-1',
    periods: [{
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
    }],
  },
  isLoading: false,
}));
const mockDegradation = vi.fn(() => ({
  data: [{ ts: '2024-01-01T00:00:00Z', usable_kwh: 120, rated_kwh: null, capacity_pct: 92, odometer_mi: 5000 }],
  isLoading: false,
}));
const mockBatteryMileage = vi.fn(() => ({
  data: [{ ts: '2024-01-01T00:00:00Z', odometer_mi: 5000, usable_kwh: 120, range_mi: 320 }],
  isLoading: false,
}));

vi.mock('@riviamigo/hooks', () => ({
  useSocHistory: () => mockSoc(),
  useRangeHistory: () => mockRange(),
  useChargingChartSeries: () => mockChargingChartSeries(),
  useChargeCurve: () => mockChargeCurve(),
  useChargeCurveAnalysis: () => mockChargeCurveAnalysis(),
  useEfficiencyTrend: () => mockEfficiencyTrend(),
  useEfficiencyByMode: () => mockEfficiencyByMode(),
  useEfficiencyVsTemp: () => mockEfficiencyVsTemp(),
  usePhantomDrainPeriods: () => mockPhantomDrainPeriods(),
  useDegradation: () => mockDegradation(),
  useBatteryMileage: () => mockBatteryMileage(),
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
    }: {
      daily: Array<{ day_local: string; total_energy_kwh: number }>;
      dailySessions: Array<{ session_id: string; day_local: string }>;
      emptyTitle: string;
    }) =>
      daily.length > 0 || dailySessions.length > 0 ? (
        <div
          data-testid="daily-charge-sessions-chart"
          data-day-count={String(daily.length)}
          data-session-count={String(dailySessions.length)}
        />
      ) : (
        <div>{emptyTitle}</div>
      ),
    EfficiencyPillBarChart: ({
      data,
      emptyTitle,
    }: {
      data: Array<{ label: string; value: number; distance?: number | null; speed?: number | null }>;
      emptyTitle: string;
    }) =>
      data.length === 0 ? (
        <div>{emptyTitle}</div>
      ) : (
        <div data-testid="efficiency-pill-chart">
          {data.map((point) => (
            <div
              key={point.label}
              data-testid="efficiency-pill-label"
              data-distance={point.distance == null ? '' : String(point.distance)}
              data-speed={point.speed == null ? '' : String(point.speed)}
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
      smoothing,
      xRange,
      yRange,
      yRightRange,
      yValueFormatter,
      yUnit,
    }: {
      points: Array<{ ts: string | number | Date }>;
      series: Array<{ label: string; tooltipOnly?: boolean }>;
      emptyTitle: string;
      smoothing?: number;
      xRange?: [number, number];
      yRange?: [number, number];
      yRightRange?: [number, number];
      yValueFormatter?: (value: number | null | undefined, unit?: string) => string;
      yUnit?: string;
    }) =>
      points.length === 0 ? (
        <div>{emptyTitle}</div>
      ) : (
        <div
          data-testid="rich-chart"
          data-smoothing={String(smoothing ?? 0)}
          data-series={series.map((item) => item.label).join('|')}
          data-tooltip-only-series={series.filter((item) => item.tooltipOnly).map((item) => item.label).join('|')}
          data-x-range={xRange ? xRange.join('|') : ''}
          data-y-range={yRange ? yRange.join('|') : ''}
          data-y-right-range={yRightRange ? yRightRange.join('|') : ''}
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

const CTX = { vehicleId: 'vehicle-1', from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z', chargeSessionId: 'session-1' };

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

function renderWidget(instance: ReturnType<typeof makeInstance>, ctx = CTX) {
  return render(<DashboardChartWidget instance={instance} ctx={ctx} />);
}

function renderChart(chartId: string) {
  const instance = makeInstance(chartId);
  return renderWidget(instance);
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
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toBe('State of Charge|Active Range');
    expect(screen.getByTestId('rich-chart').getAttribute('data-tooltip-only-series')).toBe('Active Range');
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
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toBe('State of Charge|Active Range');
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
    expect(screen.getByTestId('daily-charge-sessions-chart').getAttribute('data-day-count')).toBe('2');
    expect(screen.getByTestId('daily-charge-sessions-chart').getAttribute('data-session-count')).toBe('3');
  });

  it('shows empty state when no sessions', () => {
    mockChargingChartSeries.mockReturnValueOnce({ data: { daily: [], daily_sessions: [] }, isLoading: false });
    renderChart('charging-sessions-energy');
    expectChartEmpty('No charging sessions for this period');
  });
});

describe('DashboardChartWidget — charging_weekly_energy', () => {
  it('renders chart when daily data is present', () => {
    renderChart('charging-weekly-energy');
    expectChartHasData('No charging energy for this period');
  });

  it('shows empty state when no daily data', () => {
    mockChargingChartSeries.mockReturnValueOnce({ data: { daily: [], daily_sessions: [] }, isLoading: false });
    renderChart('charging-weekly-energy');
    expectChartEmpty('No charging energy for this period');
  });
});

describe('DashboardChartWidget — charge_session_curve', () => {
  it('renders the selected session charge curve', () => {
    renderChart('charge-session-curve');
    expectChartHasData('No charging curve is available for this session');
  });

  it('shows empty state when the session has no curve data', () => {
    mockChargeCurve.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('charge-session-curve');
    expectChartEmpty('No charging curve is available for this session');
  });
});

describe('DashboardChartWidget — charging_curve_analysis', () => {
  it('renders cross-session charge curve analysis data', () => {
    renderChart('charging-curve-analysis');
    expectChartHasData('No charging curve history is available for this period');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toContain('Smoothed Trend');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).not.toContain('DC Regression');
  });

  it('shows empty state when no curve-analysis data exists', () => {
    mockChargeCurveAnalysis.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('charging-curve-analysis');
    expectChartEmpty('No charging curve history is available for this period');
  });

  it('keeps fallback samples visible when the source is approximate historical curve data', () => {
    mockChargeCurveAnalysis.mockReturnValueOnce({
      data: [
        { session_id: 's9', minutes_elapsed: 0, soc_pct: 18, charge_rate_kw: 160, charger_type: 'dc', sample_source: 'rivian_charge_curve_points' },
        { session_id: 's9', minutes_elapsed: 5, soc_pct: 42, charge_rate_kw: 120, charger_type: 'dc', sample_source: 'rivian_charge_curve_points' },
      ],
      isLoading: false,
    });

    renderChart('charging-curve-analysis');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toContain('Fallback Samples');
  });
});

describe('DashboardChartWidget — efficiency_trend', () => {
  it('renders chart when trend data is present', () => {
    renderChart('efficiency-trend');
    expectChartHasData('No efficiency data for this period');
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
        { temp_c_low: 0, temp_c_high: 5, avg_efficiency_wh_mi: null, trip_count: 1, total_miles: 4.4, avg_speed_mph: 20.1 },
        { temp_c_low: 20, temp_c_high: 25, avg_efficiency_wh_mi: 290, trip_count: 2, total_miles: 7.6, avg_speed_mph: 31.2 },
        { temp_c_low: 10, temp_c_high: 15, avg_efficiency_wh_mi: 310, trip_count: 3, total_miles: 12.2, avg_speed_mph: null },
      ],
      isLoading: false,
    });

    renderChart('efficiency-temperature');

    const rows = screen.getAllByTestId('efficiency-pill-label');
    expect(rows.map((node) => node.textContent)).toEqual([
      formatTemp(20),
      formatTemp(10),
    ]);
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

describe('DashboardChartWidget — phantom_drain', () => {
  it('renders chart when drain data is present', () => {
    renderChart('phantom-drain');
    expectChartHasData('No phantom drain data for this period');
    expect(screen.getByTestId('rich-chart').getAttribute('data-series')).toBe('Drain Rate|SoC Lost|Parked|Periods');
    expect(screen.getByTestId('rich-chart').getAttribute('data-tooltip-only-series')).toBe('SoC Lost|Parked|Periods');
  });

  it('shows empty state when no drain data', () => {
    mockPhantomDrainPeriods.mockReturnValueOnce({ data: { vehicle_id: 'vehicle-1', periods: [] }, isLoading: false });
    renderChart('phantom-drain');
    expectChartEmpty('No phantom drain data for this period');
  });
});

describe('buildPhantomDrainDailySeries', () => {
  it('splits a parked period across local days and preserves its duration-weighted drain rate', () => {
    const period = mockPhantomDrainPeriods().data.periods[0]!;
    const points = buildPhantomDrainDailySeries([period]);

    expect(points.length).toBeGreaterThan(1);
    expect(points.reduce((sum, point) => sum + point.parkedHours, 0)).toBeCloseTo(12);
    expect(points.reduce((sum, point) => sum + point.socLost, 0)).toBeCloseTo(2.4);
    points.forEach((point) => expect(point.drainRate).toBeCloseTo(0.2));
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
});

describe('DashboardChartWidget — projected_range_mileage', () => {
  it('renders chart when mileage data is present', () => {
    renderChart('projected-range-mileage');
    expectChartHasData('No projected range mileage data recorded yet');
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
