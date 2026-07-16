import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const overviewMocks = vi.hoisted(() => ({
  model: 'R1T' as 'R1T' | 'R1S' | 'R2S',
  chargerState: 'Disconnected' as 'Disconnected' | 'Connected' | 'Charging',
  batteryLevel: 64,
  hasApiArtwork: true,
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
    useResolvedVehicleSelection: () => ({
      authReady: true,
      effectiveVehicleId: 'vehicle-1',
      vehicleSelectionReady: true,
      vehicles: [{ id: 'vehicle-1', model: overviewMocks.model, images: overviewMocks.hasApiArtwork ? overheadImageFixtures : undefined }],
    }),
    useCurrentVehicleStatus: () => ({
      data: {
        vehicle_id: 'vehicle-1',
        battery_level: overviewMocks.batteryLevel,
        range_miles: 188,
        battery_limit: 80,
        power_state: 'ready',
        charger_state: overviewMocks.chargerState,
        charger_status:
          overviewMocks.chargerState === 'Charging'
            ? 'chrgr_sts_connected_charging'
            : overviewMocks.chargerState === 'Connected'
              ? 'chrgr_sts_connected_no_chrg'
              : 'chrgr_sts_not_connected',
        time_to_end_of_charge_min: overviewMocks.chargerState === 'Charging' ? 95 : null,
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
        side_bin_left_locked: false,
        side_bin_right_locked: true,
        side_bin_left_closed: true,
        side_bin_right_closed: false,
      },
    }),
    useVehicles: () => ({ data: [{ id: 'vehicle-1', model: overviewMocks.model, images: overviewMocks.hasApiArtwork ? overheadImageFixtures : undefined, target_tire_pressure_psi: 48 }] }),
  };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({ data: undefined, isLoading: false, isFetching: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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
      sideBinLeft: 'left-[36%] top-[24%]',
      sideBinRight: 'left-[36%] top-[76%]',
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
    overviewMocks.chargerState = 'Disconnected';
    overviewMocks.batteryLevel = 64;
    overviewMocks.hasApiArtwork = true;
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
    expect(screen.getByTestId('overview-vehicle-art-frame')).toHaveStyle({ containerType: 'inline-size' });
    for (const label of screen.getAllByTestId('overview-tire-label')) {
      expect(label).toHaveClass('whitespace-nowrap');
      expect(label).toHaveStyle({
        fontSize: 'clamp(0.5625rem, 2.125cqw, 0.6875rem)',
        paddingInline: 'clamp(0.25rem, 1.54cqw, 0.5rem)',
      });
    }
    expect(screen.queryByText('To Limit')).not.toBeInTheDocument();

    expect(screen.getByTitle('Rear left door lock')).toHaveClass(anchors.locks.rl);
    expect(screen.getByTitle('Front left door lock')).toHaveClass(anchors.locks.fl);
    expect(screen.getByTitle('Rear right door lock')).toHaveClass(anchors.locks.rr);
    expect(screen.getByTitle('Front right door lock')).toHaveClass(anchors.locks.fr);
    const rearGateTitle = model === 'R1T' ? 'Tailgate lock' : 'Rear gate lock';
    expect(screen.getByTitle(rearGateTitle)).toHaveClass(anchors.locks.rearGate);
    expect(screen.getByTitle('Frunk lock')).toHaveClass(anchors.locks.frunk);
    expect(screen.queryByTitle('Tonneau lock')).not.toBeInTheDocument();
    expect(screen.getByTitle('Rear left door lock')).toHaveClass('text-status-positive');
    expect(screen.getByTitle('Front left door lock')).toHaveClass('text-status-positive');
    expect(screen.getByTitle('Rear right door lock')).toHaveClass('text-status-positive');
    expect(screen.getByTitle('Front right door lock')).toHaveClass('text-status-positive');

    if (model === 'R1T') {
      expect(screen.getByTitle('Left side bin cover: closed')).toHaveClass('left-[36%]', 'top-[24%]', 'text-status-positive');
      expect(screen.getByTitle('Right side bin cover: open')).toHaveClass('left-[36%]', 'top-[76%]', 'text-accent');
    } else {
      expect(screen.queryByTitle('Left side bin cover: closed')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Right side bin cover: open')).not.toBeInTheDocument();
    }
  });

  it('shows time to limit only while charging', () => {
    overviewMocks.chargerState = 'Charging';

    renderOverviewForModel('R1T');

    expect(screen.getByText('To Limit')).toBeInTheDocument();
    expect(screen.getByText('1h 35m')).toBeInTheDocument();
  });

  it('renders seeded overhead demo art for the overview stage', () => {
    renderOverviewForModel('R1T');
    expect(screen.getAllByRole('img').map((image) => image.getAttribute('src'))).toEqual(
      expect.arrayContaining(['/rivian/overhead-light.webp', '/rivian/overhead-dark.webp']),
    );
  });

  it('scales only the packaged R1T overview fallback across its short axis', () => {
    overviewMocks.hasApiArtwork = false;
    renderOverviewForModel('R1T');

    const fallbackImages = Array.from(document.querySelectorAll<HTMLImageElement>('img[src="/vehicle-images/fallbacks/r1t/overview.webp"]'));
    expect(fallbackImages).toHaveLength(2);
    for (const image of fallbackImages) {
      expect(image).toHaveAttribute('data-artwork-fallback');
      expect(image.style.transform).toContain('translate(-50%, -50%) rotate(90deg) scaleX(');
      expect(Number(image.style.transform.match(/scaleX\(([^)]+)\)/)?.[1])).toBeCloseTo(509 / 446);
    }
  });

  it('does not scale API overhead artwork or other-model fallbacks', () => {
    renderOverviewForModel('R1T');
    for (const image of Array.from(document.querySelectorAll('img[src^="/rivian/overhead"]'))) {
      expect(image).toHaveStyle({ transform: 'translate(-50%, -50%) rotate(90deg)' });
    }

    overviewMocks.hasApiArtwork = false;
    renderOverviewForModel('R2S');
    for (const image of Array.from(document.querySelectorAll('img[src="/vehicle-images/fallbacks/r2s/overview.webp"]'))) {
      expect(image).toHaveStyle({ transform: 'translate(-50%, -50%) rotate(90deg)' });
    }
  });

  it('keeps the SOC rail inset at full charge', () => {
    overviewMocks.batteryLevel = 100;

    renderOverviewForModel('R1T');

    const rail = screen.getByTestId('overview-soc-rail');
    const fill = screen.getByTestId('overview-soc-fill');

    expect(rail).toHaveClass('absolute', 'inset-1', 'flex', 'items-end', 'overflow-hidden', 'rounded-xl', 'p-1');
    expect(fill.parentElement).toBe(rail);
    expect(fill).toHaveClass('w-full', 'rounded-lg');
    expect(fill.style.height).toBe('100%');
  });
});
