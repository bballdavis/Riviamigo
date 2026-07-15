import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const metricMocks = vi.hoisted(() => ({
  value: {
    metric: 'total_miles',
    value: 12345 as number | null,
    unit: 'mi' as string | null,
    label: 'Total Miles',
    ts: '2026-05-07T00:00:00Z' as string | null,
  },
  series: [
    { ts: '2026-05-01T00:00:00Z', value: 10 },
    { ts: '2026-05-02T00:00:00Z', value: 18 },
    { ts: '2026-05-03T00:00:00Z', value: 14 },
  ] as Array<{ ts: string; value: number | null }>,
  metricSeriesCalls: [] as Array<{
    vehicleId: string | null;
    metric: string | null;
    from: string | null;
    to: string | null;
  }>,
  metricBatchCalls: [] as Array<{ vehicleId: string | null; metric: string | null; from: string | null; to: string | null }>,
  batteryHealth: null as null | {
    usable_now_kwh: number | null;
    usable_new_kwh: number | null;
    battery_health_pct: number | null;
    estimated_degradation_pct: number | null;
    charging_cycles: number | null;
    charge_count: number;
    total_energy_added_kwh: number | null;
    total_energy_used_kwh: number | null;
    charging_efficiency_pct: number | null;
  },
  chargingSummary: null as null | {
    session_count: number;
    total_energy_kwh: number | null;
    total_cost_usd: number | null;
    home_kwh: number | null;
    away_kwh: number | null;
    unknown_location_kwh: number | null;
    ac_kwh: number | null;
    dc_kwh: number | null;
    charging_cycles: number | null;
    charging_efficiency_pct: number | null;
    max_charge_rate_kw: number | null;
    max_charge_limit_pct: number | null;
  },
  efficiencySummary: {
    avg: 200,
    p10: 180,
    p90: 220,
    total_miles: 120,
    efficiency_miles: 120,
    coverage_percent: 100,
  } as null | {
    avg: number;
    p10: number;
    p90: number;
    total_miles: number;
    efficiency_miles: number;
    coverage_percent: number;
  },
  vehicleStatus: null as null | Record<string, unknown>,
}));

vi.mock('@riviamigo/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/hooks')>();
  return {
    ...actual,
    useMetricValue: () => ({
      data: metricMocks.value,
    }),
    useMetricSeries: (
      vehicleId: string | null,
      metric: string | null,
      from: string | null,
      to: string | null
    ) => {
      metricMocks.metricSeriesCalls.push({ vehicleId, metric, from, to });
      return { data: metricMocks.series };
    },
    useMetricBatch: (vehicleId: string | null, metrics: Array<{ metric?: string }> | undefined, from: string | null, to: string | null) => {
      metricMocks.metricBatchCalls.push({ vehicleId, metric: metrics?.[0]?.metric ?? null, from, to });
      return {
        data: {
          values: [metricMocks.value],
          series: [{ metric: metricMocks.value.metric, points: metricMocks.series }],
          bucket: 'day',
          max_points: 96,
        },
        isFetching: false,
      };
    },
    useEfficiencySummary: () => ({ data: metricMocks.efficiencySummary, isLoading: false }),
    useBatteryHealth: () => ({ data: metricMocks.batteryHealth, isLoading: false }),
    useChargingSummary: () => ({ data: metricMocks.chargingSummary, isLoading: false }),
    useCurrentVehicleStatus: () => ({ data: metricMocks.vehicleStatus, isLoading: false }),
    useMetricCatalog: () => ({ data: [] }),
  };
});

import { DashboardRenderer } from '@riviamigo/dashboards';
import { MiniSparkline } from '@riviamigo/ui/charts';
import type { DashboardConfig } from '@riviamigo/dashboards';

const defaultCtx = {
  vehicleId: 'vehicle-1',
  timeframe: {
    kind: 'custom' as const,
    from: new Date('2026-05-01T00:00:00Z'),
    to: new Date('2026-05-07T00:00:00Z'),
  },
  from: '2026-05-01',
  to: '2026-05-07',
};

function config(
  showSprite: boolean,
  accentBorder = false,
  options: Record<string, unknown> = {},
  definitionId = 'total_miles',
  title = 'Total Miles'
): DashboardConfig {
  return {
    schemaVersion: 2,
    id: '00000000-0000-0000-0000-000000000099',
    slug: 'sensor-test',
    name: 'Sensor Test',
    isDefault: false,
    isLocked: false,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [
      {
        id: 'd9000009-0000-0000-0000-000000000001',
        componentType: 'sensor',
        definitionId,
        title,
        options: {
          metric: definitionId,
          icon: 'route',
          chartType: 'line',
          showSprite,
          accentBorder,
          showSubtitle: false,
          ...options,
        },
        layout: { x: 0, y: 0, w: 3, h: 2 },
      },
    ],
  };
}

describe('dashboard sensor chips', () => {
  beforeEach(() => {
    metricMocks.value = {
      metric: 'total_miles',
      value: 12345,
      unit: 'mi',
      label: 'Total Miles',
      ts: '2026-05-07T00:00:00Z',
    };
    metricMocks.series = [
      { ts: '2026-05-01T00:00:00Z', value: 10 },
      { ts: '2026-05-02T00:00:00Z', value: 18 },
      { ts: '2026-05-03T00:00:00Z', value: 14 },
    ];
    metricMocks.batteryHealth = null;
    metricMocks.chargingSummary = null;
    metricMocks.efficiencySummary = {
      avg: 200,
      p10: 180,
      p90: 220,
      total_miles: 120,
      efficiency_miles: 120,
      coverage_percent: 100,
    };
    metricMocks.vehicleStatus = null;
    metricMocks.metricSeriesCalls = [];
    metricMocks.metricBatchCalls = [];
  });

  it('renders the sprite as a bottom background layer when enabled', () => {
    render(<DashboardRenderer config={config(true)} ctx={defaultCtx} />);

    const layer = screen.getByTestId('sensor-sprite-layer');
    expect(layer).toHaveClass('absolute');
    expect(layer).toHaveStyle({ bottom: '0px', left: '0px', right: '0px' });
    expect(layer.querySelector('canvas')).not.toBeNull();
    expect(layer.querySelector('[data-sparkline-renderer="canvas"]')).not.toBeNull();
    expect(layer.querySelector('[data-sparkline-filter="24h"]')).not.toBeNull();
    expect(screen.queryByText('miles per day')).not.toBeInTheDocument();
  });

  it('allows line sprite filtering to be disabled', () => {
    render(
      <DashboardRenderer config={config(true, false, { timeFilter: 'raw' })} ctx={defaultCtx} />
    );

    const layer = screen.getByTestId('sensor-sprite-layer');
    expect(layer.querySelector('[data-sparkline-filter="raw"]')).not.toBeNull();
    expect(layer.querySelector('canvas')).not.toBeNull();
  });

  it('records the selected timestamp filter on the sprite renderer', () => {
    const { unmount } = render(
      <MiniSparkline
        data={metricMocks.series}
        type="line"
        timeFilter="15m"
        height={36}
      />
    );

    const lowFilter = document.querySelector('[data-sparkline-state="series"]');
    expect(lowFilter).toHaveAttribute('data-sparkline-filter', '15m');

    unmount();

    render(
      <MiniSparkline
        data={metricMocks.series}
        type="line"
        timeFilter="7d"
        height={36}
      />
    );

    const highFilter = document.querySelector('[data-sparkline-state="series"]');
    expect(highFilter).toHaveAttribute('data-sparkline-filter', '7d');
    expect(highFilter?.querySelector('canvas')).not.toBeNull();
  });

  it('keeps a raw timestamp filter available for sparse data', () => {
    render(
      <MiniSparkline
        data={[
          { ts: '2026-05-01T00:00:00Z', value: 10 },
          { ts: '2026-05-02T00:00:00Z', value: 18 },
        ]}
        type="line"
        timeFilter="raw"
        height={36}
      />
    );

    const sparkline = document.querySelector('[data-sparkline-state="series"]');
    expect(sparkline).toHaveAttribute('data-sparkline-filter', 'raw');
    expect(sparkline?.querySelector('canvas')).not.toBeNull();
  });

  it('applies the configured curve color', () => {
    render(
      <DashboardRenderer config={config(true, false, { curveColor: 'sky' })} ctx={defaultCtx} />
    );

    expect(screen.getByTestId('sensor-sprite-layer').querySelector('canvas')).not.toBeNull();
  });

  it('hides the sprite when disabled and applies the orange border option independently', () => {
    render(<DashboardRenderer config={config(false, true)} ctx={defaultCtx} />);

    expect(screen.queryByTestId('sensor-sprite-layer')).not.toBeInTheDocument();
    expect(screen.getByTestId('sensor-chip')).toHaveClass('border-accent/60');
  });

  it('shows an empty sprite state for sparse bounded range data instead of falling back to latest', () => {
    metricMocks.series = [];

    render(<DashboardRenderer config={config(true)} ctx={defaultCtx} />);

    const layer = screen.getByTestId('sensor-sprite-layer');
    expect(layer.querySelector('[data-sparkline-state="empty"]')).not.toBeNull();
    expect(layer.querySelectorAll('path, rect').length).toBeGreaterThan(0);
  });

  it('keeps a visible sprite for sparse lifetime data', () => {
    metricMocks.series = [];

    render(
      <DashboardRenderer
        config={config(true)}
        ctx={{
          vehicleId: 'vehicle-1',
          timeframe: { kind: 'lifetime' },
          from: null,
          to: null,
        }}
      />
    );

    const layer = screen.getByTestId('sensor-sprite-layer');
    expect(layer.querySelector('[data-sparkline-state="single"]')).not.toBeNull();
    expect(layer.querySelector('canvas')).not.toBeNull();
  });

  it('shows an empty sprite state when both series and value are missing', () => {
    metricMocks.value = { ...metricMocks.value, value: null };
    metricMocks.series = [];

    render(<DashboardRenderer config={config(true)} ctx={defaultCtx} />);

    const layer = screen.getByTestId('sensor-sprite-layer');
    expect(layer.querySelector('[data-sparkline-state="empty"]')).not.toBeNull();
    expect(layer.querySelectorAll('path, rect').length).toBeGreaterThan(0);
  });

  it('shows the weighted avg efficiency value instead of the latest series point', () => {
    metricMocks.value = {
      metric: 'avg_efficiency',
      value: 200,
      unit: 'Wh/mi',
      label: 'Avg Efficiency',
      ts: '2026-05-07T00:00:00Z',
    };
    metricMocks.series = [
      { ts: '2026-05-01T00:00:00Z', value: 1000 },
      { ts: '2026-05-02T00:00:00Z', value: 330 },
      { ts: '2026-05-03T00:00:00Z', value: 999 },
    ];

    render(
      <DashboardRenderer
        config={config(true, false, {}, 'avg_efficiency', 'Avg Efficiency')}
        ctx={defaultCtx}
      />
    );

    expect(screen.getByText('5.0 mi/kWh')).toBeInTheDocument();
    expect(screen.queryByText('1.0 mi/kWh')).not.toBeInTheDocument();
  });

  it('uses the server-calculated range value instead of the latest gross-efficiency bucket', () => {
    metricMocks.value = {
      metric: 'avg_gross_efficiency',
      value: 333,
      unit: 'Wh/mi',
      label: 'Avg Gross Efficiency',
      ts: '2026-05-07T00:00:00Z',
    };
    metricMocks.series = [
      { ts: '2026-05-01T00:00:00Z', value: 8 },
      { ts: '2026-05-02T00:00:00Z', value: null },
      { ts: '2026-05-03T00:00:00Z', value: 13 },
      { ts: '2026-05-04T00:00:00Z', value: null },
      { ts: '2026-05-05T00:00:00Z', value: 31 },
    ];

    render(
      <DashboardRenderer
        config={config(true, false, {}, 'avg_gross_efficiency', 'Avg Gross Efficiency')}
        ctx={defaultCtx}
      />
    );

    expect(screen.getByText('3.0 mi/kWh')).toBeInTheDocument();
    expect(screen.queryByText('32.3 mi/kWh')).not.toBeInTheDocument();
  });

  it('uses the server-calculated range value instead of the latest temperature bucket', () => {
    metricMocks.value = {
      metric: 'avg_outside_temp_c',
      value: 20,
      unit: 'C',
      label: 'Avg Outside Temp',
      ts: '2026-05-07T00:00:00Z',
    };
    metricMocks.series = [
      { ts: '2026-05-01T00:00:00Z', value: 55 },
      { ts: '2026-05-02T00:00:00Z', value: 48 },
      { ts: '2026-05-03T00:00:00Z', value: null },
      { ts: '2026-05-04T00:00:00Z', value: 62 },
      { ts: '2026-05-05T00:00:00Z', value: null },
    ];

    render(
      <DashboardRenderer
        config={config(true, false, {}, 'avg_outside_temp_c', 'Avg Outside Temp')}
        ctx={defaultCtx}
      />
    );

    expect(screen.getByText('68 F')).toBeInTheDocument();
    expect(screen.queryByText('62')).not.toBeInTheDocument();
  });

  it('renders consumption coverage with covered and total miles plus an accessible explanation', () => {
    metricMocks.efficiencySummary = {
      avg: 400,
      p10: 300,
      p90: 500,
      total_miles: 1211.2,
      efficiency_miles: 1199.5,
      coverage_percent: 99,
    };

    render(
      <DashboardRenderer
        config={config(false, false, {}, 'efficiency_coverage', 'Consumption Data Coverage')}
        ctx={defaultCtx}
      />
    );

    expect(screen.getByText('99%')).toBeInTheDocument();
    expect(screen.getByText('1,200 mi / 1,211 mi')).toBeInTheDocument();

    fireEvent.focus(screen.getByRole('button', { name: 'Consumption Data Coverage help' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Share of miles in this range');
  });

  it('explains the distance-weighted average and its data coverage', () => {
    metricMocks.value = {
      metric: 'avg_efficiency',
      value: 400,
      unit: 'Wh/mi',
      label: 'Avg Efficiency',
      ts: '2026-05-07T00:00:00Z',
    };
    metricMocks.efficiencySummary = {
      avg: 400,
      p10: 300,
      p90: 500,
      total_miles: 1211.2,
      efficiency_miles: 1199.5,
      coverage_percent: 99,
    };

    render(<DashboardRenderer config={config(false, false, {}, 'avg_efficiency', 'Avg Consumption')} ctx={defaultCtx} />);

    fireEvent.focus(screen.getByRole('button', { name: 'Avg Consumption help' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Total estimated battery energy used ÷ miles driven');
    expect(screen.getByRole('tooltip')).toHaveTextContent('1,200 mi of 1,211 mi');
  });

  it('passes bounded timeframe bounds into metric series for latest-mode sensor chips', () => {
    metricMocks.value = {
      metric: 'avg_outside_temp_c',
      value: 999,
      unit: null,
      label: 'Avg Outside Temp',
      ts: '2026-05-07T00:00:00Z',
    };
    metricMocks.series = [
      { ts: '2026-05-01T00:00:00Z', value: null },
      { ts: '2026-05-02T00:00:00Z', value: 57 },
      { ts: '2026-05-03T00:00:00Z', value: 63 },
    ];

    render(
      <DashboardRenderer
        config={config(true, false, {}, 'avg_outside_temp_c', 'Avg Outside Temp')}
        ctx={{
          ...defaultCtx,
          from: '2026-04-22',
          to: '2026-04-23',
          timeframe: {
            kind: 'custom',
            from: new Date('2026-04-22T00:00:00Z'),
            to: new Date('2026-04-23T00:00:00Z'),
          },
        }}
      />
    );

    const call = metricMocks.metricBatchCalls.at(-1);
    expect(call).toEqual({
      vehicleId: 'vehicle-1',
      metric: 'avg_outside_temp_c',
      from: '2026-04-22',
      to: '2026-04-23',
    });
  });

  it('renders composite sensor language without changing the compact chip visual', () => {
    metricMocks.batteryHealth = {
      usable_now_kwh: 111.6,
      usable_new_kwh: 109.0,
      battery_health_pct: 102.4,
      estimated_degradation_pct: 0,
      charging_cycles: 18,
      charge_count: 22,
      total_energy_added_kwh: 1800,
      total_energy_used_kwh: 1900,
      charging_efficiency_pct: 94.4,
    };

    render(
      <DashboardRenderer
        config={{
          ...config(false),
          widgets: [
            {
              id: 'd9000009-0000-0000-0000-000000000002',
              componentType: 'sensor',
              definitionId: 'usable_capacity',
              title: 'Usable Capacity',
              options: {},
              layout: { x: 0, y: 0, w: 3, h: 2 },
            },
          ],
        }}
        ctx={defaultCtx}
      />
    );

    expect(screen.getByText('Usable Capacity')).toBeInTheDocument();
    expect(screen.getByText('(now/new)')).toBeInTheDocument();
    expect(screen.getByText('111.6 kWh')).toHaveClass('text-fg');
    expect(screen.getByText('/109.0 kWh')).toHaveClass('text-fg-tertiary');
  });

  it('renders battery charge cycles inline with the charge count', () => {
    metricMocks.batteryHealth = {
      usable_now_kwh: 111.6,
      usable_new_kwh: 109.0,
      battery_health_pct: 102.4,
      estimated_degradation_pct: 0,
      charging_cycles: 16,
      charge_count: 45,
      total_energy_added_kwh: 1800,
      total_energy_used_kwh: 1900,
      charging_efficiency_pct: 94.4,
    };

    render(
      <DashboardRenderer
        config={{
          ...config(false),
          widgets: [
            {
              id: 'd9000009-0000-0000-0000-000000000018',
              componentType: 'sensor',
              definitionId: 'charge_count',
              title: 'Charges',
              options: {},
              layout: { x: 0, y: 0, w: 3, h: 2 },
            },
          ],
        }}
        ctx={defaultCtx}
      />
    );

    const value = screen.getByText('45');
    const cycles = screen.getByText('(16 cycles)');
    expect(cycles.parentElement).toBe(value.parentElement);
    expect(screen.queryByText('16 cycles')).not.toBeInTheDocument();
  });

  it('shows lifetime badges only on lifetime battery cards', () => {
    metricMocks.batteryHealth = {
      usable_now_kwh: 111.6,
      usable_new_kwh: 109.0,
      battery_health_pct: 102.4,
      estimated_degradation_pct: 0,
      charging_cycles: 18,
      charge_count: 22,
      total_energy_added_kwh: 1800,
      total_energy_used_kwh: 1900,
      charging_efficiency_pct: 94.4,
    };

    render(
      <DashboardRenderer
        config={{
          ...config(false),
          widgets: [
            {
              id: 'd9000009-0000-0000-0000-000000000010',
              componentType: 'sensor',
              definitionId: 'battery_health_pct',
              title: 'Battery Health',
              options: {},
              layout: { x: 0, y: 0, w: 3, h: 2 },
            },
            {
              id: 'd9000009-0000-0000-0000-000000000011',
              componentType: 'sensor',
              definitionId: 'estimated_degradation_pct',
              title: 'Estimated Degradation',
              options: {},
              layout: { x: 3, y: 0, w: 3, h: 2 },
            },
            {
              id: 'd9000009-0000-0000-0000-000000000012',
              componentType: 'sensor',
              definitionId: 'usable_capacity',
              title: 'Usable Capacity',
              options: {},
              layout: { x: 6, y: 0, w: 3, h: 2 },
            },
            {
              id: 'd9000009-0000-0000-0000-000000000013',
              componentType: 'sensor',
              definitionId: 'max_range',
              title: 'Max Range',
              options: {},
              layout: { x: 9, y: 0, w: 3, h: 2 },
            },
            {
              id: 'd9000009-0000-0000-0000-000000000014',
              componentType: 'sensor',
              definitionId: 'charge_count',
              title: 'Charges',
              options: {},
              layout: { x: 0, y: 2, w: 3, h: 2 },
            },
            {
              id: 'd9000009-0000-0000-0000-000000000015',
              componentType: 'sensor',
              definitionId: 'charging_cycles_health',
              title: 'Charging Cycles',
              options: {},
              layout: { x: 3, y: 2, w: 3, h: 2 },
            },
            {
              id: 'd9000009-0000-0000-0000-000000000016',
              componentType: 'sensor',
              definitionId: 'battery_energy_added',
              title: 'Energy Added',
              options: {},
              layout: { x: 6, y: 2, w: 3, h: 2 },
            },
            {
              id: 'd9000009-0000-0000-0000-000000000017',
              componentType: 'sensor',
              definitionId: 'battery_charge_efficiency',
              title: 'Charge Efficiency',
              options: {},
              layout: { x: 9, y: 2, w: 3, h: 2 },
            },
          ],
        }}
        ctx={defaultCtx}
      />
    );

    expect(screen.queryByText('Current')).not.toBeInTheDocument();
    expect(screen.getAllByText('Lifetime')).toHaveLength(4);
  });

  it('folds unknown charging energy into away for the home share chip', () => {
    metricMocks.chargingSummary = {
      session_count: 6,
      total_energy_kwh: 240,
      total_cost_usd: 48,
      home_kwh: 180,
      away_kwh: 60,
      unknown_location_kwh: 20,
      ac_kwh: 120,
      dc_kwh: 120,
      charging_cycles: 4,
      charging_efficiency_pct: 92.5,
      max_charge_rate_kw: 164.2,
      max_charge_limit_pct: 85,
    };

    render(
      <DashboardRenderer
        config={{
          ...config(false),
          widgets: [
            {
              id: 'd9000009-0000-0000-0000-000000000003',
              componentType: 'sensor',
              definitionId: 'charging_home_share',
              title: 'Home Charging',
              options: {},
              layout: { x: 0, y: 0, w: 3, h: 2 },
            },
          ],
        }}
        ctx={defaultCtx}
      />
    );

    expect(screen.getByText('69%')).toBeInTheDocument();
    expect(screen.getByText('Home 180.0 kWh / Away 80.0 kWh')).toBeInTheDocument();
  });

  it('renders a shared unavailable chip for never-seen vehicle status fields', () => {
    metricMocks.vehicleStatus = {
      service_mode: null,
      field_availability: {
        service_mode: {
          ever_seen: false,
          last_seen_at: null,
          latest_event_at: '2026-05-07T00:00:00Z',
          availability: 'never_seen',
          reason_code: 'never_seen',
        },
      },
    };

    render(
      <DashboardRenderer
        config={config(false, false, {}, 'service_mode', 'Service Mode')}
        ctx={defaultCtx}
      />
    );

    expect(screen.getByTestId('sensor-unavailable-chip')).toHaveTextContent('Unavailable');
  });

  it('shows historical vehicle status values with a last-updated line', () => {
    metricMocks.vehicleStatus = {
      gear_guard_locked: true,
      field_availability: {
        gear_guard_locked: {
          ever_seen: true,
          last_seen_at: '2026-05-05T12:15:00Z',
          latest_event_at: '2026-05-07T00:00:00Z',
          availability: 'historical',
          reason_code: 'missing_recent_payload',
        },
        gear_guard_video_status: {
          ever_seen: false,
          last_seen_at: null,
          latest_event_at: '2026-05-07T00:00:00Z',
          availability: 'never_seen',
          reason_code: 'never_seen',
        },
      },
    };

    render(
      <DashboardRenderer
        config={config(false, false, {}, 'gear_guard_locked', 'Gear Guard')}
        ctx={defaultCtx}
      />
    );

    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText(/Last updated/)).toBeInTheDocument();
  });

  it('renders composite window status when at least one field is current', () => {
    metricMocks.vehicleStatus = {
      window_fl_closed: true,
      window_fr_closed: false,
      window_rl_closed: true,
      window_rr_closed: true,
      field_availability: {
        window_fl_closed: {
          ever_seen: true,
          last_seen_at: '2026-05-07T00:00:00Z',
          latest_event_at: '2026-05-07T00:00:00Z',
          availability: 'current',
          reason_code: null,
        },
        window_fr_closed: {
          ever_seen: true,
          last_seen_at: '2026-05-07T00:00:00Z',
          latest_event_at: '2026-05-07T00:00:00Z',
          availability: 'current',
          reason_code: null,
        },
        window_rl_closed: {
          ever_seen: true,
          last_seen_at: '2026-05-06T22:00:00Z',
          latest_event_at: '2026-05-07T00:00:00Z',
          availability: 'historical',
          reason_code: 'missing_recent_payload',
        },
        window_rr_closed: {
          ever_seen: true,
          last_seen_at: '2026-05-06T22:00:00Z',
          latest_event_at: '2026-05-07T00:00:00Z',
          availability: 'historical',
          reason_code: 'missing_recent_payload',
        },
      },
    };

    render(
      <DashboardRenderer
        config={config(false, false, {}, 'window_status', 'Windows')}
        ctx={defaultCtx}
      />
    );

    expect(screen.getByText('1 open')).toBeInTheDocument();
  });
});
