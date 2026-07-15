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
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

vi.mock('@riviamigo/ui/charts', () => ({
  DEFAULT_CURVE_SMOOTHING: 0.2,
  TripMapChart: () => <div data-testid="trip-map-chart" />,
  RichTimeSeriesChart: () => <div data-testid="trip-drive-chart" />,
  CHART_COLORS: {
    accent: '#fff', success: '#fff', sky: '#fff', emerald: '#fff', warning: '#fff', teal: '#fff',
  },
  SpeedHistogramChart: () => <div data-testid="speed-histogram-chart" />,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: null }),
  useResolvedVehicleSelection: () => ({ authReady: true, effectiveVehicleId: 'vehicle-1', vehicleSelectionReady: true }),
  useDocumentTheme: () => false,
  useTripDetailData: () => ({
    data: {
      trip: {
      id: 'trip-1',
      vehicle_id: 'vehicle-1',
      started_at: '2024-01-01T12:00:00Z',
      ended_at: '2024-01-01T13:00:00Z',
      distance_mi: 18.3,
      energy_used_kwh: 6.5,
      efficiency_wh_mi: 355,
      max_speed_mph: 72,
      drive_mode: 'everyday',
      soc_start: 80,
      soc_end: 68,
      duration_seconds: 3600,
      },
      sample_interval_seconds: 30,
      samples: {
        elapsed_s: [30], lat: [1], lng: [2], altitude_m: [10], speed_mph: [45], power_kw: [42], regen_power_kw: [0], battery_level: [80],
        outside_temp_c: [12], cabin_temp_c: [20], driver_temp_c: [20], hvac_active: [true], tire_fl_psi: [48], tire_fr_psi: [47], tire_rl_psi: [49], tire_rr_psi: [49],
      },
    },
  }),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatMiles: (v: number) => `${v} mi`,
  formatDuration: (v: number) => `${v} min`,
  formatMph: (v: number) => `${v.toFixed(1)} mph`,
  formatEfficiencyValue: (v: number) => `${v}`,
  getEfficiencyUnitLabel: () => 'Wh/mi',
  getUnitPreferences: () => ({ temperature_unit: 'celsius', pressure_unit: 'psi' }),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

import { TripDetailContent } from '../trips.$tripId';

describe('Trip detail page', () => {
  it('renders trip stat cards and synchronized sections', () => {
    render(<TripDetailContent />);

    expect(screen.getByText('Location unavailable')).toBeInTheDocument();
    expect(screen.getByText('Distance Driven')).toBeInTheDocument();
    expect(screen.getByText('Avg. Effic. (Wh/mi)')).toBeInTheDocument();
    expect(screen.getByText('Avg. Speed')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Drive Chart')).toBeInTheDocument();
    expect(screen.getByText('Speed Histogram')).toBeInTheDocument();
    expect(screen.getByText('Temperature')).toBeInTheDocument();
    expect(screen.getByText('Tire Pressure')).toBeInTheDocument();
    expect(screen.getByTestId('trip-map-chart')).toBeInTheDocument();
  });

  it('navigates back to the trips page', () => {
    render(<TripDetailContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to trips' }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/trips' });
  });
});
