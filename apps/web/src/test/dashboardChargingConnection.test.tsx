import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chargingMocks = vi.hoisted(() => ({
  forcePluggedState: 'Disconnected' as 'Disconnected' | 'Connected' | 'Charging',
  model: 'R1S' as 'R1S' | 'R1T' | 'unknown',
  images: null as null | {
    all: Array<{
      placement: string;
      design: string | null;
      size: string | null;
      resolution: string | null;
      url: string;
    }>;
    side?: { light?: string | null; dark?: string | null } | null;
  },
}));

vi.mock('@riviamigo/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/hooks')>();
  return {
    ...actual,
    useAuth: () => ({ defaultVehicleId: 'vehicle-1' }),
    useCurrentVehicleStatus: () => ({
      data: {
        vehicle_id: 'vehicle-1',
        battery_level: 64,
        range_miles: 188,
        battery_limit: 80,
        power_state: 'ready',
        charger_state: chargingMocks.forcePluggedState,
        charger_status:
          chargingMocks.forcePluggedState === 'Charging'
            ? 'chrgr_sts_connected_charging'
            : chargingMocks.forcePluggedState === 'Connected'
              ? 'chrgr_sts_connected_no_chrg'
              : 'chrgr_sts_not_connected',
        time_to_end_of_charge_min: chargingMocks.forcePluggedState === 'Charging' ? 95 : null,
        speed_mph: 0,
        latitude: null,
        longitude: null,
        is_online: true,
        last_updated: '2026-05-12T12:00:00Z',
      },
    }),
    useVehicles: () => ({ data: [{ id: 'vehicle-1', model: chargingMocks.model, images: chargingMocks.images }] }),
    useMetricCatalog: () => ({ data: [] }),
    useMetricValue: () => ({ data: null }),
    useMetricSeries: () => ({ data: [] }),
    useBatteryHealth: () => ({ data: null, isLoading: false }),
    useEfficiencySummary: () => ({
      data: {
        avg: null,
        p10: null,
        p90: null,
        total_miles: 0,
      },
      isLoading: false,
    }),
    useChargingSummary: () => ({
      data: {
        session_count: 6,
        total_energy_kwh: 240,
        total_cost_usd: 48,
        home_kwh: 180,
        away_kwh: 60,
        ac_kwh: 120,
        dc_kwh: 120,
        charging_cycles: 4,
        charging_efficiency_pct: 92.5,
        max_charge_rate_kw: 164.2,
        max_charge_limit_pct: 85,
      },
    }),
  };
});

import { DashboardRenderer } from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';
import { WidgetEditForm } from '../../../../packages/dashboards/src/editor/WidgetEditForm';

const baseConfig: DashboardConfig = {
  schemaVersion: 2,
  id: 'charging-connection-test',
  slug: 'charging-connection-test',
  name: 'Charging Connection Test',
  isDefault: false,
  isLocked: false,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [
    {
      id: 'd4000004-0000-0000-0000-000000000013',
      componentType: 'custom',
      definitionId: 'charging.connection',
      title: 'Charging Connection',
      options: {},
      layout: { x: 0, y: 0, w: 6, h: 6 },
    },
  ],
};

const swappedConfig: DashboardConfig = {
  ...baseConfig,
  slug: 'charging',
  widgets: [
    {
      id: 'd4000004-0000-0000-0000-000000000013',
      componentType: 'custom',
      definitionId: 'charging.connection',
      title: 'Charging Connection',
      options: { chargingConnectionVisibility: 'plugged' },
      layout: { x: 6, y: 0, w: 6, h: 6 },
    },
    {
      id: 'd4000004-0000-0000-0000-000000000004',
      componentType: 'sensor',
      definitionId: 'charging_avg_session',
      title: 'Avg / Session',
      options: { chargingConnectionVisibility: 'unplugged' },
      layout: { x: 9, y: 2, w: 3, h: 2 },
    },
  ],
};

const mixRowConfig: DashboardConfig = {
  ...baseConfig,
  slug: 'charging',
  widgets: [
    {
      id: 'd4000004-0000-0000-0000-000000000013',
      componentType: 'custom',
      definitionId: 'charging.connection',
      title: 'Charging Connection',
      options: { chargingConnectionVisibility: 'plugged' },
      layout: { x: 6, y: 0, w: 6, h: 6 },
    },
    {
      id: 'd4000004-0000-0000-0000-000000000009',
      componentType: 'sensor',
      definitionId: 'charging_home_share',
      title: 'Home Charging',
      options: {},
      layout: { x: 0, y: 4, w: 3, h: 2 },
    },
    {
      id: 'd4000004-0000-0000-0000-000000000010',
      componentType: 'sensor',
      definitionId: 'charging_dc_share',
      title: 'DC Fast Charging',
      options: {},
      layout: { x: 3, y: 4, w: 3, h: 2 },
    },
  ],
};

const vehicleImageFixtures = {
  all: [
    { placement: 'side', design: 'light', size: 'large', resolution: '@3x', url: '/rivian/side-light.webp' },
    { placement: 'side', design: 'dark', size: 'large', resolution: '@3x', url: '/rivian/side-dark.webp' },
    { placement: 'side-charging', design: 'light', size: 'large', resolution: '@3x', url: '/rivian/side-charging-light.webp' },
    { placement: 'side-charging', design: 'dark', size: 'large', resolution: '@3x', url: '/rivian/side-charging-dark.webp' },
  ],
  side: {
    light: '/rivian/side-light.webp',
    dark: '/rivian/side-dark.webp',
  },
};

const vehicleImageUrlOnlyChargingFixtures = {
  all: [
    { placement: 'side', design: 'light', size: 'large', resolution: '@3x', url: '/rivian/side-light.webp' },
    { placement: 'side', design: 'dark', size: 'large', resolution: '@3x', url: '/rivian/side-dark.webp' },
    { placement: 'side', design: 'light', size: 'large', resolution: '@3x', url: '/rivian/r1s_side-charging_light_large.webp' },
    { placement: 'side', design: 'dark', size: 'large', resolution: '@3x', url: '/rivian/r1s_side-charging_dark_large.webp' },
  ],
  side: {
    light: '/rivian/side-light.webp',
    dark: '/rivian/side-dark.webp',
  },
};

const packagedDemoR1TChargingFixtures = {
  all: [
    { placement: 'side', design: 'light', size: 'large', resolution: 'hdpi', url: '/vehicle-images/fixtures/r1t/r1t_side_light.webp' },
    { placement: 'side', design: 'dark', size: 'large', resolution: 'hdpi', url: '/vehicle-images/fixtures/r1t/r1t_side_dark.webp' },
    { placement: 'side-charging', design: 'light', size: 'large', resolution: 'hdpi', url: '/vehicle-images/fixtures/r1t/r1t_side-charging_light.webp' },
    { placement: 'side-charging', design: 'dark', size: 'large', resolution: 'hdpi', url: '/vehicle-images/fixtures/r1t/r1t_side-charging_dark.webp' },
  ],
  side: {
    light: '/vehicle-images/fixtures/r1t/r1t_side_light.webp',
    dark: '/vehicle-images/fixtures/r1t/r1t_side_dark.webp',
  },
};

describe('charging connection custom widget', () => {
  beforeEach(() => {
    chargingMocks.forcePluggedState = 'Disconnected';
    chargingMocks.model = 'R1S';
    chargingMocks.images = null;
  });

  it('does not render until the vehicle is plugged in', () => {
    render(
      <DashboardRenderer
        config={baseConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.queryByTestId('charging-connection-chip')).toBeNull();
  });

  it('swaps to fallback charging stats when the connection chip is hidden', () => {
    render(
      <DashboardRenderer
        config={swappedConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.queryByTestId('charging-connection-chip')).toBeNull();
    expect(screen.getByTestId('sensor-chip')).toBeInTheDocument();
    expect(screen.getByText('Avg / Session')).toBeInTheDocument();
  });

  it('swaps to the connection chip when the vehicle is plugged in', () => {
    chargingMocks.forcePluggedState = 'Connected';

    render(
      <DashboardRenderer
        config={swappedConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByTestId('charging-connection-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('sensor-chip')).toBeNull();
  });

  it('expands the home and DC mix chips when the connection chip is hidden', () => {
    render(
      <DashboardRenderer
        config={mixRowConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.queryByTestId('charging-connection-chip')).toBeNull();
    expect(document.querySelector('[data-widget-definition="charging_home_share"]')).toHaveStyle({
      gridColumn: '1 / span 6',
    });
    expect(document.querySelector('[data-widget-definition="charging_dc_share"]')).toHaveStyle({
      gridColumn: '7 / span 6',
    });
  });

  it('keeps the home and DC mix chips on the left when the connection chip is visible', () => {
    chargingMocks.forcePluggedState = 'Connected';

    render(
      <DashboardRenderer
        config={mixRowConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByTestId('charging-connection-chip')).toBeInTheDocument();
    expect(document.querySelector('[data-widget-definition="charging_home_share"]')).toHaveStyle({
      gridColumn: '1 / span 3',
    });
    expect(document.querySelector('[data-widget-definition="charging_dc_share"]')).toHaveStyle({
      gridColumn: '4 / span 3',
    });
  });

  it('uses charging side art and disables the runner when connected but not charging', () => {
    chargingMocks.forcePluggedState = 'Connected';
    chargingMocks.images = vehicleImageFixtures;

    render(
      <DashboardRenderer
        config={baseConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByText('Standby')).toBeInTheDocument();
    expect(screen.getByTestId('charging-connection-chip')).toHaveAttribute('data-image-mode', 'side-charging');
    expect(screen.getAllByTestId('charging-side-image').map((image) => image.getAttribute('src'))).toEqual([
      '/rivian/side-charging-light.webp',
      '/rivian/side-charging-dark.webp',
    ]);
    expect(screen.queryByTestId('charging-battery-led-sweep')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('charging-battery-led-segment')).toHaveLength(20);
  });

  it('keeps the standard R1S crop when telemetry says the vehicle is charging', () => {
    chargingMocks.forcePluggedState = 'Charging';
    chargingMocks.images = vehicleImageFixtures;

    render(
      <DashboardRenderer
        config={baseConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByTestId('charging-connection-chip')).toBeInTheDocument();
    expect(screen.queryByText('Connected & charging')).not.toBeInTheDocument();
    expect(screen.getByText('1h 35m')).toBeInTheDocument();
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText('92.5%')).toBeInTheDocument();
    expect(screen.getByTestId('charging-connection-chip')).toHaveAttribute('data-crop-family', 'R1S');
    expect(screen.getByTestId('charging-connection-chip')).toHaveAttribute('data-image-mode', 'side-charging');
    expect(screen.getAllByTestId('charging-side-image').map((image) => image.getAttribute('src'))).toEqual([
      '/rivian/side-charging-light.webp',
      '/rivian/side-charging-dark.webp',
    ]);
    expect(screen.getAllByTestId('charging-side-image')[0]).toHaveStyle({
      transform: 'translateX(-12%) scale(1.12)',
      transformOrigin: 'left top',
    });

    const bar = screen.getByTestId('charging-battery-led-bar');
    expect(bar).toHaveAccessibleName('Battery 64 percent');
    expect(bar).toHaveStyle({ position: 'absolute', left: '0px', right: '0px', zIndex: '100' });
    expect(screen.getByTestId('charging-battery-led-segments')).toHaveStyle({
      gridTemplateColumns: 'repeat(20, calc((100% - 38px) / 20))',
      gap: '2px',
    });
    const segments = screen.getAllByTestId('charging-battery-led-segment');
    expect(segments).toHaveLength(20);
    expect(segments.filter((segment) => segment.getAttribute('data-filled') === 'true')).toHaveLength(13);
    expect(screen.getByTestId('charging-battery-led-sweep')).toHaveStyle({
      left: '0px',
      width: 'calc((100% - 38px) / 20)',
    });
  });

  it('finds side-charging art even when Rivian metadata stores it as a side placement', () => {
    chargingMocks.forcePluggedState = 'Charging';
    chargingMocks.images = vehicleImageUrlOnlyChargingFixtures;

    render(
      <DashboardRenderer
        config={{
          ...baseConfig,
          widgets: [{ ...baseConfig.widgets[0]!, options: {} }],
        }}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByTestId('charging-connection-chip')).toHaveAttribute('data-image-mode', 'side-charging');
    const images = screen.getAllByTestId('charging-side-image');
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      '/rivian/r1s_side-charging_light_large.webp',
      '/rivian/r1s_side-charging_dark_large.webp',
    ]);
    expect(images.map((image) => image.getAttribute('data-image-mode'))).toEqual(['charging', 'charging']);
  });

  it('uses the stronger truck crop for R1T charging side art', () => {
    chargingMocks.forcePluggedState = 'Charging';
    chargingMocks.model = 'R1T';
    chargingMocks.images = vehicleImageFixtures;

    render(
      <DashboardRenderer
        config={baseConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByTestId('charging-connection-chip')).toHaveAttribute('data-crop-family', 'R1T');
    expect(screen.getAllByTestId('charging-side-image')[0]).toHaveStyle({
      transform: 'translate(-34%, 2%) scale(1.92)',
      transformOrigin: 'left top',
    });
  });

  it('renders packaged demo R1T charging art when the seeded truck is plugged in', () => {
    chargingMocks.forcePluggedState = 'Charging';
    chargingMocks.model = 'R1T';
    chargingMocks.images = packagedDemoR1TChargingFixtures;

    render(
      <DashboardRenderer
        config={baseConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByTestId('charging-connection-chip')).toBeInTheDocument();
    expect(screen.getByTestId('charging-connection-chip')).toHaveAttribute('data-image-mode', 'side-charging');
    expect(screen.getAllByTestId('charging-side-image').map((image) => image.getAttribute('src'))).toEqual([
      '/vehicle-images/fixtures/r1t/r1t_side-charging_light.webp',
      '/vehicle-images/fixtures/r1t/r1t_side-charging_dark.webp',
    ]);
  });

  it('does not expose a force-show switch in the custom widget editor', () => {
    render(
      <WidgetEditForm
        widget={baseConfig.widgets[0]!}
        onChange={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(screen.queryByRole('switch', { name: 'Force show charging connection' })).toBeNull();
  });
});
