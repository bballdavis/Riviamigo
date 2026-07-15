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
    useParams: () => ({ tripId: 'trip-abc' }),
  };
});

vi.mock('@riviamigo/ui/charts', () => ({
  DEFAULT_CURVE_SMOOTHING: 0.2,
  TripMapChart:           () => <div data-testid="trip-map-chart">map</div>,
  RichTimeSeriesChart:    ({ series, height }: { series: Array<{ label: string }>; height?: number }) => <div data-testid="trip-drive-chart" data-height={height}>{series.map((item) => item.label).join(', ')}</div>,
  CHART_COLORS:           { accent: '#fff', success: '#fff', sky: '#fff', emerald: '#fff', warning: '#fff', teal: '#fff' },
  SpeedHistogramChart:    () => <div data-testid="speed-histogram-chart" />,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth:            () => ({ defaultVehicleId: null }),
  useResolvedVehicleSelection: () => ({ authReady: true, effectiveVehicleId: 'v1', vehicleSelectionReady: true }),
  useDocumentTheme:   () => false,
  useTripDetailData:  () => ({
    data: {
      trip: {
        id: 'trip-abc',
        vehicle_id: 'v1',
        started_at: '2024-03-15T10:30:00Z',
        ended_at: '2024-03-15T11:30:00Z',
        distance_mi: 42.5,
        energy_used_kwh: 12.3,
        efficiency_wh_mi: 289,
        duration_seconds: 3600,
      },
      sample_interval_seconds: 30,
      samples: {
        elapsed_s: [300], lat: [1], lng: [2], altitude_m: [10], speed_mph: [42], power_kw: [38], regen_power_kw: [0], battery_level: [68],
        outside_temp_c: [10], cabin_temp_c: [18], driver_temp_c: [18], hvac_active: [false], tire_fl_psi: [48], tire_fr_psi: [48], tire_rl_psi: [49], tire_rr_psi: [49],
      },
      outside_temperature: {
        source: 'open_meteo',
        samples: [{ elapsed_s: 300, ts: '2024-03-15T10:35:00Z', temperature_c: 10, source: 'open_meteo' }],
        attribution: { name: 'Open-Meteo', url: 'https://open-meteo.com/' },
      },
    },
  }),
}));

vi.mock('../../components/layout/AppLayout',  () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard',  () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/NoVehicleState', () => ({
  NoVehicleState: ({ title }: { title?: string }) => <div data-testid="no-vehicle">{title ?? 'No vehicle'}</div>,
}));
vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatMiles:      (v: number) => `${v} mi`,
  formatMph:        (v: number) => `${v.toFixed(1)} mph`,
  formatDuration:   (v: number) => `${v} min`,
  formatEfficiencyValue: (v: number) => `${v}`,
  getEfficiencyUnitLabel: () => 'Wh/mi',
  getUnitPreferences: () => ({ temperature_unit: 'celsius', pressure_unit: 'psi' }),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    ArrowLeft: () => <svg data-testid="icon-arrow-left" />,
  };
});

import { TripDetailContent } from '../trips.$tripId';

describe('Trip Detail page', () => {
  it('renders all four stat card labels', () => {
    render(<TripDetailContent />);
    expect(screen.getByText('Location unavailable')).toBeInTheDocument();
    expect(screen.getByText('Distance Driven')).toBeInTheDocument();
    expect(screen.getByText('Avg. Effic. (Wh/mi)')).toBeInTheDocument();
    expect(screen.getByText('Avg. Speed')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
  });

  it('renders map and both charts together', () => {
    render(<TripDetailContent />);
    expect(screen.getByTestId('trip-map-chart')).toBeInTheDocument();
    expect(screen.getByText('Drive Chart')).toBeInTheDocument();
    expect(screen.getByText('Speed Histogram')).toBeInTheDocument();
    expect(screen.getByText('Temperature')).toBeInTheDocument();
    expect(screen.getByText('Tire Pressure')).toBeInTheDocument();
    expect(screen.getByText(/Outside \(estimated\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open-Meteo' })).toHaveAttribute('href', 'https://open-meteo.com/');
  });

  it('matches the drive chart height to the route map', () => {
    render(<TripDetailContent />);

    expect(screen.getAllByTestId('trip-drive-chart')[0]).toHaveAttribute('data-height', '360');
  });

  it('renders back icon button', () => {
    render(<TripDetailContent />);
    expect(screen.getByRole('button', { name: 'Back to trips' })).toBeInTheDocument();
  });

  it('navigates to /trips when Back is clicked', () => {
    render(<TripDetailContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to trips' }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/trips' });
  });

  it('renders stat values from trip data', () => {
    render(<TripDetailContent />);
    expect(screen.getByText('42.5 mi')).toBeInTheDocument();
    expect(screen.getByText('289')).toBeInTheDocument();
  });
});
