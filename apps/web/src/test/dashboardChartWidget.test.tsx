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
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

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

// ── Hook mocks ────────────────────────────────────────────────────────────────
const mockSoc = vi.fn(() => ({ data: [{ ts: '2024-01-01T00:00:00Z', value: 79 }], isLoading: false }));
const mockRange = vi.fn(() => ({ data: [{ ts: '2024-01-01T00:00:00Z', value: 210 }], isLoading: false }));
const mockChargeSessions = vi.fn(() => ({
  data: {
    items: [
      {
        id: 's1', started_at: '2024-01-01T10:00:00Z', ended_at: '2024-01-01T11:00:00Z',
        soc_start: 30, soc_end: 85, energy_added_kwh: 40,
      },
    ],
    total: 1, page: 1, per_page: 25, total_pages: 1,
  },
  isLoading: false,
}));
const mockChargingSummary = vi.fn(() => ({
  data: {
    total_energy_kwh: 200, total_cost_usd: 20, session_count: 5, home_kwh: 150, away_kwh: 50,
    ac_kwh: 80, dc_kwh: 120, charging_cycles: null, charging_efficiency_pct: null,
    total_energy_used_kwh: null, max_charge_limit_pct: null, max_charge_rate_kw: null,
    typed_session_count: 5,
    weekly: [{ week_start: '2024-01-01T00:00:00Z', energy_kwh: 40, sessions: 2 }],
  },
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
const mockEfficiencyVsTemp = vi.fn(() => ({
  data: [{ temp_c_low: 15, temp_c_high: 20, avg_efficiency_wh_mi: 300, trip_count: 3 }],
  isLoading: false,
}));
const mockPhantomDrain = vi.fn(() => ({
  data: [{ day: '2024-01-01', total_soc_lost: 2.1, avg_drain_rate: 0.1, hours_parked: 20 }],
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
  useSocHistory: (...args: unknown[]) => mockSoc(...args),
  useRangeHistory: (...args: unknown[]) => mockRange(...args),
  useChargeSessions: (...args: unknown[]) => mockChargeSessions(...args),
  useChargingSummary: (...args: unknown[]) => mockChargingSummary(...args),
  useEfficiencyTrend: (...args: unknown[]) => mockEfficiencyTrend(...args),
  useEfficiencyByMode: (...args: unknown[]) => mockEfficiencyByMode(...args),
  useEfficiencyVsTemp: (...args: unknown[]) => mockEfficiencyVsTemp(...args),
  usePhantomDrain: (...args: unknown[]) => mockPhantomDrain(...args),
  useDegradation: (...args: unknown[]) => mockDegradation(...args),
  useBatteryMileage: (...args: unknown[]) => mockBatteryMileage(...args),
}));

vi.mock('@riviamigo/ui/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/ui/lib/utils')>();
  return { ...actual };
});

// ── Subject ───────────────────────────────────────────────────────────────────
// Import after mocks are registered.
import { DashboardChartWidget, DashboardChartRenderer } from '../../../../packages/dashboards/src/widgets/chart/DashboardChartWidget';

const CTX = { vehicleId: 'vehicle-1', from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' };

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

function renderChart(chartId: string) {
  const instance = makeInstance(chartId);
  return render(<DashboardChartWidget instance={instance} ctx={CTX} />);
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
    expectChartHasData('No battery level history for this period');
  });

  it('shows empty state when no soc data', () => {
    mockSoc.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('soc-history');
    expectChartEmpty('No battery level history for this period');
  });
});

describe('DashboardChartWidget — range_history', () => {
  it('renders chart when range data is present', () => {
    renderChart('range-history');
    expectChartHasData('No range history for this period');
  });

  it('shows empty state when no range data', () => {
    mockRange.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('range-history');
    expectChartEmpty('No range history for this period');
  });
});

describe('DashboardChartWidget — charge_level', () => {
  it('renders chart when session data is present', () => {
    renderChart('charge-level');
    expectChartHasData('No charge level data for this period');
  });

  it('shows empty state when no sessions', () => {
    mockChargeSessions.mockReturnValueOnce({ data: { items: [], total: 0, page: 1, per_page: 25, total_pages: 0 }, isLoading: false });
    renderChart('charge-level');
    expectChartEmpty('No charge level data for this period');
  });
});

describe('DashboardChartWidget — charging_sessions_energy', () => {
  it('renders chart when session data is present', () => {
    renderChart('charging-sessions-energy');
    expectChartHasData('No charging sessions for this period');
  });

  it('shows empty state when no sessions', () => {
    mockChargeSessions.mockReturnValueOnce({ data: { items: [], total: 0, page: 1, per_page: 25, total_pages: 0 }, isLoading: false });
    renderChart('charging-sessions-energy');
    expectChartEmpty('No charging sessions for this period');
  });
});

describe('DashboardChartWidget — charging_weekly_energy', () => {
  it('renders chart when weekly data is present', () => {
    renderChart('charging-weekly-energy');
    expectChartHasData('No charging energy for this period');
  });

  it('shows empty state when no weekly data', () => {
    mockChargingSummary.mockReturnValueOnce({
      data: { weekly: [], total_energy_kwh: 0, total_cost_usd: 0, session_count: 0, home_kwh: 0, away_kwh: 0, ac_kwh: 0, dc_kwh: 0, charging_cycles: null, charging_efficiency_pct: null, total_energy_used_kwh: null, max_charge_limit_pct: null, max_charge_rate_kw: null, typed_session_count: 0 },
      isLoading: false,
    });
    renderChart('charging-weekly-energy');
    expectChartEmpty('No charging energy for this period');
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
  });

  it('shows empty state when no drain data', () => {
    mockPhantomDrain.mockReturnValueOnce({ data: [], isLoading: false });
    renderChart('phantom-drain');
    expectChartEmpty('No phantom drain data for this period');
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
});

describe('DashboardChartWidget — unknown chart id', () => {
  it('shows unknown chart error for unrecognised id', () => {
    // DashboardChartWidget falls back to a valid chart when the id is unrecognised.
    // Test DashboardChartRenderer directly to verify the error path.
    render(<DashboardChartRenderer chartId="does-not-exist" ctx={CTX} height={300} />);
    expect(screen.getByText(/unknown chart/i)).toBeTruthy();
  });
});
