import React, { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api, useTrips } from '@riviamigo/hooks';
import { DataTable, createTripColumns, type TripRow } from '@riviamigo/ui/tables';
import { TripMapChart, type TripMapRoute } from '@riviamigo/ui/charts';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';
import { useMeasuredWidgetHeight } from '../useMeasuredWidgetHeight';

function TripsMapWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { data, isLoading } = useTrips(ctx.vehicleId, ctx.from, ctx.to, 1, 50);
  const trips = (data?.items ?? []) as unknown as TripRow[];
  const { ref, height } = useMeasuredWidgetHeight(360, 180);

  const trackQueries = useQueries({
    queries: trips.map((trip) => ({
      queryKey: ['trips', 'track', trip.id, ctx.vehicleId],
      queryFn: () => api.getTripTrack(trip.id, ctx.vehicleId!),
      enabled: !!ctx.vehicleId,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const trackDataVersion = trackQueries.map((query) => query.dataUpdatedAt).join(',');

  const routes = React.useMemo(() => (
    trips
      .map((trip, index) => {
        const points = trackQueries[index]?.data ?? [];
        return {
          id: trip.id,
          track: points
            .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
            .map((point) => ({ lat: point.lat, lng: point.lng })),
        } satisfies TripMapRoute;
      })
      .filter((route) => route.track.length > 1)
  ), [trackDataVersion, trackQueries, trips]);

  const toggleTrip = React.useCallback((tripId: string) => {
    setSelectedIds((current) => (
      current.includes(tripId)
        ? current.filter((id) => id !== tripId)
        : [...current, tripId]
    ));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div ref={ref} className="min-h-0 flex-1">
        <TripMapChart
          track={[]}
          routes={routes}
          selectedRouteIds={selectedIds}
          onRouteClick={toggleTrip}
          height={height}
          className="w-full overflow-hidden rounded-lg border border-border"
        />
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-fg-secondary">
          <span>{selectedIds.length} route{selectedIds.length === 1 ? '' : 's'} selected.</span>
          <button className="font-medium text-accent hover:underline" onClick={() => setSelectedIds([])}>Show all</button>
        </div>
      ) : isLoading ? (
        <div className="shrink-0 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-fg-tertiary">Loading route map...</div>
      ) : null}
    </div>
  );
}

function TripsTableWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useTrips(ctx.vehicleId, ctx.from, ctx.to, page);
  const placesQuery = useQuery({
    queryKey: ['places'],
    queryFn: () => api.listPlaces(),
    staleTime: 5 * 60 * 1000,
  });
  const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;
  const trips = (data?.items ?? []) as unknown as TripRow[];
  const columns = React.useMemo(
    () => createTripColumns(placesQuery.data ?? []),
    [placesQuery.data],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DataTable
        data={trips}
        columns={columns}
        loading={isLoading}
        emptyTitle="No trips found"
        emptyDescription="Trips will appear here once your vehicle has been driven."
      />
      {data && data.total > data.per_page ? (
        <div className="mt-4 flex shrink-0 items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-fg-tertiary">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-bg-elevated disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-bg-elevated disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

registerWidget({
  id: 'map.trips',
  category: 'chart',
  title: 'Trip Map',
  defaultSize: { w: 12, h: 5 },
  minSize: { w: 6, h: 3 },
  editMode: 'none',
  component: TripsMapWidget,
});

registerWidget({
  id: 'table.trips',
  category: 'table',
  title: 'Trip History',
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 6, h: 3 },
  component: TripsTableWidget,
});
