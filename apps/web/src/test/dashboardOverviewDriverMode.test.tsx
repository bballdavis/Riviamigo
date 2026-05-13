import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const statusMocks = vi.hoisted(() => ({
  driveMode: 'all_purpose' as string | null,
  gearStatus: 'drive' as string | null,
}));

vi.mock('@riviamigo/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/hooks')>();
  return {
    ...actual,
    useAuth: () => ({ defaultVehicleId: 'vehicle-1' }),
    useCurrentVehicleStatus: () => ({
      data: {
        vehicle_id: 'vehicle-1',
        drive_mode: statusMocks.driveMode,
        gear_status: statusMocks.gearStatus,
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
      },
    }),
    useVehicles: () => ({ data: [{ id: 'vehicle-1', images: null }] }),
  };
});

import { DashboardRenderer } from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';

const config: DashboardConfig = {
  schemaVersion: 2,
  id: 'overview-driver-mode-test',
  slug: 'overview-driver-mode-test',
  name: 'Overview Driver Mode Test',
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

describe('overview driver mode chip', () => {
  beforeEach(() => {
    statusMocks.driveMode = 'all_purpose';
    statusMocks.gearStatus = 'drive';
  });

  it('shows a friendly chip label instead of the raw drive-mode token', () => {
    render(
      <DashboardRenderer
        config={config}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByText('All-Purpose')).toBeInTheDocument();
    expect(screen.queryByText('all_purpose')).not.toBeInTheDocument();
  });

  it('keeps the fallback gear-status label friendly when drive mode is missing', () => {
    statusMocks.driveMode = null;
    statusMocks.gearStatus = 'park';

    render(
      <DashboardRenderer
        config={config}
        ctx={{ vehicleId: 'vehicle-1', from: '2026-05-01', to: '2026-05-12' }}
      />
    );

    expect(screen.getByText('Park')).toBeInTheDocument();
    expect(screen.queryByText('park')).not.toBeInTheDocument();
  });
});
