import React, { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useTrips } from '@riviamigo/hooks';
import { PageLayout, ChartSection, DateRangePicker } from '@riviamigo/ui/primitives';
import { DataTable, tripColumns, type TripRow } from '@riviamigo/ui/tables';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../lib/dates';
import type { Row } from '@tanstack/react-table';

export const tripsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips',
  component: TripsPage,
});

function TripsPage() {
  return <AuthGuard><TripsContent /></AuthGuard>;
}

function TripsContent() {
  const { defaultVehicleId } = useAuth();
  const navigate = useNavigate();

  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const [page, setPage] = useState(1);
  const { from, to } = rangeToIso(range);

  const { data, isLoading } = useTrips(defaultVehicleId, from, to, page);

  function handleRowClick(row: Row<TripRow>) {
    navigate({ to: '/trips/$tripId', params: { tripId: row.original.id } });
  }

  const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;

  return (
    <AppLayout activeKey="trips">
      <PageLayout
        title="Trips"
        subtitle={data ? `${data.total} trips` : undefined}
        actions={
          <DateRangePicker
            value={range}
            preset={preset}
            onChange={(r, p) => { setRange(r); if (p) setPreset(p); setPage(1); }}
          />
        }
      >
        <ChartSection title="Trip History">
          <DataTable
            data={(data?.items ?? []) as unknown as TripRow[]}
            columns={tripColumns}
            loading={isLoading}
            onRowClick={handleRowClick}
            emptyTitle="No trips found"
            emptyDescription="Trips will appear here once your vehicle has been driven."
          />
          {data && data.total > data.per_page && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
              <p className="text-xs text-fg-tertiary">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors">
                  Previous
                </button>
                <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors">
                  Next
                </button>
              </div>
            </div>
          )}
        </ChartSection>
      </PageLayout>
    </AppLayout>
  );
}
