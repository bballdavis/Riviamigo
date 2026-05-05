import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'v1', accessToken: 'tok' }),
  useCurrentVehicleStatus: () => ({ data: null }),
  useVehicles: () => ({ data: [{ id: 'v1', display_name: 'Forest R1S' }] }),
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
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso:    () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
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
  DashboardRenderer: () => <div data-testid="dashboard-renderer" />,
  useDashboardBySlug: () => ({ data: mockConfig, isLoading: false }),
  useUpdateDashboard: () => ({ mutateAsync: vi.fn() }),
  useCloneDashboard: () => ({ mutateAsync: vi.fn() }),
  getDefaultBySlug: () => mockConfig,
  downloadDashboardYaml: vi.fn(),
  importDashboardYaml: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { BatteryDashboardPage } from '../../components/dashboard/BatteryDashboardPage';

describe('Battery dashboard page', () => {
  it('renders the page title', () => {
    render(<BatteryDashboardPage navKey="battery" slug="battery" title="Battery" />);
    expect(screen.getByText('Battery')).toBeInTheDocument();
  });

  it('renders Battery Health stats and chart picker without duplicate widgets', () => {
    render(<BatteryDashboardPage navKey="battery" slug="battery" title="Battery" />);
    expect(screen.getByText('Charging Cycles')).toBeInTheDocument();
    expect(screen.getByText('Battery Capacity by Mileage')).toBeInTheDocument();
    expect(screen.getByLabelText('Search charts')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-renderer')).not.toBeInTheDocument();
  });
});
