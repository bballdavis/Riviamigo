import React from 'react';
import { useTrips } from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import { formatDuration, formatEnergyPerDistance, formatMiles } from '@riviamigo/ui/lib/utils';
import { createDefaultDashboardEditActions, renderDefaultDashboardTitleAction, type DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

export function DrivesDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions(updateDashboard)}
      renderBeforeDashboard={({ isEditMode, ctx }) => (
        !isEditMode ? <DrivesSummaryPanel vehicleId={ctx.vehicleId} from={ctx.from} to={ctx.to} /> : null
      )}
    />
  );
}

function DrivesSummaryPanel({ vehicleId, from, to }: { vehicleId: string | null; from: string; to: string }) {
  const { data, isLoading } = useTrips(vehicleId, from, to, 1);
  const trips = data?.items ?? [];

  const totalDistance = trips.reduce((sum, trip) => sum + (trip.distance_mi ?? 0), 0);
  const totalEnergy = trips.reduce((sum, trip) => sum + (trip.energy_used_kwh ?? 0), 0);
  const avgEfficiency = totalDistance > 0 && totalEnergy > 0
    ? (totalEnergy * 1000) / totalDistance
    : null;
  const recentDuration = trips.length > 0 ? trips.reduce((sum, trip) => sum + (trip.duration_min ?? 0), 0) / trips.length : null;

  return (
    <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Trips in Range" value={isLoading ? '...' : String(data?.total ?? 0)} />
      <MetricCard label="Distance (Page)" value={isLoading ? '...' : formatMiles(totalDistance)} />
      <MetricCard label="Avg Consumption" value={isLoading ? '...' : (avgEfficiency === null ? '-' : formatEnergyPerDistance(avgEfficiency))} />
      <MetricCard label="Avg Duration" value={isLoading ? '...' : (recentDuration === null ? '-' : formatDuration(recentDuration))} />
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated/70 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-fg">{value}</div>
    </div>
  );
}
