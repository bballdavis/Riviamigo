import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const mockNavigate = vi.fn();
const mockSession = vi.hoisted(() => ({
  cost_usd: 8.75 as number | null,
  source: 'telemetry+rivian_api' as string,
  telemetry_sample_count: 12 as number,
}));
const correctionMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  role: 'owner' as 'owner' | 'manager' | 'viewer',
}));

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
  useAuth: () => ({ defaultVehicleId: null }),
  useResolvedVehicleSelection: () => ({ authReady: true, effectiveVehicleId: 'vehicle-1', vehicleSelectionReady: true }),
  useSavedPlaces: () => ({ data: [], isLoading: false }),
  useUpdateChargeSession: () => ({ mutate: correctionMutation.mutate, isPending: false, isLoading: false, error: null }),
  useVehicles: () => ({ data: [{ id: 'vehicle-1', membership_role: correctionMutation.role }] }),
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
      source: mockSession.source,
      api_started_at: '2024-01-01T11:45:00Z',
      api_ended_at: '2024-01-01T13:30:00Z',
      data_confidence: 'telemetry_enriched',
      telemetry_sample_count: mockSession.telemetry_sample_count,
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
  RotateCcw: () => <svg data-testid="icon-restore" />,
}));

import { ChargeSessionContent } from '../charging.$sessionId';

describe('ChargeSessionContent', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSession.cost_usd = 8.75;
    mockSession.source = 'telemetry+rivian_api';
    mockSession.telemetry_sample_count = 12;
    correctionMutation.role = 'owner';
    correctionMutation.mutate.mockClear();
  });

  it('renders session details and the charge curve chart', () => {
    render(<ChargeSessionContent />);

    expect(screen.getAllByText('Home Charger').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Energy Added')).toBeInTheDocument();
    expect(screen.getByText('28.5 kWh')).toBeInTheDocument();
    expect(screen.getByText('SoC')).toBeInTheDocument();
    expect(screen.getByText('20% -> 80%')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('75 min')).toBeInTheDocument();
    expect(screen.getByTestId('stat-cost')).toBeInTheDocument();
    expect(screen.getAllByText('$8.75').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Telemetry + Rivian API')).toBeInTheDocument();
    expect(screen.getByText('Telemetry')).toBeInTheDocument();
    expect(screen.getByText('12 samples matched')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /January 1, 2024/ })).toBeInTheDocument();
    expect(screen.getByText('88.4 km added')).toBeInTheDocument();
    expect(screen.getByText('Austin')).toBeInTheDocument();
    // Chart title/subtitle are rendered inside DashboardChartWidget (mocked);
    // assert only on the testid that the mock emits.
    expect(screen.getByTestId('charge-curve-chart')).toBeInTheDocument();
  });

  it('renders missing cost as a dash instead of zero dollars', () => {
    mockSession.cost_usd = null;
    render(<ChargeSessionContent />);

    expect(screen.getByTestId('stat-cost')).toHaveTextContent('-');
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('navigates back to the charging page', () => {
    render(<ChargeSessionContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to charging' }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/charging' });
  });

  it('labels rivian_api sessions with telemetry evidence as telemetry plus api', () => {
    mockSession.source = 'rivian_api';
    mockSession.telemetry_sample_count = 6;
    render(<ChargeSessionContent />);

    expect(screen.getByText('Telemetry + Rivian API')).toBeInTheDocument();
    expect(screen.queryByText('Rivian API backfill')).not.toBeInTheDocument();
  });

  it('saves a free override and restores automatic cost with partial payloads', () => {
    render(<ChargeSessionContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Free' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save corrections' }));
    expect(correctionMutation.mutate).toHaveBeenLastCalledWith(
      { sessionId: 'session-1', location_mode: 'automatic', cost_mode: 'free' },
      expect.any(Object),
    );

    fireEvent.click(screen.getByRole('button', { name: /Restore automatic cost/ }));
    expect(correctionMutation.mutate).toHaveBeenLastCalledWith(
      { sessionId: 'session-1', cost_mode: 'automatic' },
      expect.any(Object),
    );
  });

  it('blocks empty and negative manual costs with recovery copy', () => {
    render(<ChargeSessionContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Manual' }));
    expect(screen.getByText('Enter a non-negative USD amount.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save corrections' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Manual cost (USD)'), { target: { value: '-1' } });
    expect(screen.getByText('Enter a non-negative USD amount.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save corrections' })).toBeDisabled();
    expect(correctionMutation.mutate).not.toHaveBeenCalled();
  });

  it('keeps correction values visible but disables controls for a viewer', () => {
    correctionMutation.role = 'viewer';
    render(<ChargeSessionContent />);

    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Free' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save corrections' })).not.toBeInTheDocument();
    expect(correctionMutation.mutate).not.toHaveBeenCalled();
  });
});
