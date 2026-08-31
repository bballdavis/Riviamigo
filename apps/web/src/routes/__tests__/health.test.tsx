import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const healthPageMocks = vi.hoisted(() => ({
  auth: {
    defaultVehicleId: 'veh-1' as string | null,
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
const mockUseTelemetryLanes = vi.fn((_vehicleId?: string | null, _query?: unknown) => ({
  data: undefined,
  isLoading: false,
}));
const mockUseQuery = vi.fn(({ queryKey }: { queryKey: unknown[] }) => ({
  data: healthPageMocks.imagesByVehicleId[String(queryKey[2])] ?? null,
}));

vi.mock('@riviamigo/hooks', () => ({
  queryKeys: {
    vehicle: {
      images: (vehicleId: string | null) => ['vehicles', 'images', vehicleId],
    },
  },
  useAuth: () => healthPageMocks.auth,
  AuthenticatedVehicleArtwork: ({
    source,
    fallbackSource,
    alt,
    className,
  }: {
    source: string | null;
    fallbackSource?: string | null;
    alt: string;
    className?: string;
  }) => <img src={source ?? fallbackSource ?? undefined} alt={alt} className={className} />,
  useResolvedVehicleSelection: () => ({
    authReady: true,
    effectiveVehicleId:
      healthPageMocks.auth.activeVehicleId ??
      healthPageMocks.auth.defaultVehicleId ??
      healthPageMocks.vehicles[0]?.id ??
      null,
    vehicleSelectionReady: true,
    vehicles: healthPageMocks.vehicles,
  }),
  useVehicleHealth: (vehicleId?: string | null) => mockUseVehicleHealth(vehicleId),
  useCurrentVehicleStatus: (vehicleId?: string | null) => mockUseCurrentVehicleStatus(vehicleId),
  useTelemetryLanes: (vehicleId?: string | null, query?: unknown) =>
    mockUseTelemetryLanes(vehicleId, query),
  resolveVehicleArtwork: (images: any, model: string | null | undefined) => {
    const normalized = (model ?? '').toLowerCase();
    const vehicleModel = normalized.includes('r1s')
      ? 'r1s'
      : normalized.includes('r1t')
        ? 'r1t'
        : normalized.includes('r2s')
          ? 'r2s'
          : null;
    const all = images?.all ?? [];
    const text = (image: any) =>
      `${image.placement ?? ''} ${image.url ?? ''} ${JSON.stringify(image.metadata ?? {})}`.toLowerCase();
    const hero =
      all.find(
        (image: any) =>
          text(image).includes('health-hero') && !text(image).includes('health-hero-fallback')
      ) ??
      all.find(
        (image: any) =>
          text(image).includes('three-quarter') || text(image).includes('three_quarter')
      );
    const side = images?.side?.light
      ? { url: images.side.light }
      : all.find(
          (image: any) =>
            String(image.placement).toLowerCase() === 'side' && !text(image).includes('charg')
        );
    const taggedFallback = all.find((image: any) => text(image).includes('health-hero-fallback'));
    const front = images?.front?.light
      ? { url: images.front.light }
      : all.find((image: any) => String(image.placement).toLowerCase().includes('front'));
    return {
      light: hero?.url ?? side?.url ?? taggedFallback?.url ?? front?.url ?? null,
      dark: hero?.url ?? side?.url ?? taggedFallback?.url ?? front?.url ?? null,
      fallback: vehicleModel ? `/vehicle-images/fallbacks/${vehicleModel}/health.webp` : null,
    };
  },
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

describe('/vehicle-health page cleanup', () => {
  beforeEach(() => {
    healthPageMocks.auth.defaultVehicleId = 'veh-1';
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
    mockUseTelemetryLanes.mockClear();
    mockUseQuery.mockClear();
  });

  it('uses the vehicle health dashboard path', () => {
    expect((healthRoute.options as { path?: string }).path).toBe('/vehicle-health');
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

  it('uses packaged health artwork when the image query returns no usable image', () => {
    healthPageMocks.imagesByVehicleId['veh-1'] = null;

    render(<HealthContent />);

    expect(screen.getByAltText('Vehicle three-quarter view')).toHaveAttribute(
      'src',
      '/vehicle-images/fallbacks/r1t/health.webp'
    );
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

  it('uses the first accessible vehicle when the user has no default vehicle', () => {
    healthPageMocks.auth.defaultVehicleId = null;
    render(<HealthContent />);

    expect(mockUseVehicleHealth).toHaveBeenLastCalledWith('veh-1');
  });

  it('renders a vehicle picker and routes selection changes through the session vehicle setter', () => {
    render(<HealthContent />);
    const picker = screen.getByLabelText('Select vehicle');
    expect(picker).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'demo-v1' } });
    expect(healthPageMocks.auth.setActiveVehicleId).toHaveBeenCalledWith('demo-v1');
  });

  it('shows the tire reading timestamp beside the tire pressure title', () => {
    render(<HealthContent />);

    const lastUpdated = screen.getByTestId('tire-reading-updated');
    expect(lastUpdated).toHaveTextContent('Updated:');
    expect(lastUpdated).toHaveTextContent('May 30, 2026');
    expect(lastUpdated).not.toHaveTextContent('Last');
    expect(lastUpdated).not.toHaveTextContent('48–50 psi');
  });

  it('uses tailgate fallback from current status and renders doors & gates title', () => {
    render(<HealthContent />);
    expect(screen.getByText('Doors & Gates')).toBeInTheDocument();
    expect(screen.getByText('Tailgate')).toBeInTheDocument();
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
    expect(screen.getByTestId('closure-icon-closure_frunk_closed')).toHaveAttribute(
      'data-closure-kind',
      'gate'
    );
    expect(screen.getByTestId('closure-icon-door_front_left_closed')).toHaveAttribute(
      'data-closure-kind',
      'door'
    );
    expect(
      screen.getByTestId('closure-icon-door_front_left_closed').querySelector('svg')
    ).not.toHaveStyle({
      transform: 'scaleX(-1)',
    });
    expect(
      screen.getByTestId('closure-icon-door_front_right_closed').querySelector('svg')
    ).toHaveStyle({
      transform: 'scaleX(-1)',
    });
  });

  it('renders tire readings as sensor chips with the available pressure history', () => {
    mockUseTelemetryLanes.mockReturnValueOnce({
      data: {
        spine: ['2026-05-29T01:00:00Z', '2026-05-30T01:00:00Z'],
        lanes: {
          health: {
            numeric: {
              tire_fl_psi: [46, 48],
              tire_fr_psi: [47, 48],
              tire_rl_psi: [49, 50],
              tire_rr_psi: [48, 50],
            },
          },
        },
      },
      isLoading: false,
    } as any);

    render(<HealthContent />);

    expect(screen.getAllByTestId('sensor-chip')).toHaveLength(4);
    expect(screen.queryAllByTestId('sensor-sprite-layer')).toHaveLength(0);
    expect(screen.queryByText(/30-day history|observation|No history/)).not.toBeInTheDocument();
    expect(screen.getAllByText('48 psi')).toHaveLength(2);
    expect(mockUseTelemetryLanes).not.toHaveBeenCalled();
  });

  it('omits unsupported tailgate telemetry for an R1S health view', () => {
    mockUseVehicleHealth.mockReturnValueOnce({
      data: {
        ...healthDataBase,
        vehicle: { ...healthDataBase.vehicle, model: 'R1S' },
      },
      isLoading: false,
    });

    render(<HealthContent />);

    expect(screen.getByText('Liftgate')).toBeInTheDocument();
    expect(screen.queryByText('Tailgate')).not.toBeInTheDocument();
  });

  it('renders unavailable diagnostics and historical timestamps while deduping software history versions', () => {
    render(<HealthContent />);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getAllByText(/Last updated/).length).toBeGreaterThan(0);
    expect(screen.getByText('Full history (1 entries)')).toBeInTheDocument();
  });

  it('renders compact telemetry with tooltip-only diagnostics and unit controls', () => {
    mockUseVehicleHealth.mockReturnValueOnce({
      data: {
        ...healthDataBase,
        extended_telemetry: {
          collector: {
            status: 'connected',
            running: true,
            connected_at: '2026-05-30T00:00:00Z',
            last_event_at: '2026-05-30T01:00:00Z',
            last_error: null,
            updated_at: '2026-05-30T01:00:00Z',
          },
          parallax: {
            status: 'connected',
            last_frame_at: '2026-05-30T01:00:00Z',
            last_meaningful_frame_at: '2026-05-30T01:00:00Z',
            reconnect_count: 2,
            decode_error_count: 1,
            empty_frame_count: 4,
            ambiguity_count: 0,
            last_error: null,
          },
          legacy_charging_session: {
            classification: 'meaningful',
            last_frame_at: '2026-05-30T01:00:00Z',
            last_meaningful_frame_at: '2026-05-30T01:00:00Z',
            null_count: 3,
            missing_count: 0,
            malformed_count: 0,
            all_null_count: 8,
            meaningful_count: 2,
          },
          session_repair: {
            repair_key: 'active-tail-merge:a:b',
            reason: 'telemetry_proven_restart_split',
            created_at: '2026-05-30T00:30:00Z',
          },
          network: {
            source_at: '2026-05-30T01:00:00Z',
            wifi_connected: true,
            wifi_rssi_dbm: -56,
            wifi_link_speed_mbps: 117,
            wifi_frequency_mhz: 2437,
            wifi_channel_width_mhz: 20,
            cellular_access_technology: 'LTE',
            cellular_signal_dbm: null,
          },
          efficiency: {
            source_at: '2026-05-30T01:00:00Z',
            reference_wh_per_km: 207,
            learned_wh_per_km: 248,
            mode_ranges_km: { '1': 531 },
          },
          mass: {
            source_at: '2026-05-30T01:00:00Z',
            estimated_mass_kg: 3160,
          },
          cold_weather: {
            source_at: '2026-05-30T01:00:00Z',
            available_soc_pct: 74,
            cold_limited_soc_pct: 68,
            cold_range_impact_km: 12.4,
          },
        },
      },
      isLoading: false,
    });

    render(<HealthContent />);

    expect(screen.queryByText('Vehicle telemetry')).not.toBeInTheDocument();
    expect(screen.getByText('Connectivity')).toBeInTheDocument();
    expect(screen.getByText('Wi-Fi signal')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Wi-Fi strength: Good' })).toBeInTheDocument();
    expect(screen.getByText('Throughput')).toBeInTheDocument();
    expect(screen.getByText('117 Mbps')).toBeInTheDocument();
    expect(screen.getByText('Wi-Fi status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wi-Fi connection details' })).not.toBeInTheDocument();
    expect(screen.getByText(/-56 dBm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Toggle efficiency units/ })).toBeInTheDocument();
    expect(screen.getByText('Est. Efficiency')).toBeInTheDocument();
    expect(screen.getByText('Vehicle mass')).toBeInTheDocument();
    expect(screen.getByText('Cold-weather impact')).toBeInTheDocument();
    expect(screen.getAllByText('Connected')).toHaveLength(2);
    expect(screen.getByText('Acquisition')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About acquisition status' })).toBeInTheDocument();
    expect(screen.queryByText(/2 reconnects/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1 decode · 4 empty · 0 ambiguous/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Generated from the latest stored telemetry/)).not.toBeInTheDocument();
    expect(screen.queryByText('Acquisition diagnostics')).not.toBeInTheDocument();
    expect(screen.queryByText('Legacy chargingSession')).not.toBeInTheDocument();
    expect(screen.queryByText(/telemetry proven restart split/)).not.toBeInTheDocument();

    const softwareHistory = screen.getByText('Software History');
    const telemetrySummary = screen.getByTestId('vehicle-telemetry-summary');
    const signalFreshness = screen.getByText('Signal Freshness');
    const toggle = screen.getByRole('button', { name: /Toggle efficiency units/ });
    const vehiclePicker = screen.getByRole('combobox', { name: 'Select vehicle' });
    expect(toggle.compareDocumentPosition(vehiclePicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(telemetrySummary.compareDocumentPosition(softwareHistory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(telemetrySummary.compareDocumentPosition(signalFreshness) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('extended-vehicle-telemetry')).not.toBeInTheDocument();
  });

  it('keeps compact telemetry visible when the Parallax companion is not running', () => {
    mockUseVehicleHealth.mockReturnValueOnce({
      data: {
        ...healthDataBase,
        extended_telemetry: {
          collector: {
            status: 'disconnected',
            running: false,
            connected_at: null,
            last_event_at: null,
            last_error: 'Collector stopped',
            updated_at: '2026-05-30T01:00:00Z',
          },
          parallax: {
            status: 'duplicate_owner',
            last_frame_at: null,
            last_meaningful_frame_at: null,
            reconnect_count: 0,
            decode_error_count: 0,
            empty_frame_count: 0,
            ambiguity_count: 0,
            last_error: 'Standalone collector lease is still fresh',
          },
          legacy_charging_session: {
            classification: 'all_null',
            last_frame_at: '2026-05-30T01:00:00Z',
            last_meaningful_frame_at: null,
            null_count: 0,
            missing_count: 0,
            malformed_count: 0,
            all_null_count: 12,
            meaningful_count: 0,
          },
          session_repair: null,
          network: null,
          efficiency: null,
          mass: null,
          cold_weather: null,
        },
      },
      isLoading: false,
    });

    render(<HealthContent />);

    expect(screen.getByTestId('vehicle-telemetry-summary')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText(/canonical vehicle telemetry continues independently/i)).toBeInTheDocument();
    expect(screen.queryByTestId('extended-vehicle-telemetry')).not.toBeInTheDocument();
  });
});
