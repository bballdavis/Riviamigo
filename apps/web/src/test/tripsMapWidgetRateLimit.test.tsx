import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseTripMapRoutes = vi.fn();
const mockSelectionState = vi.fn(() => ({ selectedIds: [] as string[] }));
const mockTableState = vi.fn(() => ({ page: 1, pageSize: 15, search: '' }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: [] })),
}));

vi.mock('@riviamigo/hooks', () => ({
  api: { listPlaces: vi.fn(() => []) },
  useAuth: (selector?: (state: { accessToken: string | null }) => unknown) => {
    const state = { accessToken: null };
    return selector ? selector(state) : state;
  },
  useTrips: vi.fn(() => ({ data: { items: [], total: 0, per_page: 15 } })),
  useTripMapRoutes: (...args: unknown[]) => mockUseTripMapRoutes(...args),
  useDocumentTheme: () => false,
}));

vi.mock('@riviamigo/ui/charts', () => ({
  TripMapChart: ({ routes }: { routes: Array<{ id: string }> }) => (
    <div data-testid="trip-map-chart">{routes.map((route) => route.id).join(',')}</div>
  ),
}));

vi.mock('@riviamigo/ui/lib/utils', () => ({
  formatMiles: (value: number) => `${value} mi`,
  formatDuration: (value: number) => `${value} min`,
  formatPercent: (value: number) => `${value}%`,
  formatEfficiency: (value: number) => `${value}`,
}));

vi.mock('../../../../packages/dashboards/src/widgets/useMeasuredWidgetHeight', () => ({
  useMeasuredWidgetHeight: () => ({ ref: { current: null }, height: 360 }),
}));

vi.mock('../../../../packages/dashboards/src/widgets/table/tripSelectionStore', () => ({
  useTripSelection: () => mockSelectionState(),
  toggleTripSelection: vi.fn(),
  clearTripSelection: vi.fn(),
  resetTripSelection: vi.fn(),
  registerTripsInStore: vi.fn(),
}));

vi.mock('../../../../packages/dashboards/src/widgets/table/tripTableStateStore', () => ({
  useTripTableState: () => mockTableState(),
  resetTripTableState: vi.fn(),
  setTripTablePage: vi.fn(),
  setTripTablePageSize: vi.fn(),
  setTripTableSearch: vi.fn(),
}));

import { TripsMapWidget } from '../../../../packages/dashboards/src/widgets/table/TripsTableWidget';

describe('TripsMapWidget batched route behavior', () => {
  const ctx = {
    vehicleId: 'vehicle-1',
    from: '2024-01-01T00:00:00Z',
    to: '2024-01-31T23:59:59Z',
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionState.mockReturnValue({ selectedIds: [] });
    mockTableState.mockReturnValue({ page: 1, pageSize: 15, search: '' });
  });

  it('requests one batched route dataset and keeps the map pending until it arrives', () => {
    mockUseTripMapRoutes.mockReturnValue({ isLoading: true, isError: false, data: undefined });

    render(<TripsMapWidget instance={{} as never} ctx={ctx} />);

    expect(mockUseTripMapRoutes).toHaveBeenCalledWith(
      'vehicle-1',
      '2024-01-01T00:00:00Z',
      '2024-01-31T23:59:59Z',
      '',
    );
    expect(screen.queryByTestId('trip-map-chart')).not.toBeInTheDocument();
    expect(screen.getByText('Loading route map...')).toBeInTheDocument();
  });

  it('renders all returned routes from the single response and preserves selection filtering', () => {
    mockSelectionState.mockReturnValue({ selectedIds: ['trip-2'] });
    mockUseTripMapRoutes.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        routes: [
          { trip_id: 'trip-1', coordinates: [[-73, 40], [-72.9, 40.1]] },
          { trip_id: 'trip-2', coordinates: [[-74, 41], [-73.9, 41.1]] },
        ],
        missing_route_count: 0,
        total_trips: 2,
      },
    });

    render(<TripsMapWidget instance={{} as never} ctx={ctx} />);

    expect(screen.getByTestId('trip-map-chart')).toHaveTextContent('trip-1,trip-2');
    expect(screen.getByRole('button', { name: 'Open trip' })).toBeInTheDocument();
  });
});
