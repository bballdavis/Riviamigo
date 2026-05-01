import React, { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { api, useTrips } from '@riviamigo/hooks';
import { DataTable, createTripColumns, type TripRow } from '@riviamigo/ui/tables';
import { TripMapChart, type TripMapRoute } from '@riviamigo/ui/charts';
import { formatEfficiency, formatKwh, formatMiles } from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';
import type { Row } from '@tanstack/react-table';

function TripsTableWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { data, isLoading } = useTrips(ctx.vehicleId, ctx.from, ctx.to, page);
  const placesQuery = useQuery({
    queryKey: ['places'],
    queryFn: () => api.listPlaces(),
    staleTime: 5 * 60 * 1000,
  });
  const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;
  const trips = (data?.items ?? []) as unknown as TripRow[];
  const selectedIdSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const columns = React.useMemo(
    () => createTripColumns(placesQuery.data ?? []),
    [placesQuery.data]
  );

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

  const summaryTrips = selectedIds.length
    ? trips.filter((trip) => selectedIdSet.has(trip.id))
    : trips;
  const summary = summarizeTrips(summaryTrips);

  const toggleTrip = React.useCallback((tripId: string) => {
    setSelectedIds((current) => (
      current.includes(tripId)
        ? current.filter((id) => id !== tripId)
        : [...current, tripId]
    ));
  }, []);

  const handleRowClick = React.useCallback((row: Row<TripRow>) => {
    toggleTrip(row.original.id);
  }, [toggleTrip]);

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label={selectedIds.length ? 'Selected Trips' : 'Trips'} value={summary.count} />
        <Metric label="Distance" value={formatMiles(summary.distanceMi)} />
        <Metric label="Energy" value={summary.energyKwh === null ? '-' : formatKwh(summary.energyKwh)} />
        <Metric label="Efficiency" value={summary.efficiencyWhMi === null ? '-' : formatEfficiency(summary.efficiencyWhMi)} />
      </div>

      <TripMapChart
        track={[]}
        routes={routes}
        selectedRouteIds={selectedIds}
        onRouteClick={toggleTrip}
        height={360}
        className="w-full rounded-lg overflow-hidden border border-border"
      />

      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-fg-secondary">
          <span>{selectedIds.length} route{selectedIds.length === 1 ? '' : 's'} selected. Click a selected route or row again to return it to the period view.</span>
          <button className="font-medium text-accent hover:underline" onClick={() => setSelectedIds([])}>Show all</button>
        </div>
      )}

      <DataTable
        data={trips}
        columns={columns}
        loading={isLoading}
        onRowClick={handleRowClick}
        getRowIsSelected={(row) => selectedIdSet.has(row.original.id)}
        emptyTitle="No trips found"
        emptyDescription="Trips will appear here once your vehicle has been driven."
      />
      {data && data.total > data.per_page && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <p className="text-xs text-fg-tertiary">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-fg">{value}</div>
    </div>
  );
}

function summarizeTrips(trips: TripRow[]) {
  const distanceMi = trips.reduce((sum, trip) => sum + safeNumber(trip.distance_mi), 0);
  const energyKwh = trips.reduce((sum, trip) => sum + safeNumber(trip.energy_used_kwh), 0);
  return {
    count: trips.length,
    distanceMi,
    energyKwh: energyKwh > 0 ? energyKwh : null,
    efficiencyWhMi: energyKwh > 0 && distanceMi > 0 ? (energyKwh * 1000) / distanceMi : null,
  };
}

function safeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

registerWidget({
  id: 'table.trips',
  category: 'table',
  title: 'Trip History',
  defaultSize: { w: 12, h: 5 },
  minSize: { w: 6, h: 3 },
  component: TripsTableWidget,
});
