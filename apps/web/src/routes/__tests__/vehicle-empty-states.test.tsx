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
  };
});

vi.mock('@riviamigo/ui/charts', () => ({
  SocAreaChart: () => <div data-testid="soc-chart" />,
  RangeAreaChart: () => <div data-testid="range-chart" />,
  PhantomDrainChart: () => <div data-testid="drain-chart" />,
  DegradationChart: () => <div data-testid="degrad-chart" />,
  EnergyBarChart: () => <div data-testid="energy-chart" />,
  EfficiencyChart: () => <div data-testid="mode-chart" />,
  EfficiencyTrendChart: () => <div data-testid="trend-chart" />,
  EfficiencyVsTempChart: () => <div data-testid="temp-chart" />,
  TripMapChart: () => <div data-testid="trip-map-chart" />,
  SpeedProfileChart: () => <div data-testid="speed-chart" />,
  ElevationProfileChart: () => <div data-testid="elevation-chart" />,
  ChargeCurveChart: () => <div data-testid="charge-curve-chart" />,
}));

vi.mock('@riviamigo/ui/tables', () => ({
  DataTable: () => <div data-testid="data-table" />,
  chargingColumns: [],
  tripColumns: [],
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: null, accessToken: null }),
  useVehicles: () => ({ data: [] }),
  useSummaryStats: () => ({ data: undefined, isLoading: false }),
  useSocHistory: () => ({ data: undefined, isLoading: false }),
  useRangeHistory: () => ({ data: undefined, isLoading: false }),
  usePhantomDrain: () => ({ data: undefined, isLoading: false }),
  useDegradation: () => ({ data: undefined, isLoading: false }),
  useChargeSessions: () => ({ data: undefined, isLoading: false }),
  useChargingSummary: () => ({ data: undefined, isLoading: false }),
  useEfficiencySummary: () => ({ data: undefined, isLoading: false }),
  useEfficiencyByMode: () => ({ data: undefined, isLoading: false }),
  useEfficiencyTrend: () => ({ data: undefined, isLoading: false }),
  useEfficiencyVsTemp: () => ({ data: undefined, isLoading: false }),
  useTrips: () => ({ data: undefined, isLoading: false }),
  useTrip: () => ({ data: undefined, isLoading: false }),
  useTripTrack: () => ({ data: undefined, isLoading: false }),
  useSpeedProfile: () => ({ data: undefined, isLoading: false }),
  useElevationProfile: () => ({ data: undefined, isLoading: false }),
  useChargeSession: () => ({ data: undefined, isLoading: false }),
  useChargeCurve: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('../../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/layout/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../lib/dates', () => ({
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
}));

vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatMiles: (v: number) => `${v} mi`,
  formatKwh: (v: number) => `${v} kWh`,
  formatCurrency: (v: number) => `$${v}`,
  formatPercent: (v: number) => `${v}%`,
  formatDuration: (v: number) => `${v} min`,
}));

import { BatteryContent } from '../battery';
import { ChargingContent } from '../charging';
import { ChargeSessionContent } from '../charging.$sessionId';
import { EfficiencyContent } from '../efficiency';
import { TripsContent } from '../trips';
import { TripDetailContent } from '../trips.$tripId';

describe('vehicle empty states', () => {
  it.each([
    ['BatteryContent', <BatteryContent />],
    ['ChargingContent', <ChargingContent />],
    ['ChargeSessionContent', <ChargeSessionContent />],
    ['EfficiencyContent', <EfficiencyContent />],
    ['TripsContent', <TripsContent />],
    ['TripDetailContent', <TripDetailContent />],
  ])('renders connect state for %s when no default vehicle exists', (_name, view) => {
    render(view);

    expect(screen.getByText(/no vehicle/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Rivian' })).toBeInTheDocument();
  });
});