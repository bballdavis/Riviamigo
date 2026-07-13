import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Sun, Moon } from 'lucide-react';
import { LuBadgeInfo } from 'react-icons/lu';
import { PiArrowFatLinesRight } from 'react-icons/pi';
import { api, useTrips, useTripMapRoutes, useDocumentTheme } from '@riviamigo/hooks';
import { DataTable, createTripColumns, type TripRow } from '@riviamigo/ui/tables';
import { Badge, SelectPicker } from '@riviamigo/ui/primitives';
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

function TripCard({
  trip,
  isSelected,
  onClick,
  onInfoClick,
}: {
  trip: TripRow;
  isSelected: boolean;
  onClick: () => void;
  onInfoClick: () => void;
}) {
  const startLabel = trip.start_place ?? trip.start_address;
  const endLabel   = trip.end_place   ?? trip.end_address;

  return (
    <div
      className={`relative w-full rounded-xl border px-3 py-2.5 transition-colors ${
        isSelected
          ? 'border-accent/50 bg-accent/10 ring-1 ring-inset ring-accent/30'
          : 'border-border bg-bg-elevated/60 hover:bg-bg-elevated'
      }`}
    >
      <button
        type="button"
        onClick={onInfoClick}
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg-surface text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg"
        aria-label="Open trip details"
      >
        <LuBadgeInfo className="h-4 w-4" />
      </button>
      <button type="button" onClick={onClick} className="w-full text-left pr-9">
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
    </div>
  );
}
import {
  useTripSelection,
  toggleTripSelection,
  clearTripSelection,
  resetTripSelection,
  registerTripsInStore,
} from './tripSelectionStore';
import {
  resetTripTableState,
  setTripTablePage,
  setTripTablePageSize,
  setTripTableSearch,
  useTripTableState,
} from './tripTableStateStore';

const ROWS_PER_PAGE_OPTIONS = [15, 25, 50, 100] as const;

export function TripsMapWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const navigate = useNavigate();
  const { selectedIds } = useTripSelection();
  const { search } = useTripTableState();
  const isDark = useDocumentTheme();
  const mapStyle: MapStyleMode = isDark ? 'dark' : 'light';
  const [mapStyleOverride, setMapStyleOverride] = React.useState<MapStyleMode | null>(null);
  const effectiveMapStyle: MapStyleMode = mapStyleOverride ?? mapStyle;
  const deferredSearch = React.useDeferredValue(search);
  const mapQuery = useTripMapRoutes(ctx.vehicleId, ctx.from, ctx.to, deferredSearch);
  const routes = React.useMemo(
    () => (mapQuery.data?.routes ?? []).map((route) => ({
      id: route.trip_id,
      track: route.coordinates.map(([lng, lat]) => ({ lat, lng })),
    }) satisfies TripMapRoute),
    [mapQuery.data],
  );
  const routeIds = React.useMemo(() => new Set(routes.map((route) => route.id)), [routes]);
  const { ref, height } = useMeasuredWidgetHeight(360, 180);

  React.useEffect(() => {
    resetTripSelection(`${ctx.vehicleId}::${ctx.from}::${ctx.to}`, { force: true });
    resetTripTableState(`${ctx.vehicleId}::${ctx.from}::${ctx.to}`, { force: true });
  }, [ctx.vehicleId, ctx.from, ctx.to]);

  const selectedRouteIds = React.useMemo(
    () => selectedIds.filter((id) => routeIds.has(id)),
    [selectedIds, routeIds],
  );
  const selectedTripId = selectedRouteIds[0];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div ref={ref} className="relative min-h-0 flex-1">
        <div className="relative overflow-hidden rounded-lg border border-border bg-bg-surface" style={{ height }}>
          {!mapQuery.isLoading && !mapQuery.isError ? (
            <TripMapChart
              track={[]}
              routes={routes}
              selectedRouteIds={selectedRouteIds}
              onRouteClick={toggleTripSelection}
              height={height}
              mapStyle={effectiveMapStyle}
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-bg-elevated text-sm text-fg-tertiary">
              Loading route map...
            </div>
          )}
          <button
            onClick={() => setMapStyleOverride((s) => (s ?? mapStyle) === 'dark' ? 'light' : 'dark')}
            aria-label={effectiveMapStyle === 'dark' ? 'Switch to light map' : 'Switch to dark map'}
            className="absolute bottom-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-accent bg-bg-surface text-accent shadow-lg transition-colors hover:bg-bg-elevated"
          >
            {effectiveMapStyle === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {selectedRouteIds.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-fg-secondary">
          {selectedRouteIds.length === 1 ? (
            <button
              type="button"
              className="group flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/15"
              onClick={() => navigate({ to: '/trips/$tripId', params: { tripId: selectedTripId! } })}
            >
              Open trip
              <PiArrowFatLinesRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          ) : (
            <>
              <span>{selectedRouteIds.length} routes selected.</span>
              <button className="font-medium text-accent hover:underline" onClick={clearTripSelection}>Show all</button>
            </>
          )}
        </div>
      ) : mapQuery.isError ? (
        <div className="shrink-0 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-fg-secondary">
          Unable to load route map data.
        </div>
      ) : routes.length === 0 ? (
        <div className="shrink-0 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-fg-tertiary">
          {mapQuery.data?.total_trips
            ? 'No GPS route points in this timeframe.'
            : 'No trips in this timeframe.'}
        </div>
      ) : mapQuery.data?.missing_route_count ? (
        <div className="shrink-0 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs text-fg-tertiary">
          {mapQuery.data.missing_route_count} trip{mapQuery.data.missing_route_count === 1 ? '' : 's'} have no GPS route.
        </div>
      ) : null}
    </div>
  );
}

export function TripsTableWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const navigate = useNavigate();
  const { page, pageSize, search } = useTripTableState();
  const deferredSearch = React.useDeferredValue(search);
  const { selectedIds } = useTripSelection();
  const isMobile = useIsMobile();
  const { data, isLoading } = useTrips(ctx.vehicleId, ctx.from, ctx.to, page, pageSize, deferredSearch.trim());
  const placesQuery = useQuery({
    queryKey: ['places'],
    queryFn: () => api.listPlaces(),
    staleTime: 5 * 60 * 1000,
  });
  const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;
  const trips = (data?.items ?? []) as TripRow[];
  const columns = React.useMemo(
    () => createTripColumns(placesQuery.data ?? [], {
      onInfoClick: (tripId) => {
        navigate({ to: '/trips/$tripId', params: { tripId } });
      },
    }),
    [placesQuery.data],
  );

  React.useEffect(() => {
    resetTripTableState(`${ctx.vehicleId}::${ctx.from}::${ctx.to}`, { force: true });
  }, [ctx.from, ctx.to, ctx.vehicleId]);

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
          onClick={() => setTripTablePage(page - 1)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-bg-elevated disabled:opacity-40"
        >
          Prev
        </button>
        <button
          disabled={page >= totalPages || totalPages <= 1}
          onClick={() => setTripTablePage(page + 1)}
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
            onChange={(event) => setTripTableSearch(event.target.value)}
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
              <SelectPicker
                className="min-w-[4.5rem]"
                value={String(pageSize)}
                onChange={(value) => {
                  const next = Number(value);
                  if (ROWS_PER_PAGE_OPTIONS.includes(next as (typeof ROWS_PER_PAGE_OPTIONS)[number])) {
                    setTripTablePageSize(next);
                  }
                }}
                aria-label="Trips per page"
                size="sm"
                options={ROWS_PER_PAGE_OPTIONS.map((option) => ({ value: String(option), label: String(option) }))}
              />
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
                  onInfoClick={() => navigate({ to: '/trips/$tripId', params: { tripId: trip.id } })}
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
          fixedLayout
          columnVisibilityMenu
          className="overflow-x-hidden"
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
