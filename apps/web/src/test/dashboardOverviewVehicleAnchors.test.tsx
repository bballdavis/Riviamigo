import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const overviewMocks = vi.hoisted(() => ({
  model: 'R1T' as 'R1T' | 'R1S' | 'R2S',
}));

const overheadImageFixtures = {
  all: [
    { placement: 'overhead', design: 'light', size: 'large', resolution: '@3x', url: '/rivian/overhead-light.webp' },
    { placement: 'overhead', design: 'dark', size: 'large', resolution: '@3x', url: '/rivian/overhead-dark.webp' },
  ],
  overhead: {
    light: '/rivian/overhead-light.webp',
    dark: '/rivian/overhead-dark.webp',
  },
};

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
        charger_state: 'Disconnected',
        charger_status: 'chrgr_sts_not_connected',
        time_to_end_of_charge_min: null,
        speed_mph: 0,
        latitude: null,
        longitude: null,
        is_online: true,
        last_updated: '2026-05-12T12:00:00Z',
        tire_rl_psi: 31,
        tire_fl_psi: 32,
        tire_rr_psi: 33,
        tire_fr_psi: 34,
        door_rear_left_locked: true,
        door_front_left_locked: true,
        door_rear_right_locked: true,
        door_front_right_locked: true,
        closure_tailgate_locked: true,
        closure_liftgate_locked: true,
        closure_frunk_locked: true,
        tonneau_locked: true,
        side_bin_left_locked: true,
        side_bin_right_locked: true,
      },
    }),
    useVehicles: () => ({ data: [{ id: 'vehicle-1', model: overviewMocks.model, images: overheadImageFixtures, target_tire_pressure_psi: 48 }] }),
  };
});

import { DashboardRenderer } from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';

const config: DashboardConfig = {
  schemaVersion: 2,
  id: 'overview-anchor-test',
  slug: 'overview-anchor-test',
  name: 'Overview Anchor Test',
  isDefault: false,
  isLocked: false,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [
    {
      id: 'overview-vehicle',
      componentType: 'custom',
      definitionId: 'overview.vehicle',
      title: 'Vehicle Overview',
      options: {},
      layout: { x: 0, y: 0, w: 12, h: 7 },
    },
  ],
};

const expectedAnchors = {
  R1T: {
    tires: {
      rl: 'left-[27%] top-[0%]',
      fl: 'left-[82%] top-[0%]',
      rr: 'left-[27%] top-[102%]',
      fr: 'left-[82%] top-[102%]',
    },
    locks: {
      rl: 'left-[43%] top-[-0%]',
      fl: 'left-[60%] top-[-0%]',
      rr: 'left-[43%] top-[102%]',
      fr: 'left-[60%] top-[102%]',
      rearGate: 'left-[4%] top-1/2',
      frunk: 'left-[102%] top-1/2',
    },
  },
  R2S: {
    tires: {
      rl: 'left-[27%] top-[0%]',
      fl: 'left-[82%] top-[0%]',
      rr: 'left-[27%] top-[102%]',
      fr: 'left-[82%] top-[102%]',
    },
    locks: {
      rl: 'left-[43%] top-[-0%]',
      fl: 'left-[60%] top-[-0%]',
      rr: 'left-[43%] top-[102%]',
      fr: 'left-[60%] top-[102%]',
      rearGate: 'left-[4%] top-1/2',
      frunk: 'left-[102%] top-1/2',
    },
  },
} as const;

function renderOverviewForModel(model: 'R1T' | 'R2S') {
  overviewMocks.model = model;
  render(
    <DashboardRenderer
      config={config}
      ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
    />
  );
}

describe('overview vehicle anchors', () => {
  beforeEach(() => {
    overviewMocks.model = 'R1T';
  });

  it.each([
    ['R1T'],
    ['R2S'],
  ] as const)('keeps tire and lock overlays aligned for %s', (model) => {
    renderOverviewForModel(model);

    const anchors = expectedAnchors[model];

    expect(screen.getByText('31 psi').parentElement?.parentElement).toHaveClass(anchors.tires.rl);
    expect(screen.getByText('32 psi').parentElement?.parentElement).toHaveClass(anchors.tires.fl);
    expect(screen.getByText('33 psi').parentElement?.parentElement).toHaveClass(anchors.tires.rr);
    expect(screen.getByText('34 psi').parentElement?.parentElement).toHaveClass(anchors.tires.fr);
    expect(screen.getByText('31 psi')).toHaveClass('border-status-danger/70');
    expect(screen.getByText('32 psi')).toHaveClass('border-status-danger/70');
    expect(screen.getByText('33 psi')).toHaveClass('border-status-danger/70');
    expect(screen.getByText('34 psi')).toHaveClass('border-status-danger/70');

    expect(screen.getByTitle('Rear left door lock')).toHaveClass(anchors.locks.rl);
    expect(screen.getByTitle('Front left door lock')).toHaveClass(anchors.locks.fl);
    expect(screen.getByTitle('Rear right door lock')).toHaveClass(anchors.locks.rr);
    expect(screen.getByTitle('Front right door lock')).toHaveClass(anchors.locks.fr);
    expect(screen.getByTitle('Rear gate lock')).toHaveClass(anchors.locks.rearGate);
    expect(screen.getByTitle('Frunk lock')).toHaveClass(anchors.locks.frunk);
    expect(screen.getByTitle('Rear left door lock')).toHaveClass('text-status-positive');
    expect(screen.getByTitle('Front left door lock')).toHaveClass('text-status-positive');
    expect(screen.getByTitle('Rear right door lock')).toHaveClass('text-status-positive');
    expect(screen.getByTitle('Front right door lock')).toHaveClass('text-status-positive');
  });

  it('renders seeded overhead demo art for the overview stage', () => {
    renderOverviewForModel('R1T');
    expect(screen.getAllByRole('img').map((image) => image.getAttribute('src'))).toEqual(
      expect.arrayContaining(['/rivian/overhead-light.webp', '/rivian/overhead-dark.webp']),
    );
  });
});
