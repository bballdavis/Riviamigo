import React from 'react';
import { SensorChipSummary } from '@riviamigo/dashboards';
import { usePhantomDrainPeriods } from '@riviamigo/hooks';
import type { PhantomDrainPeriod } from '@riviamigo/types';
import { DataTable, TableControls, phantomDrainColumns } from '@riviamigo/ui/tables';
import { formatPercent } from '@riviamigo/ui/lib/utils';
import { DashboardPageShell, type DashboardPageShellRenderState } from './DashboardPageShell';
import type { DashboardPageProps } from './DashboardPage';
import { buildPhantomDrainSummaryCards, summarizePhantomDrainPeriods } from './phantomDrainSummary';

function formatRatioPercent(value: number | null | undefined, decimals = 0) {
  if (value == null || Number.isNaN(value)) return null;
  return formatPercent(value * 100, decimals);
}

function formatPeriodSearchText(period: PhantomDrainPeriod) {
  const parts = [
    period.period_start,
    period.period_end,
    period.duration_hours == null ? null : `${period.duration_hours.toFixed(1)} h`,
    formatRatioPercent(period.sleep_share_pct, 0),
    period.state_coverage_pct == null ? null : `${formatRatioPercent(period.state_coverage_pct, 0)} coverage`,
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

  const summary = React.useMemo(() => summarizePhantomDrainPeriods(periods), [periods]);
  const summaryCards = React.useMemo(() => buildPhantomDrainSummaryCards(summary), [summary]);

  return (
    <div className="grid gap-4 min-w-0">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <SensorChipSummary
            key={card.key}
            title={card.title}
            value={card.value}
            icon={card.icon}
            {...(card.accentBorder === undefined ? {} : { accentBorder: card.accentBorder })}
            {...(card.secondary === undefined ? {} : { secondary: card.secondary })}
          />
        ))}
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
      enableDashboardEditing={false}
      renderBeforeDashboard={(state) => <PhantomDrainContent state={state} />}
      renderDashboard={() => false}
    />
  );
}
