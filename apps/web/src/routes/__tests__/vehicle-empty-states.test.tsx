import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1', sessionId: 'session-1' }),
    useSearch: () => ({}),
  };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: () => ({ data: undefined }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatKwh: (v: number) => `${v} kWh`,
  formatDuration: (s: number) => `${s}s`,
  formatCurrency: (v: number) => `$${v}`,
  formatPercent: (v: number) => `${v}%`,
  formatMiles: (v: number) => `${v} mi`,
  formatEfficiency: (v: number) => `${v} Wh/mi`,
  formatEfficiencyValue: (v: number) => `${v}`,
  formatMph: (v: number) => `${v} mph`,
  getEfficiencyUnitLabel: () => 'Wh/mi',
  getUnitPreferences: () => ({ system: 'imperial', efficiencyDisplay: 'distance_per_energy' }),
  getEfficiencyDisplay: () => 'distance_per_energy',
  setEfficiencyDisplay: vi.fn(),
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@riviamigo/ui/charts', () => ({
  TripMapChart: () => <div data-testid="trip-map-chart" />,
  TripDriveChart: () => <div data-testid="trip-drive-chart" />,
  SpeedHistogramChart: () => <div data-testid="speed-histogram-chart" />,
  TripTemperatureChart: () => <div data-testid="trip-temperature-chart" />,
  TripElevationChart: () => <div data-testid="trip-elevation-chart" />,
  TripTirePressureChart: () => <div data-testid="trip-tire-pressure-chart" />,
  ChargeCurveChart: () => <div data-testid="charge-curve-chart" />,
}));

vi.mock('@riviamigo/ui/tables', () => ({
  DataTable: () => <div data-testid="data-table" />,
  chargingColumns: [],
  tripColumns: [],
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: null, accessToken: null }),
  useCurrentVehicleStatus: () => ({ data: null }),
  useVehicles: () => ({ data: [] }),
  useChargeSession: () => ({ data: undefined, isLoading: false }),
  useChargeCurve: () => ({ data: undefined, isLoading: false }),
  useTrip: () => ({ data: undefined, isLoading: false }),
  useTripTrack: () => ({ data: undefined, isLoading: false }),
  useTripDetailSeries: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('../../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/layout/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/layout/NoVehicleState', () => ({
  NoVehicleState: () => (
    <div>
      <p>No vehicle connected</p>
      <button>Connect Rivian</button>
    </div>
  ),
}));

vi.mock('../../lib/dates', () => ({
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
}));

const emptyConfig = {
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
  DashboardRenderer: () => <div data-testid="dashboard-renderer" />,
  useDashboardBySlug: () => ({ data: emptyConfig, isLoading: false }),
  useUpdateDashboard: () => ({ mutateAsync: vi.fn() }),
  useCreateDashboard: () => ({ mutateAsync: vi.fn() }),
  useCloneDashboard: () => ({ mutateAsync: vi.fn() }),
  useUpdateAdminDashboard: () => ({ mutateAsync: vi.fn() }),
  getDefaultBySlug: () => emptyConfig,
  downloadDashboardYaml: vi.fn(),
  importDashboardYaml: vi.fn(),
}));

import { DashboardPage } from '../../components/dashboard/DashboardPage';
import { ChargeSessionContent } from '../charging.$sessionId';
import { TripDetailContent } from '../trips.$tripId';

describe('vehicle empty states', () => {
  it.each([
    ['Battery',    <DashboardPage navKey="battery" slug="battery" title="Battery" />],
    ['Charging',   <DashboardPage navKey="charging" slug="charging" title="Charging" />],
    ['Efficiency', <DashboardPage navKey="efficiency" slug="efficiency" title="Efficiency" />],
    ['Trips',      <DashboardPage navKey="trips" slug="trips" title="Trips" />],
  ])('renders connect state for %s when no default vehicle exists', (_name, view) => {
    render(view);
    expect(screen.getByText(/no vehicle/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Rivian' })).toBeInTheDocument();
  });

  it.each([
    ['ChargeSessionContent', <ChargeSessionContent />],
    ['TripDetailContent', <TripDetailContent />],
  ])('renders connect state for %s when no default vehicle exists', (_name, view) => {
    render(view);
    expect(screen.getByText(/no vehicle/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Rivian' })).toBeInTheDocument();
  });
});
