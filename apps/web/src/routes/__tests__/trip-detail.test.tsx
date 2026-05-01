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
  TripMapChart: () => <div data-testid="trip-map-chart" />,
  SpeedProfileChart: () => <div data-testid="speed-chart" />,
  ElevationProfileChart: () => <div data-testid="elevation-chart" />,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'vehicle-1' }),
  useTrip: () => ({
    data: {
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
  }),
  useTripTrack: () => ({ data: [{ lat: 1, lng: 2 }], isLoading: false }),
  useSpeedProfile: () => ({ data: [{ elapsed_s: 30, speed_mph: 45 }], isLoading: false }),
  useElevationProfile: () => ({ data: [{ ts: '2024-01-01T12:00:00Z', value: 100 }], isLoading: false }),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatMiles: (v: number) => `${v} mi`,
  formatDuration: (v: number) => `${v} min`,
  formatKwh: (v: number) => `${v} kWh`,
  formatEfficiency: (v: number) => `${v} Wh/mi`,
}));

import { TripDetailContent } from '../trips.$tripId';

describe('Trip detail page', () => {
  it('renders trip stat cards and the map by default', () => {
    render(<TripDetailContent />);

    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Energy Used')).toBeInTheDocument();
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(screen.getByTestId('trip-map-chart')).toBeInTheDocument();
  });

  it('switches between trip analysis tabs and navigates back', () => {
    render(<TripDetailContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Speed' }));
    expect(screen.getByTestId('speed-chart')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Elevation' }));
    expect(screen.getByTestId('elevation-chart')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/trips' });
  });
});
