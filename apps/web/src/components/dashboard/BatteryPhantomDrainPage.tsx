import React from 'react';
import { usePhantomDrainPeriods } from '@riviamigo/hooks';
import type { PhantomDrainPeriod } from '@riviamigo/types';
import { DataTable, TableControls, phantomDrainColumns } from '@riviamigo/ui/tables';
import { formatKwh, formatPercent } from '@riviamigo/ui/lib/utils';
import { DashboardPageShell, type DashboardPageShellRenderState } from './DashboardPageShell';
import type { DashboardPageProps } from './DashboardPage';

function summarizePeriods(periods: PhantomDrainPeriod[]) {
  const maxDrainPct = periods.reduce((max, period) => {
    if (period.soc_lost_pct == null || Number.isNaN(period.soc_lost_pct)) return max;
    return Math.max(max, period.soc_lost_pct);
  }, 0);

  const weightedSleep = periods.reduce(
    (acc, period) => {
      const duration = finiteNumber(period.duration_hours);
      const sleepShare = finiteNumber(period.sleep_share_pct);
      if (duration == null || sleepShare == null) return acc;
      acc.weightedSum += duration * sleepShare;
      acc.durationSum += duration;
      return acc;
    },
    { weightedSum: 0, durationSum: 0 }
  );
  const avgSleepPct = weightedSleep.durationSum > 0 ? weightedSleep.weightedSum / weightedSleep.durationSum : null;

  const weightedCoverage = periods.reduce(
    (acc, period) => {
      const duration = finiteNumber(period.duration_hours);
      const coverage = finiteNumber(period.state_coverage_pct);
      if (duration == null || coverage == null) return acc;
      acc.weightedSum += duration * coverage;
      acc.durationSum += duration;
      return acc;
    },
    { weightedSum: 0, durationSum: 0 }
  );
  const avgStateCoveragePct = weightedCoverage.durationSum > 0 ? weightedCoverage.weightedSum / weightedCoverage.durationSum : null;

  const totalEnergyDrainedKwh = periods.reduce((sum, period) => {
    if (period.energy_drained_kwh == null || Number.isNaN(period.energy_drained_kwh)) return sum;
    return sum + period.energy_drained_kwh;
  }, 0);

  const totalDurationHours = periods.reduce((sum, period) => {
    const duration = finiteNumber(period.duration_hours);
    return duration == null ? sum : sum + duration;
  }, 0);
  const totalSocLostPct = periods.reduce((sum, period) => {
    const lost = finiteNumber(period.soc_lost_pct);
    return lost == null ? sum : sum + lost;
  }, 0);
  const avgDrainPctPerHour = totalDurationHours > 0 ? totalSocLostPct / totalDurationHours : null;

  return {
    maxDrainPct,
    avgSleepPct,
    avgStateCoveragePct,
    totalEnergyDrainedKwh,
    avgDrainPctPerHour,
  };
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatPeriodSearchText(period: PhantomDrainPeriod) {
  const parts = [
    period.period_start,
    period.period_end,
    period.duration_hours == null ? null : `${period.duration_hours.toFixed(1)} h`,
    period.sleep_share_pct == null ? null : formatPercent(period.sleep_share_pct, 0),
    period.state_coverage_pct == null ? null : `${formatPercent(period.state_coverage_pct, 0)} coverage`,
    period.soc_start == null ? null : formatPercent(period.soc_start, 0),
    period.soc_end == null ? null : formatPercent(period.soc_end, 0),
    period.soc_lost_pct == null ? null : `-${formatPercent(period.soc_lost_pct, 2)}`,
    period.range_lost_mi == null ? null : `${period.range_lost_mi.toFixed(1)} mi`,
    period.energy_drained_kwh == null ? null : `${period.energy_drained_kwh.toFixed(2)} kWh`,
    period.avg_power_w == null ? null : `${period.avg_power_w.toFixed(0)} W`,
    period.has_reduced_range ? 'reduced range' : null,
    period.validation_reason,
  ];

  return parts.filter((part): part is string => !!part).join(' ').toLowerCase();
}

function PhantomDrainContent({ state }: { state: DashboardPageShellRenderState }) {
  const { vehicleId, ctx } = state;
  const { data, isLoading } = usePhantomDrainPeriods(vehicleId, ctx.from, ctx.to, 500, 6);
  const periods = data?.periods ?? [];
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(15);
  const deferredSearch = React.useDeferredValue(search);

  React.useEffect(() => {
    setPage(1);
  }, [ctx.from, ctx.to, ctx.vehicleId, pageSize, deferredSearch]);

  const filteredPeriods = React.useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) return periods;
    return periods.filter((period) => formatPeriodSearchText(period).includes(query));
  }, [deferredSearch, periods]);

  const totalPages = Math.max(1, Math.ceil(filteredPeriods.length / pageSize));

  React.useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const pagedPeriods = React.useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredPeriods.slice(start, start + pageSize);
  }, [filteredPeriods, page, pageSize]);

  const summary = React.useMemo(() => summarizePeriods(periods), [periods]);

  return (
    <div className="grid gap-4 min-w-0">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-bg-surface px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-fg-tertiary">Max drain</p>
          <p className="mt-1 text-xl font-semibold text-fg">{formatPercent(summary.maxDrainPct, 2)}</p>
        </div>
        <div className="rounded-xl border border-border bg-bg-surface px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-fg-tertiary">Avg sleep</p>
          <p className="mt-1 text-xl font-semibold text-fg">
            {summary.avgSleepPct == null ? '-' : formatPercent(summary.avgSleepPct, 1)}
          </p>
          <p className="mt-1 text-[11px] text-fg-tertiary">
            State coverage {summary.avgStateCoveragePct == null ? 'unknown' : formatPercent(summary.avgStateCoveragePct, 0)}
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

      <div className="min-w-0 rounded-xl border border-border bg-bg-surface p-3">
        <TableControls
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search periods"
          rowsPerPage={pageSize}
          rowsPerPageOptions={[15, 25, 50, 100]}
          onRowsPerPageChange={setPageSize}
          page={page}
          totalPages={totalPages}
          totalItems={filteredPeriods.length}
          itemLabel="period"
        />

        <DataTable
          data={pagedPeriods}
          columns={phantomDrainColumns}
          loading={isLoading}
          loadingRows={pageSize}
          emptyTitle={search ? 'No matching phantom drain periods' : 'No phantom drain periods'}
          emptyDescription={search ? 'No parked periods match that search.' : 'No qualifying parked periods were found in this date range.'}
          columnVisibilityMenu
          fixedLayout
          defaultHiddenColumns={['range_lost_per_hour_mi', 'state_coverage_pct', 'validation_reason']}
          className="overflow-x-hidden"
        />

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs text-fg-tertiary">
            Showing {pagedPeriods.length} of {filteredPeriods.length} period{filteredPeriods.length === 1 ? '' : 's'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-bg-elevated disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages || totalPages <= 1}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-bg-elevated disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
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
