import React, { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Sun, Moon } from 'lucide-react';
import { api, useTrips } from '@riviamigo/hooks';
import { DataTable, createTripColumns, type TripRow } from '@riviamigo/ui/tables';
import { TripMapChart, type TripMapRoute, type MapStyleMode } from '@riviamigo/ui/charts';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';
import { useMeasuredWidgetHeight } from '../useMeasuredWidgetHeight';
import {
  useTripSelection,
  toggleTripSelection,
  clearTripSelection,
  resetTripSelection,
  registerTripsInStore,
} from './tripSelectionStore';

function getAppMapStyle(): MapStyleMode {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function TripsMapWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { selectedIds } = useTripSelection();
  const [mapStyle, setMapStyle] = useState<MapStyleMode>(getAppMapStyle);
  const { data, isLoading } = useTrips(ctx.vehicleId, ctx.from, ctx.to, 1, 50);
  const trips = (data?.items ?? []) as unknown as TripRow[];
  const { ref, height } = useMeasuredWidgetHeight(360, 180);

  React.useEffect(() => {
    resetTripSelection(`${ctx.vehicleId}::${ctx.from}::${ctx.to}`);
  }, [ctx.vehicleId, ctx.from, ctx.to]);

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div ref={ref} className="relative min-h-0 flex-1">
        <TripMapChart
          track={[]}
          routes={routes}
          selectedRouteIds={selectedIds}
          onRouteClick={toggleTripSelection}
          height={height}
          mapStyle={mapStyle}
          className="w-full overflow-hidden rounded-lg border border-border"
        />
        <button
          onClick={() => setMapStyle((s) => s === 'dark' ? 'light' : 'dark')}
          aria-label={mapStyle === 'dark' ? 'Switch to light map' : 'Switch to dark map'}
          className="absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
        >
          {mapStyle === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-fg-secondary">
          <span>{selectedIds.length} route{selectedIds.length === 1 ? '' : 's'} selected.</span>
          <button className="font-medium text-accent hover:underline" onClick={clearTripSelection}>Show all</button>
        </div>
      ) : isLoading ? (
        <div className="shrink-0 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-fg-tertiary">Loading route map...</div>
      ) : null}
    </div>
  );
}

function TripsTableWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [search, setSearch] = useState('');
  const deferredSearch = React.useDeferredValue(search);
  const { selectedIds } = useTripSelection();
  const { data, isLoading } = useTrips(ctx.vehicleId, ctx.from, ctx.to, page, pageSize, deferredSearch);
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

  React.useEffect(() => {
    setPage(1);
  }, [ctx.from, ctx.to, ctx.vehicleId, deferredSearch, pageSize]);

  React.useEffect(() => {
    if (trips.length > 0) registerTripsInStore(trips);
  }, [trips]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <label className="relative min-w-[16rem] flex-1 max-w-md">
          <span className="sr-only">Search trips</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search start or destination"
            className="w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-tertiary focus:border-accent"
          />
        </label>
        <div className="flex items-center gap-3">
          {selectedIds.length > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs text-fg-secondary">
              <span>{selectedIds.length} selected</span>
              <button className="font-medium text-accent hover:underline" onClick={clearTripSelection}>
                Clear
              </button>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-fg-tertiary">
            Rows
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              className="rounded-lg border border-border bg-bg-surface px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
            >
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </div>
      <DataTable
        data={trips}
        columns={columns}
        loading={isLoading}
        loadingRows={pageSize}
        onRowClick={(row) => toggleTripSelection(row.original.id)}
        getRowIsSelected={(row) => selectedIds.includes(row.original.id)}
        emptyTitle="No trips found"
        emptyDescription={deferredSearch.trim() ? 'No trips match that start or destination.' : 'Trips will appear here once your vehicle has been driven.'}
        className="min-h-0 flex-1"
      />
      {data ? (
        <div className="flex shrink-0 items-center justify-between border-t border-border pt-3">
          <p className="text-xs text-fg-tertiary">
            Page {page} of {Math.max(totalPages, 1)} · {data.total} trip{data.total === 1 ? '' : 's'}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-bg-elevated disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages || totalPages <= 1}
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
  componentType: 'custom',
  definitionId: 'trips.map',
  title: 'Trip Map',
  defaultSize: { w: 12, h: 10 },
  minSize: { w: 6, h: 6 },
  defaultOptions: {},
  component: TripsMapWidget,
});

registerWidget({
  componentType: 'custom',
  definitionId: 'trips.table',
  title: 'Trip History',
  defaultSize: { w: 12, h: 12 },
  minSize: { w: 6, h: 6 },
  defaultOptions: {},
  component: TripsTableWidget,
});
