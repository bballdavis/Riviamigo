import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

vi.mock('@riviamigo/ui/charts', () => ({
  SocAreaChart: () => <div data-testid="soc-chart" />,
  EfficiencyTrendChart: () => <div data-testid="efficiency-chart" />,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'vehicle-1' }),
  useCurrentVehicleStatus: () => ({
    data: {
      vehicle_id: 'vehicle-1',
      battery_level: 79,
      range_miles: 210,
      power_state: 'go',
      charger_state: null,
      speed_mph: 0,
      latitude: null,
      longitude: null,
      altitude_m: 12,
      drive_mode: 'all_purpose',
      is_online: true,
      last_updated: '2024-01-01T00:00:00Z',
    },
  }),
  useSummaryStats: () => ({
    data: {
      total_miles: 1234,
      total_trips: 42,
      total_energy_kwh: 456.7,
      avg_efficiency_wh_mi: 318,
      total_charge_sessions: 8,
      total_cost_usd: 12.5,
    },
    isLoading: false,
  }),
  useSocHistory: () => ({ data: [{ ts: '2024-01-01T00:00:00Z', soc: 79 }], isLoading: false }),
  useEfficiencyTrend: () => ({ data: [{ day: '2024-01-01', day_avg_wh_mi: 320, rolling_7d_wh_mi: 315 }], isLoading: false }),
  useVehicles: () => ({ data: [{ id: 'vehicle-1', display_name: 'Forest R1S' }] }),
}));

const mockConfig = {
  schemaVersion: 1,
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'dashboard',
  name: 'Dashboard',
  isDefault: true,
  isLocked: true,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [],
};

vi.mock('@riviamigo/dashboards', () => ({
  DashboardRenderer: () => (
    <div>
      <div>Total Miles</div>
      <div>Total Trips</div>
      <div>Energy Charged</div>
      <div>Avg Efficiency</div>
      <div data-testid="soc-chart" />
    </div>
  ),
  useDashboardBySlug: () => ({ data: mockConfig, isLoading: false }),
  useUpdateDashboard: () => ({ mutateAsync: vi.fn() }),
  getDefaultBySlug: () => mockConfig,
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../lib/dates', () => ({
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
}));
vi.mock('@riviamigo/ui/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/ui/lib/utils')>();
  return {
    ...actual,
    formatMiles: (v: number) => `${v} mi`,
    formatKwh: (v: number) => `${v} kWh`,
    formatEfficiency: (v: number) => `${v} Wh/mi`,
    formatAltitude: (v: number) => `${v} m`,
  };
});

import { indexRoute } from '../index';

const DashboardContent = indexRoute.options.component as React.ComponentType;

describe('Dashboard page', () => {
  it('renders the vehicle subtitle and summary stat labels', () => {
    render(<DashboardContent />);

    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Total Miles')).toBeInTheDocument();
    expect(screen.getByText('Total Trips')).toBeInTheDocument();
    expect(screen.getByText('Energy Charged')).toBeInTheDocument();
    expect(screen.getByText('Avg Efficiency')).toBeInTheDocument();
  });

  it('shows the dashboard renderer', () => {
    render(<DashboardContent />);

    expect(screen.getByTestId('soc-chart')).toBeInTheDocument();
  });
});
