import React from 'react';
import { usePhantomDrainPeriods } from '@riviamigo/hooks';
import type { PhantomDrainPeriod } from '@riviamigo/types';
import { DataTable, phantomDrainColumns } from '@riviamigo/ui/tables';
import { formatKwh, formatPercent } from '@riviamigo/ui/lib/utils';
import { DashboardPageShell, type DashboardPageShellRenderState } from './DashboardPageShell';
import type { DashboardPageProps } from './DashboardPage';

function summarizePeriods(periods: PhantomDrainPeriod[]) {
  const maxDrainPct = periods.reduce((max, period) => {
    if (period.soc_lost_pct == null || Number.isNaN(period.soc_lost_pct)) return max;
    return Math.max(max, period.soc_lost_pct);
  }, 0);

  const standbyValues = periods
    .map((period) => period.standby_pct)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const avgStandbyPct = standbyValues.length > 0
    ? (standbyValues.reduce((sum, value) => sum + value, 0) / standbyValues.length) * 100
    : null;

  const totalEnergyDrainedKwh = periods.reduce((sum, period) => {
    if (period.energy_drained_kwh == null || Number.isNaN(period.energy_drained_kwh)) return sum;
    return sum + period.energy_drained_kwh;
  }, 0);

  const drainRateValues = periods
    .map((period) => period.drain_pct_per_hour)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const avgDrainPctPerHour = drainRateValues.length > 0
    ? drainRateValues.reduce((sum, value) => sum + value, 0) / drainRateValues.length
    : null;

  return {
    maxDrainPct,
    avgStandbyPct,
    totalEnergyDrainedKwh,
    avgDrainPctPerHour,
  };
}

function PhantomDrainContent({ state }: { state: DashboardPageShellRenderState }) {
  const { vehicleId, ctx } = state;
  const { data, isLoading } = usePhantomDrainPeriods(vehicleId, ctx.from, ctx.to, 250, 6);
  const periods = data?.periods ?? [];
  const summary = summarizePeriods(periods);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-bg-surface px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-fg-tertiary">Max drain</p>
          <p className="mt-1 text-xl font-semibold text-fg">{formatPercent(summary.maxDrainPct, 2)}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-surface px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-fg-tertiary">Avg standby</p>
          <p className="mt-1 text-xl font-semibold text-fg">
            {summary.avgStandbyPct == null ? '-' : formatPercent(summary.avgStandbyPct, 1)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-bg-surface px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-fg-tertiary">Total energy drained</p>
          <p className="mt-1 text-xl font-semibold text-fg">{formatKwh(summary.totalEnergyDrainedKwh)}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-surface px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-fg-tertiary">Avg drain per hour</p>
          <p className="mt-1 text-xl font-semibold text-fg">
            {summary.avgDrainPctPerHour == null ? '-' : `${formatPercent(summary.avgDrainPctPerHour, 2)} / h`}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-bg-surface p-3">
        <DataTable
          data={periods}
          columns={phantomDrainColumns}
          loading={isLoading}
          loadingRows={12}
          emptyTitle="No phantom drain periods"
          emptyDescription="No qualifying parked periods were found in this date range."
          columnVisibilityMenu
          className="overflow-x-auto"
        />
      </div>
    </div>
  );
}

export function BatteryPhantomDrainPage({ navKey, slug, title }: DashboardPageProps) {
  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderBeforeDashboard={(state) => <PhantomDrainContent state={state} />}
      renderDashboard={() => false}
    />
  );
}
