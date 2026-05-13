import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chargingMocks = vi.hoisted(() => ({
  forcePluggedState: 'Disconnected' as 'Disconnected' | 'Connected' | 'Charging',
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
    useVehicles: () => ({ data: [{ id: 'vehicle-1', images: chargingMocks.images }] }),
    useMetricCatalog: () => ({ data: [] }),
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
      id: 'charging-connection-widget',
      componentType: 'custom',
      definitionId: 'charging.connection',
      title: 'Charging Connection',
      options: { forceShow: false },
      layout: { x: 0, y: 0, w: 6, h: 6 },
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

describe('charging connection custom widget', () => {
  beforeEach(() => {
    chargingMocks.forcePluggedState = 'Disconnected';
    chargingMocks.images = null;
  });

  it('stays in a restrained disconnected state until telemetry or preview enables it', () => {
    render(
      <DashboardRenderer
        config={baseConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByTestId('charging-connection-chip')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.queryByText('Connected, not charging')).not.toBeInTheDocument();
  });

  it('uses normal side art and disables the runner when connected but not charging', () => {
    chargingMocks.forcePluggedState = 'Connected';
    chargingMocks.images = vehicleImageFixtures;

    render(
      <DashboardRenderer
        config={baseConfig}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByText('Standby')).toBeInTheDocument();
    expect(screen.getByTestId('charging-connection-chip')).toHaveAttribute('data-image-mode', 'side');
    expect(screen.getAllByTestId('charging-side-image').map((image) => image.getAttribute('src'))).toEqual([
      '/rivian/side-light.webp',
      '/rivian/side-dark.webp',
    ]);
    expect(screen.queryByTestId('charging-battery-led-sweep')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('charging-battery-led-segment')).toHaveLength(20);
  });

  it('renders the live charging treatment when telemetry says the vehicle is charging', () => {
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
    expect(screen.getByTestId('charging-connection-chip')).toHaveAttribute('data-image-mode', 'side-charging');
    expect(screen.getAllByTestId('charging-side-image').map((image) => image.getAttribute('src'))).toEqual([
      '/rivian/side-charging-light.webp',
      '/rivian/side-charging-dark.webp',
    ]);

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

  it('uses force-show as a connected charging preview even when telemetry is unplugged', () => {
    render(
      <DashboardRenderer
        config={{
          ...baseConfig,
          widgets: [{ ...baseConfig.widgets[0]!, options: { forceShow: true } }],
        }}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByTestId('charging-connection-chip')).toBeInTheDocument();
    expect(screen.queryByText('Connected & charging')).not.toBeInTheDocument();
    expect(screen.queryByText('Forced preview')).not.toBeInTheDocument();
    expect(screen.getByText('1h 35m')).toBeInTheDocument();
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getAllByTestId('charging-side-image').map((image) => image.getAttribute('src'))).toEqual([
      '/vehicle-images/r1s-side-charging-light.png',
      '/vehicle-images/r1s-side-charging-light.png',
    ]);
    expect(screen.getAllByTestId('charging-battery-led-segment')).toHaveLength(20);
    expect(screen.getByTestId('charging-battery-led-sweep')).toHaveStyle({
      left: '0px',
      width: 'calc((100% - 38px) / 20)',
    });
  });

  it('lets force-show override connected-but-idle telemetry for charging previews', () => {
    chargingMocks.forcePluggedState = 'Connected';
    chargingMocks.images = vehicleImageFixtures;

    render(
      <DashboardRenderer
        config={{
          ...baseConfig,
          widgets: [{ ...baseConfig.widgets[0]!, options: { forceShow: true } }],
        }}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByTestId('charging-connection-chip')).toHaveAttribute('data-image-mode', 'side-charging');
    expect(screen.getAllByTestId('charging-side-image').map((image) => image.getAttribute('src'))).toEqual([
      '/rivian/side-charging-light.webp',
      '/rivian/side-charging-dark.webp',
    ]);
    expect(screen.getByTestId('charging-battery-led-sweep')).toBeInTheDocument();
  });

  it('finds side-charging art even when Rivian metadata stores it as a side placement', () => {
    chargingMocks.forcePluggedState = 'Connected';
    chargingMocks.images = vehicleImageUrlOnlyChargingFixtures;

    render(
      <DashboardRenderer
        config={{
          ...baseConfig,
          widgets: [{ ...baseConfig.widgets[0]!, options: { forceShow: true } }],
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

  it('exposes a force-show switch in the custom widget editor', () => {
    const onChange = vi.fn();

    render(
      <WidgetEditForm
        widget={baseConfig.widgets[0]!}
        onChange={onChange}
        onClose={() => undefined}
      />
    );

    const toggle = screen.getByRole('switch', { name: 'Force show charging connection' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ forceShow: true }),
      })
    );
  });
});
