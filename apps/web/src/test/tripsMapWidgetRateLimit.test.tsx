import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockTrackQuery = {
  data?: Array<{ lat: number; lng: number }>;
  dataUpdatedAt?: number;
  isSuccess?: boolean;
  isError?: boolean;
  isPending?: boolean;
};

const mockUseQueries = vi.fn<(args: { queries: Array<{ queryKey: unknown[]; enabled?: boolean }> }) => MockTrackQuery[]>(() => []);
const mockUseTrips = vi.fn();
const mockSelectionState = vi.fn(() => ({ selectedIds: [] as string[] }));
const mockTableState = vi.fn(() => ({ page: 1, pageSize: 15, search: '' }));
const mockResetTripSelection = vi.fn();
const mockResetTripTableState = vi.fn();
const mockConsoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueries: (args: unknown) => mockUseQueries(args as { queries: Array<{ queryKey: unknown[]; enabled?: boolean }> }),
    useQuery: vi.fn(() => ({ data: [] })),
  };
});

vi.mock('@riviamigo/hooks', () => ({
  api: {
    getTripTrack: vi.fn(),
    listPlaces: vi.fn(() => []),
  },
  useTrips: (...args: unknown[]) => mockUseTrips(...args),
  useDocumentTheme: () => false,
}));

vi.mock('@riviamigo/ui/charts', () => ({
  TripMapChart: ({ routes }: { routes: Array<{ id: string }> }) => (
    <div data-testid="trip-map-chart">{routes.map((route) => route.id).join(',')}</div>
  ),
}));

vi.mock('../../../../packages/dashboards/src/widgets/useMeasuredWidgetHeight', () => ({
  useMeasuredWidgetHeight: () => ({ ref: { current: null }, height: 360 }),
}));

vi.mock('../../../../packages/dashboards/src/widgets/table/tripSelectionStore', () => ({
  useTripSelection: () => mockSelectionState(),
  toggleTripSelection: vi.fn(),
  clearTripSelection: vi.fn(),
  resetTripSelection: (...args: unknown[]) => mockResetTripSelection(...args),
  registerTripsInStore: vi.fn(),
}));

vi.mock('../../../../packages/dashboards/src/widgets/table/tripTableStateStore', () => ({
  useTripTableState: () => mockTableState(),
  resetTripTableState: (...args: unknown[]) => mockResetTripTableState(...args),
  setTripTablePage: vi.fn(),
  setTripTablePageSize: vi.fn(),
  setTripTableSearch: vi.fn(),
}));

import { TripsMapWidget } from '../../../../packages/dashboards/src/widgets/table/TripsTableWidget';

describe('TripsMapWidget rate-limit behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectionState.mockReturnValue({ selectedIds: [] });
    mockTableState.mockReturnValue({ page: 1, pageSize: 15, search: '' });
    mockUseTrips.mockReturnValue({
      data: {
        items: [
          { id: 'trip-1' },
          { id: 'trip-2' },
          { id: 'trip-3' },
        ],
      },
    });
    mockConsoleDebug.mockClear();
  });

  it('only schedules track queries for trips visible in the current table page', () => {
    render(
      <TripsMapWidget
        instance={{} as never}
        ctx={{ vehicleId: 'vehicle-1', from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' } as never}
      />,
    );

    expect(mockUseTrips).toHaveBeenCalledWith(
      'vehicle-1',
      '2024-01-01T00:00:00Z',
      '2024-01-31T23:59:59Z',
      1,
      15,
      '',
    );

    const firstCall = mockUseQueries.mock.calls[0]?.[0] as { queries: Array<{ queryKey: unknown[] }> } | undefined;
    const queries = firstCall?.queries ?? [];

    expect(Array.isArray(queries)).toBe(true);
    expect(queries).toHaveLength(3);
    expect(queries.map((query) => query.queryKey)).toEqual([
      ['trips', 'track', 'trip-1', 'vehicle-1'],
      ['trips', 'track', 'trip-2', 'vehicle-1'],
      ['trips', 'track', 'trip-3', 'vehicle-1'],
    ]);
    expect(screen.queryByTestId('trip-map-chart')).not.toBeInTheDocument();
    expect(screen.getByText('Loading route map...')).toBeInTheDocument();
  });

  it('renders routes from the current table page once their track queries resolve', () => {
    mockSelectionState.mockReturnValue({
      selectedIds: ['trip-2'],
    });
    mockUseTrips.mockReturnValue({
      data: {
        items: [
          { id: 'trip-1' },
          { id: 'trip-2' },
        ],
      },
    });
    mockUseQueries.mockReturnValue([
      {
        data: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
        dataUpdatedAt: 1,
        isSuccess: true,
      },
      { data: [], dataUpdatedAt: 2, isSuccess: true },
    ]);

    render(
      <TripsMapWidget
        instance={{} as never}
        ctx={{ vehicleId: 'vehicle-1', from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' } as never}
      />,
    );

    const firstCall = mockUseQueries.mock.calls[0]?.[0] as { queries: Array<{ queryKey: unknown[] }> } | undefined;
    const queries = firstCall?.queries ?? [];

    expect(queries).toHaveLength(2);
    expect(queries[0]?.queryKey).toEqual(['trips', 'track', 'trip-1', 'vehicle-1']);
    expect(screen.getByTestId('trip-map-chart')).toHaveTextContent('trip-1');
  });

  it('waits for the full initial batch before mounting the map on hard refresh', async () => {
    const items = Array.from({ length: 15 }, (_, index) => ({ id: `trip-${index + 1}` }));
    mockUseTrips.mockReturnValue({ data: { items } });
    mockUseQueries.mockReturnValue([
      {
        data: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }],
        dataUpdatedAt: 1,
        isSuccess: true,
      },
      ...Array.from({ length: 14 }, (_, index) => ({
        dataUpdatedAt: 0,
        isPending: true,
      })),
    ]);

    const { rerender } = render(
      <TripsMapWidget
        instance={{} as never}
        ctx={{ vehicleId: 'vehicle-1', from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' } as never}
      />,
    );

    expect(screen.queryByTestId('trip-map-chart')).not.toBeInTheDocument();
    expect(screen.getByText('Loading initial route batch...')).toBeInTheDocument();

    mockUseQueries.mockReturnValue(
      items.map((_, index) => ({
        data: [{ lat: index, lng: index }, { lat: index + 0.5, lng: index + 0.5 }],
        dataUpdatedAt: index + 1,
        isSuccess: true,
      })),
    );

    rerender(
      <TripsMapWidget
        instance={{} as never}
        ctx={{ vehicleId: 'vehicle-1', from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' } as never}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('trip-map-chart')).toHaveTextContent('trip-1');
      expect(screen.getByTestId('trip-map-chart')).toHaveTextContent('trip-15');
    });
  });

  it('streams larger pages progressively after the first 15 routes are stable', async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ id: `trip-${index + 1}` }));
    mockTableState.mockReturnValue({ page: 1, pageSize: 100, search: '' });
    mockUseTrips.mockReturnValue({ data: { items } });
    mockUseQueries.mockReturnValue(
      items.map((_, index) => {
        if (index < 15) {
          return {
            data: [{ lat: index, lng: index }, { lat: index + 0.5, lng: index + 0.5 }],
            dataUpdatedAt: index + 1,
            isSuccess: true,
          };
        }
        return { dataUpdatedAt: 0, isPending: true };
      }),
    );

    const { rerender } = render(
      <TripsMapWidget
        instance={{} as never}
        ctx={{ vehicleId: 'vehicle-1', from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' } as never}
      />,
    );

    expect(screen.getByTestId('trip-map-chart')).toHaveTextContent('trip-1');
    expect(screen.getByTestId('trip-map-chart')).toHaveTextContent('trip-15');
    expect(screen.queryByTestId('trip-map-chart')).not.toHaveTextContent('trip-16');
    expect(screen.getByText('Loading additional routes...')).toBeInTheDocument();

    mockUseQueries.mockReturnValue(
      items.map((_, index) => ({
        data: [{ lat: index, lng: index }, { lat: index + 0.5, lng: index + 0.5 }],
        dataUpdatedAt: index + 1,
        isSuccess: true,
      })),
    );

    rerender(
      <TripsMapWidget
        instance={{} as never}
        ctx={{ vehicleId: 'vehicle-1', from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' } as never}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('trip-map-chart')).toHaveTextContent('trip-100');
    });
  });
});
