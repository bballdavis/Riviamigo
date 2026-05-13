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
    useBatteryHealth: () => ({ data: metricMocks.batteryHealth, isLoading: false }),
    useChargingSummary: () => ({ data: null, isLoading: false }),
    useCurrentVehicleStatus: () => ({ data: null, isLoading: false }),
    useMetricCatalog: () => ({ data: [] }),
  };
});

import { DashboardRenderer } from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';

function config(
  showSprite: boolean,
  accentBorder = false,
  options: Record<string, unknown> = {}
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
        definitionId: 'total_miles',
        title: 'Total Miles',
        options: {
          metric: 'total_miles',
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
  });

  it('renders the sprite as a bottom background layer when enabled', () => {
    render(
      <DashboardRenderer
        config={config(true)}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-07' }}
      />
    );

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
      <DashboardRenderer
        config={config(true, false, { curveSmoothing: 0 })}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-07' }}
      />
    );

    const layer = screen.getByTestId('sensor-sprite-layer');
    const path = layer.querySelector('path');
    expect(layer.querySelector('[data-sparkline-curve="straight"]')).not.toBeNull();
    expect(path?.getAttribute('d')).not.toContain('C');
  });

  it('applies the configured curve color', () => {
    render(
      <DashboardRenderer
        config={config(true, false, { curveColor: 'sky' })}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-07' }}
      />
    );

    const path = screen.getByTestId('sensor-sprite-layer').querySelector('path');
    expect(path).toHaveAttribute('stroke', '#60A5FA');
  });

  it('hides the sprite when disabled and applies the orange border option independently', () => {
    render(
      <DashboardRenderer
        config={config(false, true)}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-07' }}
      />
    );

    expect(screen.queryByTestId('sensor-sprite-layer')).not.toBeInTheDocument();
    expect(screen.getByTestId('sensor-chip')).toHaveClass('border-accent/60');
  });

  it('keeps a visible sprite for sparse live data', () => {
    metricMocks.series = [];

    render(
      <DashboardRenderer
        config={config(true)}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-07' }}
      />
    );

    const layer = screen.getByTestId('sensor-sprite-layer');
    expect(layer.querySelector('[data-sparkline-state="single"]')).not.toBeNull();
    expect(layer.querySelectorAll('path, rect').length).toBeGreaterThan(0);
  });

  it('shows an empty sprite state when both series and value are missing', () => {
    metricMocks.value = { ...metricMocks.value, value: null };
    metricMocks.series = [];

    render(
      <DashboardRenderer
        config={config(true)}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-07' }}
      />
    );

    const layer = screen.getByTestId('sensor-sprite-layer');
    expect(layer.querySelector('[data-sparkline-state="empty"]')).not.toBeNull();
    expect(layer.querySelectorAll('path, rect').length).toBeGreaterThan(0);
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
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-07' }}
      />
    );

    expect(screen.getByText('Usable Capacity')).toBeInTheDocument();
    expect(screen.getByText('(now/new)')).toBeInTheDocument();
    expect(screen.getByText('111.6 kWh')).toHaveClass('text-fg');
    expect(screen.getByText('/109.0 kWh')).toHaveClass('text-fg-tertiary');
  });
});
