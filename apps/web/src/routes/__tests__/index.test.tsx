import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@riviamigo/ui/charts', () => ({
  SocAreaChart:          ({ loading }: { loading?: boolean }) => <div data-testid="soc-chart">{loading ? 'loading' : 'soc-chart'}</div>,
  EfficiencyTrendChart:  () => <div data-testid="efficiency-trend-chart" />,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth:           () => ({ defaultVehicleId: 'v1' }),
  useSummaryStats:   () => ({
    data: {
      total_miles: 1234.5,
      total_trips: 42,
      total_kwh_charged: 320.0,
      lifetime_efficiency_wh_mi: 285,
    },
    isLoading: false,
  }),
  useSocHistory:       () => ({ data: [], isLoading: false }),
  useEfficiencyTrend:  () => ({ data: [], isLoading: false }),
  useVehicles:         () => ({ data: [{ id: 'v1', display_name: 'My R1T' }] }),
}));

vi.mock('../../components/layout/AppLayout',  () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard',  () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/NoVehicleState', () => ({ NoVehicleState: () => <div>No vehicle connected</div> }));
vi.mock('../../lib/dates', () => ({
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso:    () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
}));
vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatMiles: (v: number) => `${v.toFixed(1)} mi`,
  formatKwh:   (v: number) => `${v.toFixed(1)} kWh`,
  formatCurrency: (v: number) => `$${v.toFixed(2)}`,
  formatPercent:  (v: number) => `${v}%`,
}));
vi.mock('lucide-react', () => ({
  Battery:    () => <svg data-testid="icon-battery" />,
  TrendingUp: () => <svg data-testid="icon-trending-up" />,
}));

// Import after all mocks
// eslint-disable-next-line import/first
import { DashboardContent } from '../index';

describe('Dashboard (index) page', () => {
  it('renders all four stat card labels', () => {
    render(<DashboardContent />);
    expect(screen.getByText('Total Miles')).toBeInTheDocument();
    expect(screen.getByText('Total Trips')).toBeInTheDocument();
    expect(screen.getByText('Energy Charged')).toBeInTheDocument();
    expect(screen.getByText('Avg Efficiency')).toBeInTheDocument();
  });

  it('renders stat values from summary data', () => {
    render(<DashboardContent />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('285')).toBeInTheDocument();
  });

  it('renders the SoC chart by default', () => {
    render(<DashboardContent />);
    expect(screen.getByTestId('soc-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('efficiency-trend-chart')).not.toBeInTheDocument();
  });

  it('switches to Efficiency Trend chart when tab clicked', () => {
    render(<DashboardContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Efficiency Trend' }));
    expect(screen.getByTestId('efficiency-trend-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('soc-chart')).not.toBeInTheDocument();
  });

  it('switches back to State of Charge chart', () => {
    render(<DashboardContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Efficiency Trend' }));
    fireEvent.click(screen.getByRole('button', { name: 'State of Charge' }));
    expect(screen.getByTestId('soc-chart')).toBeInTheDocument();
  });

  it('renders both metric tab labels', () => {
    render(<DashboardContent />);
    expect(screen.getByRole('button', { name: 'State of Charge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Efficiency Trend' })).toBeInTheDocument();
  });

  it('renders the page title', () => {
    render(<DashboardContent />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});
