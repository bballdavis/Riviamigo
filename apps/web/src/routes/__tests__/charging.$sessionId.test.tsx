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
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ sessionId: 'session-xyz' }),
  };
});

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'v1' }),
  useChargeSession: () => ({
    data: {
      id: 'session-xyz',
      started_at: '2024-03-15T10:30:00Z',
      energy_added_kwh: 45.2,
      soc_start: 20,
      soc_end: 90,
      cost_usd: 12.50,
      location_name: 'Home',
      duration_min: 90,
      source: 'telemetry',
      telemetry_sample_count: 0,
      charger_type: 'ac',
    },
  }),
  useChargeCurve: () => ({ data: [], isLoading: false }),
}));

vi.mock('@riviamigo/dashboards', () => ({
  DashboardChartWidget: ({ title }: { title?: string }) => (
    <div data-testid="dashboard-chart-widget">{title}</div>
  ),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/NoVehicleState', () => ({
  NoVehicleState: ({ title }: { title?: string }) => <div data-testid="no-vehicle">{title ?? 'No vehicle'}</div>,
}));
vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatKwh: (v: number) => `${v} kWh`,
  formatCurrency: (v: number) => `$${v.toFixed(2)}`,
  formatPercent: (v: number) => `${v}%`,
  formatDuration: (v: number) => `${v} min`,
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

describe('Charge Session Detail page', () => {
  it('renders all four stat card labels', () => {
    render(<ChargeSessionContent />);
    expect(screen.getByText('Energy Added')).toBeInTheDocument();
    expect(screen.getByText('SoC')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
  });

  it('renders the charge curve chart widget', () => {
    render(<ChargeSessionContent />);
    expect(screen.getByTestId('dashboard-chart-widget')).toBeInTheDocument();
  });

  it('renders session stat values', () => {
    render(<ChargeSessionContent />);
    expect(screen.getByText('45.2 kWh')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
  });

  it('renders the SoC range as start to end', () => {
    render(<ChargeSessionContent />);
    expect(screen.getByText('20% -> 90%')).toBeInTheDocument();
  });

  it('renders source telemetry and network facts for telemetry sessions', () => {
    render(<ChargeSessionContent />);
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Live telemetry')).toBeInTheDocument();
    expect(screen.getByText('Telemetry')).toBeInTheDocument();
    expect(screen.getByText('No telemetry samples matched')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getAllByText('Home').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the Charge Curve section title', () => {
    render(<ChargeSessionContent />);
    expect(screen.getByText('Charge Curve')).toBeInTheDocument();
  });

  it('renders Back button', () => {
    render(<ChargeSessionContent />);
    expect(screen.getByRole('button', { name: /back to charging/i })).toBeInTheDocument();
  });

  it('navigates to /charging when Back is clicked', () => {
    render(<ChargeSessionContent />);
    fireEvent.click(screen.getByRole('button', { name: /back to charging/i }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/charging' });
  });
});
