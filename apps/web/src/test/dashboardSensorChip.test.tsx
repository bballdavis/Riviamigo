import React from 'react';
import { render, screen } from '@testing-library/react';
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
  } as null | {
    avg: number;
    p10: number;
    p90: number;
    total_miles: number;
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
    useMetricSeries: () => ({
      data: metricMocks.series,
    }),
    useEfficiencySummary: () => ({ data: metricMocks.efficiencySummary, isLoading: false }),
    useBatteryHealth: () => ({ data: metricMocks.batteryHealth, isLoading: false }),
    useChargingSummary: () => ({ data: metricMocks.chargingSummary, isLoading: false }),
    useCurrentVehicleStatus: () => ({ data: metricMocks.vehicleStatus, isLoading: false }),
    useMetricCatalog: () => ({ data: [] }),
  };
});

import { DashboardRenderer } from '@riviamigo/dashboards';
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
    metricMocks.efficiencySummary = { avg: 200, p10: 180, p90: 220, total_miles: 120 };
    metricMocks.vehicleStatus = null;
  });

  it('renders the sprite as a bottom background layer when enabled', () => {
    render(<DashboardRenderer config={config(true)} ctx={defaultCtx} />);

    const layer = screen.getByTestId('sensor-sprite-layer');
    expect(layer).toHaveClass('absolute');
    expect(layer).toHaveStyle({ bottom: '0px', left: '0px', right: '0px' });
    expect(layer.querySelector('svg')).not.toBeNull();
    expect(layer.querySelectorAll('path, rect').length).toBeGreaterThan(0);
    expect(layer.querySelector('[data-sparkline-curve="smooth"]')).not.toBeNull();
    expect(layer.querySelector('path')?.getAttribute('d')).toContain('C');
    expect(screen.queryByText('miles per day')).not.toBeInTheDocument();
  });

  it('allows line sprite smoothing to be disabled', () => {
    render(
      <DashboardRenderer config={config(true, false, { curveSmoothing: 0 })} ctx={defaultCtx} />
    );

    const layer = screen.getByTestId('sensor-sprite-layer');
    const path = layer.querySelector('path');
    expect(layer.querySelector('[data-sparkline-curve="straight"]')).not.toBeNull();
    expect(path?.getAttribute('d')).not.toContain('C');
  });

  it('applies the configured curve color', () => {
    render(
      <DashboardRenderer config={config(true, false, { curveColor: 'sky' })} ctx={defaultCtx} />
    );

    const path = screen.getByTestId('sensor-sprite-layer').querySelector('path');
    expect(path).toHaveAttribute('stroke', '#60A5FA');
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
    expect(layer.querySelectorAll('path, rect').length).toBeGreaterThan(0);
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
