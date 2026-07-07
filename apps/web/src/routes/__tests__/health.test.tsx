import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const healthPageMocks = vi.hoisted(() => ({
  auth: {
    defaultVehicleId: 'veh-1',
    activeVehicleId: null as string | null,
    setActiveVehicleId: vi.fn(),
  },
  vehicles: [
    { id: 'veh-1', display_name: 'Truck', model: 'R1T' },
    { id: 'demo-v1', display_name: 'Demo R1T', model: 'R1T' },
  ],
  imagesByVehicleId: {
    'veh-1': {
      all: [
        {
          placement: 'side',
          design: 'light',
          size: null,
          resolution: null,
          url: 'https://example.com/three_quarter_light.png',
        },
      ],
      side: { light: 'https://example.com/side.png', dark: null },
    },
    'demo-v1': {
      all: [
        {
          placement: 'side',
          design: 'light',
          size: null,
          resolution: null,
          url: 'https://example.com/demo-side.png',
        },
      ],
      side: { light: 'https://example.com/demo-side.png', dark: null },
    },
  } as Record<string, any>,
}));

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
    {
      version: '2026.10.2',
      installed_at: '2026-05-01T00:00:00Z',
      observed_until: '2026-05-09T00:00:00Z',
    },
  ],
  thermal_events_30d: 123,
};

const statusBase = {
  closure_tailgate_closed: true,
  brake_fluid_low: null,
  wiper_fluid_low: false,
  service_mode: false,
  alarm_active: false,
  gear_guard_locked: true,
  charge_port_open: false,
  charger_derate_active: false,
  defrost_active: false,
  cabin_precon_status: 'off',
  tire_fl_psi: 48,
  tire_fr_psi: 48,
  tire_rl_psi: 50,
  tire_rr_psi: 50,
  tire_fl_status: 'normal',
  tire_fr_status: 'normal',
  tire_rl_status: 'normal',
  tire_rr_status: 'normal',
  tire_fl_valid: true,
  tire_fr_valid: true,
  tire_rl_valid: true,
  tire_rr_valid: true,
  closure_frunk_closed: true,
  closure_liftgate_closed: true,
  door_front_left_closed: true,
  door_front_right_closed: true,
  door_rear_left_closed: true,
  door_rear_right_closed: true,
  field_availability: {
    brake_fluid_low: {
      ever_seen: false,
      last_seen_at: null,
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'never_seen',
      reason_code: 'never_seen',
    },
    wiper_fluid_low: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    service_mode: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    alarm_active: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    gear_guard_locked: {
      ever_seen: true,
      last_seen_at: '2026-05-29T22:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    gear_guard_video_status: {
      ever_seen: false,
      last_seen_at: null,
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'never_seen',
      reason_code: 'never_seen',
    },
    charge_port_open: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    charger_derate_active: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    defrost_active: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    cabin_precon_status: {
      ever_seen: true,
      last_seen_at: '2026-05-29T23:30:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    cabin_precon_type: {
      ever_seen: false,
      last_seen_at: null,
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'never_seen',
      reason_code: 'never_seen',
    },
    tire_fl_psi: {
      ever_seen: true,
      last_seen_at: '2026-05-29T23:30:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    tire_fr_psi: {
      ever_seen: true,
      last_seen_at: '2026-05-29T23:30:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    tire_rl_psi: {
      ever_seen: true,
      last_seen_at: '2026-05-29T23:30:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    tire_rr_psi: {
      ever_seen: true,
      last_seen_at: '2026-05-29T23:30:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    tire_fl_status: {
      ever_seen: true,
      last_seen_at: '2026-05-29T23:30:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    tire_fr_status: {
      ever_seen: true,
      last_seen_at: '2026-05-29T23:30:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    tire_rl_status: {
      ever_seen: true,
      last_seen_at: '2026-05-29T23:30:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    tire_rr_status: {
      ever_seen: true,
      last_seen_at: '2026-05-29T23:30:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    tire_fl_valid: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    tire_fr_valid: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    tire_rl_valid: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    tire_rr_valid: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    tire_pressure_status: {
      ever_seen: true,
      last_seen_at: '2026-05-29T23:30:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    closure_tailgate_closed: {
      ever_seen: true,
      last_seen_at: '2026-05-29T22:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'historical',
      reason_code: 'missing_recent_payload',
    },
    closure_frunk_closed: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    closure_liftgate_closed: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    door_front_left_closed: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    door_front_right_closed: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    door_rear_left_closed: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
    door_rear_right_closed: {
      ever_seen: true,
      last_seen_at: '2026-05-30T01:00:00Z',
      latest_event_at: '2026-05-30T01:00:00Z',
      availability: 'current',
      reason_code: null,
    },
  },
};

const mockUseVehicleHealth = vi.fn((vehicleId?: string | null) => ({
  data: {
    ...healthDataBase,
    vehicle_id: vehicleId ?? 'veh-1',
    vehicle: {
      ...healthDataBase.vehicle,
      name: vehicleId === 'demo-v1' ? 'Demo R1T' : 'Truck',
    },
  },
  isLoading: false,
}));
const mockUseCurrentVehicleStatus = vi.fn((_vehicleId?: string | null) => ({ data: statusBase }));
const mockUseQuery = vi.fn(({ queryKey }: { queryKey: unknown[] }) => ({
  data: healthPageMocks.imagesByVehicleId[String(queryKey[2])] ?? null,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => healthPageMocks.auth,
  useAuthReady: () => true,
  useVehicles: () => ({ data: healthPageMocks.vehicles }),
  useVehicleHealth: (vehicleId?: string | null) => mockUseVehicleHealth(vehicleId),
  useCurrentVehicleStatus: (vehicleId?: string | null) => mockUseCurrentVehicleStatus(vehicleId),
  api: { vehicleImages: vi.fn() },
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: (options: { queryKey: unknown[] }) => mockUseQuery(options) };
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
  beforeEach(() => {
    healthPageMocks.auth.activeVehicleId = null;
    healthPageMocks.auth.setActiveVehicleId.mockReset();
    healthPageMocks.imagesByVehicleId['veh-1'] = {
      all: [
        {
          placement: 'side',
          design: 'light',
          size: null,
          resolution: null,
          url: 'https://example.com/three_quarter_light.png',
        },
      ],
      side: { light: 'https://example.com/side.png', dark: null },
    };
    healthPageMocks.imagesByVehicleId['demo-v1'] = {
      all: [
        {
          placement: 'side',
          design: 'light',
          size: null,
          resolution: null,
          url: 'https://example.com/demo-side.png',
        },
      ],
      side: { light: 'https://example.com/demo-side.png', dark: null },
    };
    mockUseVehicleHealth.mockClear();
    mockUseCurrentVehicleStatus.mockClear();
    mockUseQuery.mockClear();
  });

  it('renders the hero three-quarter image and software release notes link with no fake update banner', () => {
    healthPageMocks.imagesByVehicleId['veh-1'] = {
      all: [
        {
          placement: 'side',
          design: 'light',
          size: null,
          resolution: null,
          url: 'https://example.com/side.png',
        },
        {
          placement: 'front_side',
          design: 'light',
          size: null,
          resolution: null,
          url: 'https://example.com/three-quarter.png',
          metadata: { angle: '3/4' },
        },
      ],
      side: { light: 'https://example.com/side.png', dark: null },
    };
    render(<HealthContent />);
    const image = screen.getByAltText('Vehicle three-quarter view');
    expect(image).toHaveAttribute('src', 'https://example.com/three-quarter.png');
    expect(screen.getByRole('link', { name: 'View release notes' })).toBeInTheDocument();
    expect(screen.queryByText(/Update .* available/)).not.toBeInTheDocument();
  });

  it('falls back to plain side art before front hero art when no three-quarter image exists', () => {
    healthPageMocks.imagesByVehicleId['veh-1'] = {
      all: [
        {
          placement: 'side',
          design: 'light',
          size: null,
          resolution: null,
          url: 'https://example.com/side.png',
          metadata: { app_usage: ['health-hero-fallback'] },
        },
        {
          placement: 'front',
          design: 'light',
          size: null,
          resolution: null,
          url: 'https://example.com/front.png',
          metadata: { app_usage: ['health-hero-fallback'] },
        },
      ],
      front: { light: 'https://example.com/front.png', dark: null },
      side: { light: 'https://example.com/side.png', dark: null },
    };
    render(<HealthContent />);
    const image = screen.getByAltText('Vehicle three-quarter view');
    expect(image).toHaveAttribute('src', 'https://example.com/side.png');
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

  it('uses the active session vehicle when health is pointed at a demo truck', () => {
    healthPageMocks.auth.activeVehicleId = 'demo-v1';
    render(<HealthContent />);
    expect(mockUseVehicleHealth).toHaveBeenLastCalledWith('demo-v1');
    expect(screen.getByRole('heading', { level: 2, name: 'Demo R1T' })).toBeInTheDocument();
    expect(screen.getByAltText('Vehicle three-quarter view')).toHaveAttribute(
      'src',
      'https://example.com/demo-side.png'
    );
  });

  it('renders a vehicle picker and routes selection changes through the session vehicle setter', () => {
    render(<HealthContent />);
    const picker = screen.getByLabelText('Select vehicle');
    expect(picker).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'demo-v1' } });
    expect(healthPageMocks.auth.setActiveVehicleId).toHaveBeenCalledWith('demo-v1');
  });

  it('uses tailgate fallback from current status and renders doors & gates title', () => {
    render(<HealthContent />);
    expect(screen.getByText('Doors & Gates')).toBeInTheDocument();
    expect(screen.getByText('Tailgate')).toBeInTheDocument();
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
  });

  it('renders unavailable diagnostics and historical timestamps while deduping software history versions', () => {
    render(<HealthContent />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getAllByText(/Last updated/).length).toBeGreaterThan(0);
    expect(screen.getByText('Full history (1 entries)')).toBeInTheDocument();
  });
});
