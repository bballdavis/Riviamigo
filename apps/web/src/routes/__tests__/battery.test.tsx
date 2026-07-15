import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'v1', accessToken: 'tok' }),
  useMe: () => ({ data: { role: 'user' } }),
  useVehicles: () => ({ data: [{ id: 'v1', display_name: 'Forest R1S' }] }),
  useResolvedVehicleSelection: () => ({
    authReady: true,
    effectiveVehicleId: 'v1',
    vehicleSelectionReady: true,
    vehicles: [{ id: 'v1', display_name: 'Forest R1S' }],
  }),
  useCurrentVehicleStatus: () => ({
    data: {
      vehicle_id: 'v1',
      battery_level: 71,
      range_miles: 227.2,
      battery_capacity_kwh: 125,
      power_state: 'ready',
      charger_state: 'Disconnected',
      speed_mph: 0,
      altitude_m: 0,
      latitude: 0,
      longitude: 0,
      is_online: true,
      last_updated: '2024-01-01T00:00:00Z',
    },
    isLoading: false,
  }),
  useBatteryHealth: () => ({
    data: {
      usable_now_kwh: 125,
      usable_new_kwh: 130,
      battery_health_pct: 96,
      estimated_degradation_pct: 4,
      charging_cycles: 12,
      charge_count: 50,
      total_energy_added_kwh: 1600,
      total_energy_used_kwh: 1700,
      charging_efficiency_pct: 94,
    },
    isLoading: false,
  }),
  useBatteryMileage: () => ({ data: [], isLoading: false }),
  useDegradation: () => ({ data: [], isLoading: false }),
}));

vi.mock('../../components/layout/AppLayout',  () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard',  () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/NoVehicleState', () => ({ NoVehicleState: () => <div>connect vehicle</div> }));
vi.mock('../../lib/dates', () => ({
  DEFAULT_TIMEFRAME: { kind: 'preset', preset: '30d' },
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso:    () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  getTimeframeRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  timeframeToQuery: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
  loadDashboardTimeframe: () => undefined,
  saveDashboardTimeframe: vi.fn(),
}));

const mockConfig = {
  schemaVersion: 1,
  id: '00000000-0000-0000-0000-000000000002',
  slug: 'battery',
  name: 'Battery',
  isDefault: true,
  isLocked: true,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [],
};

vi.mock('@riviamigo/dashboards', () => ({
  dashboardKey: (config: { id?: string; slug?: string } | undefined, fallbackSlug: string) =>
    config ? `${config.id}:${config.slug}` : `pending:${fallbackSlug}`,
  findOwnedDashboardBySlug: (dashboards: Array<{ slug: string; ownerId: string | null }> | undefined, slug: string) =>
    dashboards?.find((dashboard) => dashboard.slug === slug && dashboard.ownerId != null),
  isSystemDefaultDashboard: (config: { isDefault: boolean; ownerId: string | null }) =>
    config.isDefault && !config.ownerId,
  materializeSystemDashboardDraft: (draft: object, saved: object) => ({ ...draft, ...saved }),
  materializeUserDashboardDraft: (draft: object, owned?: object | null) => ({
    ...draft,
    ...(owned ?? {}),
    isDefault: false,
    isLocked: false,
  }),
  DashboardRenderer: () => <div data-testid="dashboard-renderer" />,
  useDashboardBySlug: () => ({ data: mockConfig, isLoading: false }),
  useDashboardById: () => ({ data: undefined, isLoading: false }),
  useUpdateDashboard: () => ({ mutateAsync: vi.fn() }),
  useCreateDashboard: () => ({ mutateAsync: vi.fn() }),
  useCloneDashboard: () => ({ mutateAsync: vi.fn() }),
  useUpdateAdminDashboard: () => ({ mutateAsync: vi.fn() }),
  getDefaultBySlug: () => mockConfig,
  downloadDashboardYaml: vi.fn(),
  importDashboardYaml: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: () => ({ data: undefined }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

import { BatteryDashboardPage } from '../../components/dashboard/BatteryDashboardPage';

describe('Battery dashboard page', () => {
  it('renders the page title', () => {
    render(<BatteryDashboardPage navKey="battery" slug="battery" title="Battery" />);
    expect(screen.getByText('Battery')).toBeInTheDocument();
  });

  it('renders the modular dashboard renderer in view mode', () => {
    render(<BatteryDashboardPage navKey="battery" slug="battery" title="Battery" />);
    expect(screen.getByTestId('dashboard-renderer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search charts')).not.toBeInTheDocument();
  });
});
