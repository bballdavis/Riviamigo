import React from 'react';
import { useEfficiencyTrend, useTrips } from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import { EfficiencyDrivesChart } from '@riviamigo/ui/charts';
import { formatEfficiency } from '@riviamigo/ui/lib/utils';
import { createDefaultDashboardEditActions, renderDefaultDashboardTitleAction, type DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

export function EfficiencyDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions(updateDashboard)}
      renderBeforeDashboard={({ isEditMode, ctx }) =>
        !isEditMode ? <EfficiencySummaryPanel vehicleId={ctx.vehicleId} from={ctx.from} to={ctx.to} /> : null
      }
    />
  );
}

function EfficiencySummaryPanel({
  vehicleId,
  from,
  to,
}: {
  vehicleId: string | null;
  from: string;
  to: string;
}) {
  const { data: trend = [], isFetching: trendFetching } = useEfficiencyTrend(vehicleId, from, to);
  // Fetch up to 200 trips so individual drives appear on the chart
  const { data: tripPage, isFetching: tripsFetching } = useTrips(vehicleId, from, to, 1, 200);
  const drives = tripPage?.items ?? [];
  const loading = trendFetching || tripsFetching;

  // Derived headline stats from trend data
  const validDays = trend.filter((p) => p.day_avg_wh_mi != null);
  const avgWh = validDays.length
    ? validDays.reduce((s, p) => s + (p.day_avg_wh_mi ?? 0), 0) / validDays.length
    : null;
  const validRolling = trend.filter((p) => p.rolling_7d_wh_mi != null);
  const latestRolling = validRolling[validRolling.length - 1]?.rolling_7d_wh_mi ?? null;

  return (
    <section className="mb-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Avg Efficiency (range)"
          value={loading ? '...' : formatEfficiency(avgWh)}
        />
        <MetricCard
          label="7-Day Rolling Avg"
          value={loading ? '...' : formatEfficiency(latestRolling)}
        />
        <MetricCard
          label="Drives in Range"
          value={loading ? '...' : String(tripPage?.total ?? drives.length)}
        />
      </div>

      <div className="rounded-xl border border-border bg-bg-elevated/70 p-4">
        <EfficiencyDrivesChart
          title="Efficiency Over Time — Drives &amp; 7-Day Trend"
          trend={trend}
          drives={drives}
          loading={loading}
          height={300}
        />
      </div>
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
