import React, { useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Sun, Moon } from 'lucide-react';
import { PiArrowFatLinesRight } from 'react-icons/pi';
import { api, useTrips } from '@riviamigo/hooks';
import { DataTable, createTripColumns, type TripRow } from '@riviamigo/ui/tables';
import { Badge } from '@riviamigo/ui/primitives';
import { TripMapChart, type TripMapRoute, type MapStyleMode } from '@riviamigo/ui/charts';
import { formatMiles, formatDuration, formatPercent, formatEfficiency } from '@riviamigo/ui/lib/utils';
import { formatDriveMode, getDriveModeBadgeClass } from '@riviamigo/ui/lib/driveMode';
import { format, parseISO } from 'date-fns';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';
import { useMeasuredWidgetHeight } from '../useMeasuredWidgetHeight';

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640
  );
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

function TripCard({ trip, isSelected, onClick }: { trip: TripRow; isSelected: boolean; onClick: () => void }) {
  const startLabel = (trip as unknown as Record<string, unknown>)['start_place'] as string | undefined
    ?? (trip as unknown as Record<string, unknown>)['start_address'] as string | undefined;
  const endLabel = (trip as unknown as Record<string, unknown>)['end_place'] as string | undefined
    ?? (trip as unknown as Record<string, unknown>)['end_address'] as string | undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
        isSelected
          ? 'border-accent/50 bg-accent/10 ring-1 ring-inset ring-accent/30'
          : 'border-border bg-bg-elevated/60 hover:bg-bg-elevated'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs text-fg-tertiary">
          {format(parseISO(trip.started_at), 'MMM d, h:mm a')}
        </span>
        {trip.drive_mode && (
          <Badge size="sm" className={getDriveModeBadgeClass(trip.drive_mode)}>
            {formatDriveMode(trip.drive_mode)}
          </Badge>
        )}
      </div>
      {(startLabel || endLabel) && (
        <div className="flex min-w-0 items-center gap-1 mb-2 text-sm font-medium text-fg">
          {startLabel && <span className="truncate">{startLabel}</span>}
          {startLabel && endLabel && <PiArrowFatLinesRight className="h-3.5 w-3.5 shrink-0 text-fg-tertiary" />}
          {endLabel && <span className="truncate">{endLabel}</span>}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-fg-secondary flex-wrap">
        <span className="font-mono font-medium text-fg">{formatMiles(trip.distance_mi)}</span>
        <span className="text-fg-tertiary">·</span>
        <span>{formatDuration(trip.duration_min)}</span>
        {trip.efficiency_wh_mi != null && (
          <>
            <span className="text-fg-tertiary">·</span>
            <span className="font-mono">{formatEfficiency(trip.efficiency_wh_mi)}</span>
          </>
        )}
        {trip.soc_start != null && trip.soc_end != null && (
          <span className="ml-auto font-mono text-fg-tertiary">
            {formatPercent(trip.soc_start)} <PiArrowFatLinesRight className="inline h-3 w-3" /> {formatPercent(trip.soc_end)}
          </span>
        )}
      </div>
    </button>
  );
}
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

// How many track requests to fire at once.  The API rate-limiter allows
// burst=20 across all protected routes, so keep this well below that.
const TRACK_BATCH_SIZE = 4;

function TripsMapWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { selectedIds } = useTripSelection();
  const [mapStyle, setMapStyle] = useState<MapStyleMode>(getAppMapStyle);
  const { data, isLoading } = useTrips(ctx.vehicleId, ctx.from, ctx.to, 1, 50);
  const trips = (data?.items ?? []) as unknown as TripRow[];
  const { ref, height } = useMeasuredWidgetHeight(360, 180);

  React.useEffect(() => {
    resetTripSelection(`${ctx.vehicleId}::${ctx.from}::${ctx.to}`);
  }, [ctx.vehicleId, ctx.from, ctx.to]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;

    const html = document.documentElement;
    const updateMapStyle = () => {
      setMapStyle(html.classList.contains('light') ? 'light' : 'dark');
    };

    updateMapStyle();
    const observer = new MutationObserver(updateMapStyle);
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  // ── Batched track fetching ───────────────────────────────────────────────
  // Firing one request per trip simultaneously hits the API rate-limiter when
  // a page has 20+ trips.  We enable queries in batches of TRACK_BATCH_SIZE,
  // advancing to the next batch once all queries in the current batch settle.
  const [enabledUpTo, setEnabledUpTo] = React.useState(TRACK_BATCH_SIZE);

  // Reset batching whenever the date window / vehicle changes so a fresh run
  // starts from the first batch rather than assuming prior queries are cached.
  React.useEffect(() => {
    setEnabledUpTo(TRACK_BATCH_SIZE);
  }, [ctx.vehicleId, ctx.from, ctx.to]);

  const trackQueries = useQueries({
    queries: trips.map((trip, index) => ({
      queryKey: ['trips', 'track', trip.id, ctx.vehicleId],
      queryFn: () => api.getTripTrack(trip.id, ctx.vehicleId!),
      // Only enable queries up to the current batch window.
      enabled: !!ctx.vehicleId && index < enabledUpTo,
      // Trip tracks are immutable once recorded — cache them forever.
      staleTime: Infinity,
      gcTime: 24 * 60 * 60 * 1000,
    })),
  });

  // Advance the batch window once every enabled query in the current window
  // has settled (success or error).
  const currentWindowSize = Math.min(enabledUpTo, trips.length);
  const settledInWindow = trackQueries
    .slice(0, currentWindowSize)
    .filter((q) => q.isSuccess || q.isError).length;

  React.useEffect(() => {
    if (
      trips.length > 0 &&
      settledInWindow >= currentWindowSize &&
      enabledUpTo < trips.length
    ) {
      setEnabledUpTo((prev) => Math.min(prev + TRACK_BATCH_SIZE, trips.length));
    }
  }, [settledInWindow, currentWindowSize, enabledUpTo, trips.length]);

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
        <div className="relative overflow-hidden rounded-lg border border-border bg-bg-surface" style={{ height }}>
          <TripMapChart
            track={[]}
            routes={routes}
            selectedRouteIds={selectedIds}
            onRouteClick={toggleTripSelection}
            height={height}
            mapStyle={mapStyle}
            className="h-full w-full"
          />
          <button
            onClick={() => setMapStyle((style: MapStyleMode) => style === 'dark' ? 'light' : 'dark')}
            aria-label={mapStyle === 'dark' ? 'Switch to light map' : 'Switch to dark map'}
            className="absolute bottom-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-accent bg-bg-surface text-accent shadow-lg transition-colors hover:bg-bg-elevated"
          >
            {mapStyle === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
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
  const isMobile = useIsMobile();
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

  const pagination = data ? (
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
          Prev
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
  ) : null;

  return (
    <div className="flex !h-auto min-h-full flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <label className="relative flex-1 min-w-0 sm:min-w-[14rem] max-w-md">
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
          {!isMobile && (
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
          )}
        </div>
      </div>

      {isMobile ? (
        <div className="flex flex-col gap-2">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-bg-elevated/60" />
              ))
            : trips.length === 0
            ? <p className="py-8 text-center text-sm text-fg-tertiary">No trips found</p>
            : trips.map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  isSelected={selectedIds.includes(trip.id)}
                  onClick={() => toggleTripSelection(trip.id)}
                />
              ))
          }
        </div>
      ) : (
        <DataTable
          data={trips}
          columns={columns}
          loading={isLoading}
          loadingRows={pageSize}
          onRowClick={(row) => toggleTripSelection(row.original.id)}
          getRowIsSelected={(row) => selectedIds.includes(row.original.id)}
          emptyTitle="No trips found"
          emptyDescription={deferredSearch.trim() ? 'No trips match that start or destination.' : 'Trips will appear here once your vehicle has been driven.'}
          className="overflow-x-auto"
        />
      )}

      {pagination}
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
