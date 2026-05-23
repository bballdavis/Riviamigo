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
  TripMapChart:           ({ loading }: { loading?: boolean }) => <div data-testid="trip-map-chart">{loading ? 'loading' : 'map'}</div>,
  SpeedProfileChart:      () => <div data-testid="speed-chart" />,
  ElevationProfileChart:  () => <div data-testid="elevation-chart" />,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth:            () => ({ defaultVehicleId: 'v1' }),
  useTrip:            () => ({
    data: {
      id: 'trip-abc',
      started_at: '2024-03-15T10:30:00Z',
      distance_mi: 42.5,
      energy_used_kwh: 12.3,
      efficiency_wh_mi: 289,
      duration_seconds: 3600,
    },
  }),
  useTripTrack:       () => ({ data: [], isLoading: false }),
  useSpeedProfile:    () => ({ data: [], isLoading: false }),
  useElevationProfile: () => ({ data: [], isLoading: false }),
}));

vi.mock('../../components/layout/AppLayout',  () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard',  () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/NoVehicleState', () => ({
  NoVehicleState: ({ title }: { title?: string }) => <div data-testid="no-vehicle">{title ?? 'No vehicle'}</div>,
}));
vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatMiles:    (v: number) => `${v} mi`,
  formatKwh:      (v: number) => `${v} kWh`,
  formatCurrency: (v: number) => `$${v}`,
  formatPercent:  (v: number) => `${v}%`,
  formatDuration: (v: number) => `${v} min`,
}));
vi.mock('lucide-react', () => ({
  ArrowLeft: () => <svg data-testid="icon-arrow-left" />,
  Map:       () => <svg data-testid="icon-map" />,
  Gauge:     () => <svg data-testid="icon-gauge" />,
  Mountain:  () => <svg data-testid="icon-mountain" />,
}));

import { TripDetailContent } from '../trips.$tripId';

describe('Trip Detail page', () => {
  it('renders all four stat card labels', () => {
    render(<TripDetailContent />);
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Energy Used')).toBeInTheDocument();
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
  });

  it('renders the trip map chart by default', () => {
    render(<TripDetailContent />);
    expect(screen.getByTestId('trip-map-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('speed-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('elevation-chart')).not.toBeInTheDocument();
  });

  it('switches to Speed chart when Speed tab clicked', () => {
    render(<TripDetailContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Speed' }));
    expect(screen.getByTestId('speed-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('trip-map-chart')).not.toBeInTheDocument();
  });

  it('switches to Elevation chart when Elevation tab clicked', () => {
    render(<TripDetailContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Elevation' }));
    expect(screen.getByTestId('elevation-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('trip-map-chart')).not.toBeInTheDocument();
  });

  it('renders all three tab labels', () => {
    render(<TripDetailContent />);
    expect(screen.getByRole('button', { name: 'Route Map' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elevation' })).toBeInTheDocument();
  });

  it('renders Back button', () => {
    render(<TripDetailContent />);
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('navigates to /trips when Back is clicked', () => {
    render(<TripDetailContent />);
    fireEvent.click(screen.getByText('Back'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/trips' });
  });

  it('renders stat values from trip data', () => {
    render(<TripDetailContent />);
    expect(screen.getByText('42.5 mi')).toBeInTheDocument();
    expect(screen.getByText('12.3 kWh')).toBeInTheDocument();
  });
});
