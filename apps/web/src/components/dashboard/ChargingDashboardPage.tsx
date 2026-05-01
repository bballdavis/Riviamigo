import React from 'react';
import { useChargingSummary } from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import { EnergyBarChart } from '@riviamigo/ui/charts';
import { formatCurrency, formatKwh } from '@riviamigo/ui/lib/utils';
import { createDefaultDashboardEditActions, renderDefaultDashboardTitleAction, type DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

export function ChargingDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions(updateDashboard)}
      renderBeforeDashboard={({ isEditMode, ctx }) => (
        !isEditMode ? <ChargingSummaryPanel vehicleId={ctx.vehicleId} from={ctx.from} to={ctx.to} /> : null
      )}
    />
  );
}

function ChargingSummaryPanel({ vehicleId, from, to }: { vehicleId: string | null; from: string; to: string }) {
  const { data, isLoading } = useChargingSummary(vehicleId, from, to);
  const weekly = (data?.weekly ?? []).map((point) => ({
    ts: point.week_start,
    energy_added_kwh: point.energy_kwh,
  }));

  const totalKwh = data?.total_energy_kwh ?? 0;
  const homeShare = totalKwh > 0 ? ((data?.home_kwh ?? 0) / totalKwh) * 100 : 0;
  const dcShare = totalKwh > 0 ? ((data?.dc_kwh ?? 0) / totalKwh) * 100 : 0;

  return (
    <section className="mb-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Sessions" value={isLoading ? '...' : String(data?.session_count ?? 0)} />
        <MetricCard label="Energy" value={isLoading ? '...' : formatKwh(data?.total_energy_kwh ?? 0)} />
        <MetricCard label="Cost" value={isLoading ? '...' : formatCurrency(data?.total_cost_usd ?? 0)} />
        <MetricCard label="Avg / Session" value={isLoading ? '...' : (data?.session_count ? formatKwh((data.total_energy_kwh ?? 0) / data.session_count) : '-')} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-bg-elevated/70 p-3">
          <div className="text-xs uppercase tracking-wide text-fg-tertiary">Home vs Public</div>
          <div className="mt-2 text-sm text-fg-secondary">Home charging share</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-fg">{homeShare.toFixed(0)}%</div>
          <div className="mt-2 text-xs text-fg-tertiary">Home {formatKwh(data?.home_kwh ?? 0)} • Away {formatKwh(data?.away_kwh ?? 0)}</div>
        </div>
        <div className="rounded-xl border border-border bg-bg-elevated/70 p-3">
          <div className="text-xs uppercase tracking-wide text-fg-tertiary">AC vs DC</div>
          <div className="mt-2 text-sm text-fg-secondary">DC charging share</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-fg">{dcShare.toFixed(0)}%</div>
          <div className="mt-2 text-xs text-fg-tertiary">AC {formatKwh(data?.ac_kwh ?? 0)} • DC {formatKwh(data?.dc_kwh ?? 0)}</div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-bg-elevated/70 p-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-fg-tertiary">Charging by Week</div>
        <EnergyBarChart data={weekly} loading={isLoading} height={180} />
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
