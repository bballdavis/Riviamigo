import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const mockNavigate = vi.fn();
const mockSession = vi.hoisted(() => ({ cost_usd: 8.75 as number | null }));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ sessionId: 'session-1' }),
  };
});

vi.mock('@riviamigo/dashboards', () => ({
  DashboardChartWidget: () => <div data-testid="charge-curve-chart" />,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'vehicle-1' }),
  useChargeSession: () => ({
    data: {
      id: 'session-1',
      vehicle_id: 'vehicle-1',
      started_at: '2024-01-01T12:00:00Z',
      ended_at: '2024-01-01T13:15:00Z',
      location_name: 'Home Charger',
      charger_type: 'level2',
      energy_added_kwh: 28.5,
      soc_start: 20,
      soc_end: 80,
      peak_power_kw: 11.5,
      cost_usd: mockSession.cost_usd,
      duration_min: 75,
      source: 'telemetry+rivian_api',
      telemetry_sample_count: 12,
      network_vendor: 'Rivian',
      range_added_km: 88.4,
      rivian_paid_total: 8.75,
      rivian_city: 'Austin',
    },
  }),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatKwh: (v: number) => `${v} kWh`,
  formatDuration: (v: number) => `${v} min`,
  formatCurrency: (v: number) => `$${v}`,
  formatPercent: (v: number) => `${v}%`,
  formatEfficiency: (v: number) => `${v} Wh/mi`,
}));
vi.mock('lucide-react', () => ({
  ArrowLeft: () => <svg data-testid="icon-arrow-left" />,
  Database: () => <svg data-testid="icon-database" />,
  MapPin: () => <svg data-testid="icon-map-pin" />,
  RadioTower: () => <svg data-testid="icon-radio" />,
  Receipt: () => <svg data-testid="icon-receipt" />,
  Route: () => <svg data-testid="icon-route" />,
  Zap: () => <svg data-testid="icon-zap" />,
}));

import { ChargeSessionContent } from '../charging.$sessionId';

describe('Charge session detail page', () => {
  beforeEach(() => {
    mockSession.cost_usd = 8.75;
  });

  it('renders session details and the charge curve chart', () => {
    render(<ChargeSessionContent />);

    expect(screen.getByText('Home Charger')).toBeInTheDocument();
    expect(screen.getByText('Energy Added')).toBeInTheDocument();
    expect(screen.getByText('28.5 kWh')).toBeInTheDocument();
    expect(screen.getByText('SoC')).toBeInTheDocument();
    expect(screen.getByText('20% -> 80%')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('75 min')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getAllByText('$8.75').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Telemetry + Rivian API')).toBeInTheDocument();
    expect(screen.getByText('12 samples matched')).toBeInTheDocument();
    expect(screen.getByText('88.4 km added')).toBeInTheDocument();
    expect(screen.getByText('Austin')).toBeInTheDocument();
    // Chart title/subtitle are rendered inside DashboardChartWidget (mocked);
    // assert only on the testid that the mock emits.
    expect(screen.getByTestId('charge-curve-chart')).toBeInTheDocument();
  });

  it('renders missing cost as a dash instead of zero dollars', () => {
    mockSession.cost_usd = null;
    render(<ChargeSessionContent />);

    const costLabel = screen.getByText('Cost');
    expect(costLabel.parentElement).toHaveTextContent('-');
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('navigates back to the charging page', () => {
    render(<ChargeSessionContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to charging' }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/charging' });
  });
});
