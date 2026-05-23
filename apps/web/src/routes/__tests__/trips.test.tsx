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

vi.mock('@riviamigo/ui/tables', () => ({
  DataTable: ({ emptyTitle, data }: { emptyTitle?: string; data?: unknown[] }) => (
    <div data-testid="trips-table">{emptyTitle}</div>
  ),
  tripColumns: [],
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth:  () => ({ defaultVehicleId: 'v1' }),
  useTrips: () => ({
    data: { items: [], total: 0, page: 1, per_page: 25 },
    isLoading: false,
  }),
}));

vi.mock('../../components/layout/AppLayout',  () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard',  () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/NoVehicleState', () => ({
  NoVehicleState: ({ description }: { description?: string }) => (
    <div data-testid="no-vehicle">{description ?? 'No vehicle'}</div>
  ),
}));
vi.mock('../../lib/dates', () => ({
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso:    () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
}));

import { TripsContent } from '../trips';

describe('Trips page', () => {
  it('renders the page title', () => {
    render(<TripsContent />);
    expect(screen.getByText('Trips')).toBeInTheDocument();
  });

  it('renders the trips table by default', () => {
    render(<TripsContent />);
    expect(screen.getByTestId('trips-table')).toBeInTheDocument();
  });

  it('shows the empty state message from DataTable', () => {
    render(<TripsContent />);
    expect(screen.getByText('No trips found')).toBeInTheDocument();
  });

  it('renders the date range picker', () => {
    render(<TripsContent />);
    expect(screen.getByTestId('date-range-picker')).toBeInTheDocument();
  });

  it('renders Trip History section', () => {
    render(<TripsContent />);
    expect(screen.getByText('Trip History')).toBeInTheDocument();
  });
});

describe('Trips page — pagination', () => {
  it('does not render pagination when total <= per_page', () => {
    render(<TripsContent />);
    expect(screen.queryByText('Previous')).not.toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });
});
