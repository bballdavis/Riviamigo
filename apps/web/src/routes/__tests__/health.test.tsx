import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const healthDataBase: any = {
  vehicle_id: 'veh-1',
  vehicle: { name: 'Truck', model: 'R1T', trim: 'Adventure', vin: 'VIN123' },
  generated_at: '2026-05-30T01:00:00Z',
  runtime: {
    is_online: true,
    last_event_at: '2026-05-30T01:00:00Z',
    worker_health: 'connected',
    worker_health_msg: null,
    auth_state: 'authorized',
    auth_reason_code: null,
    updated_at: '2026-05-30T01:00:00Z',
  },
  latest: {
    ts: '2026-05-30T01:00:00Z',
    twelve_volt_health: 'normal',
    hv_thermal_event: 'none',
    ota_current_version: '2026.10.2',
    ota_available_version: null,
    ota_status: 'idle',
    ota_current_status: 'idle',
    is_online: true,
  },
  tires: {
    ts: '2026-05-30T01:00:00Z',
    tire_fl_psi: 48,
    tire_fr_psi: 48,
    tire_rl_psi: 50,
    tire_rr_psi: 50,
    tire_fl_status: 'normal',
    tire_fr_status: 'normal',
    tire_rl_status: 'normal',
    tire_rr_status: 'normal',
  },
  closures: {
    ts: '2026-05-30T01:00:00Z',
    closure_frunk_closed: true,
    closure_liftgate_closed: true,
    closure_tailgate_closed: null,
    door_front_left_closed: true,
    door_front_right_closed: true,
    door_rear_left_closed: true,
    door_rear_right_closed: true,
  },
  current_software_version: '2026.10.2',
  ota_release_notes_url: 'https://example.com/release',
  software_history: [
    { version: '2026.10.2', installed_at: '2026-05-10T00:00:00Z', observed_until: null },
    { version: '2026.10.2', installed_at: '2026-05-01T00:00:00Z', observed_until: '2026-05-09T00:00:00Z' },
  ],
  thermal_events_30d: 123,
};

const statusBase = {
  closure_tailgate_closed: true,
  brake_fluid_low: null,
  wiper_fluid_low: false,
  service_mode: false,
  alarm_active: false,
  gear_guard_locked: null,
  charge_port_open: false,
  charger_derate_active: false,
  defrost_active: false,
  cabin_precon_status: null,
};

const mockUseVehicleHealth = vi.fn(() => ({ data: healthDataBase, isLoading: false }));
const mockUseCurrentVehicleStatus = vi.fn(() => ({ data: statusBase }));
const mockUseQuery = vi.fn(() => ({
  data: {
    all: [{ placement: 'side', design: 'three_quarter_light', size: null, resolution: null, url: 'https://example.com/three_quarter_light.png' }],
    side: { light: 'https://example.com/side.png', dark: null },
  },
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'veh-1' }),
  useVehicleHealth: () => mockUseVehicleHealth(),
  useCurrentVehicleStatus: () => mockUseCurrentVehicleStatus(),
  api: { vehicleImages: vi.fn() },
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: () => mockUseQuery() };
});

vi.mock('../../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../components/layout/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { healthRoute } from '../health';

const HealthContent = healthRoute.options.component as React.ComponentType;

describe('/health page cleanup', () => {
  it('renders the hero three-quarter image and software release notes link with no fake update banner', () => {
    mockUseQuery.mockReturnValueOnce({
      data: {
        all: [
          { placement: 'side', design: 'light', size: null, resolution: null, url: 'https://example.com/side.png' },
          { placement: 'front_side', design: 'light', size: null, resolution: null, url: 'https://example.com/three-quarter.png', metadata: { angle: '3/4' } },
        ],
        side: { light: 'https://example.com/side.png', dark: null },
      },
    });
    render(<HealthContent />);
    const image = screen.getByAltText('Vehicle three-quarter view');
    expect(image).toHaveAttribute('src', 'https://example.com/three-quarter.png');
    expect(screen.getByRole('link', { name: 'View release notes' })).toBeInTheDocument();
    expect(screen.queryByText(/Update .* available/)).not.toBeInTheDocument();
  });

  it('shows update banner when a real update version exists', () => {
    mockUseVehicleHealth.mockReturnValueOnce({
      data: {
        ...healthDataBase,
        latest: { ...healthDataBase.latest, ota_available_version: '2026.11.0' },
      },
      isLoading: false,
    });
    render(<HealthContent />);
    expect(screen.getByText('Update 2026.11.0 available')).toBeInTheDocument();
  });

  it('uses tailgate fallback from current status and renders doors & gates title', () => {
    render(<HealthContent />);
    expect(screen.getByText('Doors & Gates')).toBeInTheDocument();
    expect(screen.getByText('Tailgate')).toBeInTheDocument();
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
  });

  it('renders missing diagnostics as Needs data and dedupes repeated software history versions', () => {
    render(<HealthContent />);
    expect(screen.getAllByText('Needs data').length).toBeGreaterThan(0);
    expect(screen.getByText('Full history (1 entries)')).toBeInTheDocument();
  });
});
