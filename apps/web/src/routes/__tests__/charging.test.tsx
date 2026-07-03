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
  useCurrentVehicleStatus: () => ({ data: null }),
  useVehicles: () => ({ data: [{ id: 'v1', display_name: 'Forest R1S' }] }),
  useChargingSummary: () => ({
    data: {
      session_count: 1,
      total_energy_kwh: 50,
      total_cost_usd: 12,
      home_kwh: 20,
      away_kwh: 30,
      ac_kwh: 20,
      dc_kwh: 30,
      charging_cycles: 1,
      charging_efficiency_pct: 94,
      max_charge_rate_kw: 160,
      max_charge_limit_pct: 85,
      typed_session_count: 1,
      weekly: [],
    },
    isLoading: false,
  }),
  useChargeSessions: () => ({
    data: {
      items: [{
        id: 'c1',
        vehicle_id: 'v1',
        started_at: '2024-01-10T00:00:00Z',
        ended_at: '2024-01-10T01:00:00Z',
        location_name: 'Home',
        charger_type: 'ac_l2',
        energy_added_kwh: 50,
        duration_min: 60,
        soc_start: 20,
        soc_end: 80,
        peak_power_kw: 11,
        cost_usd: 12,
      }],
      total: 1,
      page: 1,
      per_page: 25,
    },
    isLoading: false,
  }),
  useChargeCurve: () => ({ data: [], isFetching: false }),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
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
  id: '00000000-0000-0000-0000-000000000004',
  slug: 'charging',
  name: 'Charging',
  isDefault: true,
  isLocked: true,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [],
};

vi.mock('@riviamigo/dashboards', () => ({
  DashboardRenderer: () => <div data-testid="dashboard-renderer" />,
  useDashboardBySlug: () => ({ data: mockConfig, isLoading: false }),
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

import { ChargingDashboardPage } from '../../components/dashboard/ChargingDashboardPage';

describe('Charging dashboard page', () => {
  it('renders the page title', () => {
    render(<ChargingDashboardPage navKey="charging" slug="charging" title="Charging" />);
    expect(screen.getByText('Charging')).toBeInTheDocument();
  });

  it('renders the modular dashboard renderer in view mode', () => {
    render(<ChargingDashboardPage navKey="charging" slug="charging" title="Charging" />);
    expect(screen.getByTestId('dashboard-renderer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search charts')).not.toBeInTheDocument();
  });
});
