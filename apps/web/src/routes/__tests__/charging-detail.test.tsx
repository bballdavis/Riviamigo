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
  location_name: 'Home Charger' as string,
  range_added_km: 88.4 as number | null,
  source: 'telemetry+rivian_api' as string,
  telemetry_sample_count: 12 as number,
  active: false,
  live_total_charged_kwh: null as number | null,
  live_soc_pct: null as number | null,
  live_time_elapsed_seconds: null as number | null,
  live_time_remaining_min: null as number | null,
  live_power_kw: null as number | null,
  live_charge_rate_kph: null as number | null,
  live_charger_state: null as string | null,
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
  ChargeSessionCurveDetail: () => <div data-testid="charge-curve-chart" />,
  SensorChipSummary: ({ title, value, secondary }: { title: string; value: string; secondary?: string }) => (
    <div data-testid={`sensor-chip-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <span>{title}</span>
      <span>{value}</span>
      {secondary ? <span>{secondary}</span> : null}
    </div>
  ),
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
      ended_at: mockSession.active ? null : '2024-01-01T13:15:00Z',
      location_name: mockSession.location_name,
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
      range_added_km: mockSession.range_added_km,
      rivian_paid_total: 8.75,
      rivian_city: 'Austin',
      live_total_charged_kwh: mockSession.live_total_charged_kwh,
      live_soc_pct: mockSession.live_soc_pct,
      live_time_elapsed_seconds: mockSession.live_time_elapsed_seconds,
      live_time_remaining_min: mockSession.live_time_remaining_min,
      live_power_kw: mockSession.live_power_kw,
      live_charge_rate_kph: mockSession.live_charge_rate_kph,
      live_charger_state: mockSession.live_charger_state,
    },
  }),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatKwh: (v: number) => `${v} kWh`,
  formatDuration: (v: number) => `${v} min`,
  formatCurrency: (v: number) => `$${v}`,
  formatDistanceKm: (v: number) => `${v.toFixed(1)} km`,
  formatPercent: (v: number) => `${v}%`,
  formatEfficiency: (v: number) => `${v} Wh/mi`,
}));
vi.mock('lucide-react', () => ({
  ArrowLeft: () => <svg data-testid="icon-arrow-left" />,
  Info: () => <svg data-testid="icon-info" />,
  MapPin: () => <svg data-testid="icon-map-pin" />,
  Edit2: () => <svg data-testid="icon-edit" />,
  RadioTower: () => <svg data-testid="icon-radio" />,
  Receipt: () => <svg data-testid="icon-receipt" />,
  Route: () => <svg data-testid="icon-route" />,
  Zap: () => <svg data-testid="icon-zap" />,
  RotateCcw: () => <svg data-testid="icon-restore" />,
  Save: () => <svg data-testid="icon-save" />,
}));

import { ChargeSessionContent } from '../charging.$sessionId';

describe('ChargeSessionContent', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSession.cost_usd = 8.75;
    mockSession.location_name = 'Home Charger';
    mockSession.range_added_km = 88.4;
    mockSession.source = 'telemetry+rivian_api';
    mockSession.telemetry_sample_count = 12;
    mockSession.active = false;
    mockSession.live_total_charged_kwh = null;
    mockSession.live_soc_pct = null;
    mockSession.live_time_elapsed_seconds = null;
    mockSession.live_time_remaining_min = null;
    mockSession.live_power_kw = null;
    mockSession.live_charge_rate_kph = null;
    mockSession.live_charger_state = null;
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
    expect(screen.getByTestId('sensor-chip-cost')).toBeInTheDocument();
    expect(screen.getAllByText('$8.75').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Telemetry + Rivian API')).not.toBeInTheDocument();
    expect(screen.getByText('Range added: 88.4 km')).toBeInTheDocument();
    const sourceDetailsButton = screen.getByRole('button', { name: 'Show session source details' });
    expect(sourceDetailsButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(sourceDetailsButton);
    expect(screen.getByRole('button', { name: 'Hide session source details' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('heading', { name: 'Source Information' })).toBeInTheDocument();
    expect(screen.getByText('Telemetry + Rivian API')).toBeInTheDocument();
    expect(screen.getByText('Telemetry')).toBeInTheDocument();
    expect(screen.getByText('12 samples matched')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /January 1, 2024/ })).toBeInTheDocument();
    expect(screen.queryByText('88.4 km added')).not.toBeInTheDocument();
    expect(screen.getByText('Austin')).toBeInTheDocument();
    expect(screen.queryByTestId('sensor-chip-range')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide session source details' }));
    expect(screen.queryByText('Telemetry + Rivian API')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Session charging trace' })).toBeInTheDocument();
    expect(screen.getByTestId('charge-curve-chart')).toBeInTheDocument();
    expect(screen.queryByText('Corrections')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit charging session' })).toBeInTheDocument();
  });

  it('renders live values and pending semantics for an in-progress session', () => {
    mockSession.active = true;
    mockSession.cost_usd = null;
    mockSession.live_total_charged_kwh = 12.4;
    mockSession.live_soc_pct = 57;
    mockSession.live_time_elapsed_seconds = 1800;
    mockSession.live_time_remaining_min = 42;
    mockSession.live_power_kw = 11.2;
    mockSession.live_charge_rate_kph = 48;
    mockSession.live_charger_state = 'charging';

    render(<ChargeSessionContent />);

    expect(screen.getByText('12.4 kWh')).toBeInTheDocument();
    expect(screen.getByText('20% -> 57% · Live')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('11.2 kW')).toBeInTheDocument();
    expect(screen.getByText('48 km/h')).toBeInTheDocument();
    expect(screen.getByText('42 min')).toBeInTheDocument();
    expect(screen.getByText('charging')).toBeInTheDocument();
  });

  it('opens the correction editor from the page header and separates location and cost summaries', () => {
    render(<ChargeSessionContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit charging session' }));

    expect(screen.getByText('Corrections')).toBeInTheDocument();
    expect(screen.getAllByText('Location').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Cost').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Recorded coordinates: Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Original telemetry')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save charging corrections' })).toBeInTheDocument();
  });

  it('renders missing cost as a dash instead of zero dollars', () => {
    mockSession.cost_usd = null;
    render(<ChargeSessionContent />);

    expect(screen.getByTestId('sensor-chip-cost')).toHaveTextContent('-');
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

    fireEvent.click(screen.getByRole('button', { name: 'Show session source details' }));
    expect(screen.getByText('Telemetry + Rivian API')).toBeInTheDocument();
    expect(screen.queryByText('Rivian API backfill')).not.toBeInTheDocument();
  });

  it('saves a free override and restores automatic cost with partial payloads', () => {
    render(<ChargeSessionContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit charging session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Free' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save charging corrections' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Edit charging session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }));
    expect(screen.getByText('Enter a non-negative USD amount.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save charging corrections' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Manual cost (USD)'), { target: { value: '-1' } });
    expect(screen.getByText('Enter a non-negative USD amount.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save charging corrections' })).toBeDisabled();
    expect(correctionMutation.mutate).not.toHaveBeenCalled();
  });

  it('keeps correction values visible but disables controls for a viewer', () => {
    correctionMutation.role = 'viewer';
    render(<ChargeSessionContent />);

    expect(screen.queryByRole('button', { name: 'Edit charging session' })).not.toBeInTheDocument();
    expect(screen.queryByText('Corrections')).not.toBeInTheDocument();
    expect(correctionMutation.mutate).not.toHaveBeenCalled();
  });

  it('omits the range secondary value when the session has no range data', () => {
    mockSession.range_added_km = null;
    render(<ChargeSessionContent />);

    expect(screen.queryByText(/Range added:/)).not.toBeInTheDocument();
  });

  it('keeps long charging locations readable instead of truncating them', () => {
    mockSession.location_name = 'Rogers, AR Supercharger, 4000 West Walnut Street';
    render(<ChargeSessionContent />);

    expect(screen.getByText('Rogers, AR Supercharger, 4000 West Walnut Street')).toBeInTheDocument();
  });
});
