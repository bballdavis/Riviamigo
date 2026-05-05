import React, { useState } from 'react';
import { useChargeSessions, useChargeCurve, useChargingSummary } from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import { ChargingSessionsChart, ChargeCurveChart, SocAreaChart } from '@riviamigo/ui/charts';
import { ChartPicker, StatCard } from '@riviamigo/ui/primitives';
import { formatCurrency, formatKwh, formatDuration, formatNumber } from '@riviamigo/ui/lib/utils';
import type { ChargeCurvePoint, ChargeSession } from '@riviamigo/types';
import { createDefaultDashboardEditActions, renderDefaultDashboardTitleAction, type DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

type ChargingChartKey = 'sessions' | 'charge-level';

const CHARGING_CHART_OPTIONS: Array<{ value: ChargingChartKey; label: string }> = [
  { value: 'sessions', label: 'Energy per Session' },
  { value: 'charge-level', label: 'Charge Level' },
];

export function ChargingDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions(updateDashboard)}
      renderBeforeDashboard={({ isEditMode, ctx }) =>
        !isEditMode ? <ChargingPanel vehicleId={ctx.vehicleId} from={ctx.from} to={ctx.to} /> : null
      }
      renderDashboard={({ isEditMode }) => isEditMode}
    />
  );
}

function ChargingPanel({
  vehicleId,
  from,
  to,
}: {
  vehicleId: string | null;
  from: string;
  to: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chartKey, setChartKey] = useState<ChargingChartKey>('sessions');
  const [chartSearch, setChartSearch] = useState('');

  const { data: summary, isLoading: summaryLoading } = useChargingSummary(vehicleId, from, to);
  const { data: sessionsPage, isLoading: sessionsLoading } = useChargeSessions(vehicleId, from, to, 1, 200);
  const sessions = sessionsPage?.items ?? [];

  const { data: curve, isFetching: curveFetching } = useChargeCurve(selectedId, vehicleId);
  const selectedSession = sessions.find((s) => s.id === selectedId) ?? null;

  const totalKwh = summary?.total_energy_kwh ?? 0;
  const homeShare = totalKwh > 0 ? ((summary?.home_kwh ?? 0) / totalKwh) * 100 : 0;
  const dcShare = totalKwh > 0 ? ((summary?.dc_kwh ?? 0) / totalKwh) * 100 : 0;

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <section className="mb-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sessions" value={summaryLoading ? '...' : String(summary?.session_count ?? 0)} />
        <StatCard label="Total Energy" value={summaryLoading ? '...' : formatKwh(summary?.total_energy_kwh ?? 0)} accent />
        <StatCard label="Total Cost" value={summaryLoading ? '...' : formatCurrency(summary?.total_cost_usd ?? 0)} />
        <StatCard
          label="Avg / Session"
          value={
            summaryLoading
              ? '...'
              : summary?.session_count
                ? formatKwh((summary.total_energy_kwh ?? 0) / summary.session_count)
                : '-'
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Charging Cycles" value={summaryLoading ? '...' : formatStatNumber(summary?.charging_cycles, 0)} />
        <StatCard label="Charging Efficiency" value={summaryLoading ? '...' : formatPercentValue(summary?.charging_efficiency_pct)} />
        <StatCard label="Max Charge Rate" value={summaryLoading ? '...' : formatKw(summary?.max_charge_rate_kw)} />
        <StatCard label="Max Charge Limit" value={summaryLoading ? '...' : formatPercentValue(summary?.max_charge_limit_pct)} />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <StatCard
          label="Home Charging"
          value={summaryLoading ? '...' : `${homeShare.toFixed(0)}%`}
          detail={`Home ${formatKwh(summary?.home_kwh ?? 0)} / Away ${formatKwh(summary?.away_kwh ?? 0)}`}
        />
        <StatCard
          label="DC Share"
          value={summaryLoading ? '...' : `${dcShare.toFixed(0)}%`}
          detail={`AC ${formatKwh(summary?.ac_kwh ?? 0)} / DC ${formatKwh(summary?.dc_kwh ?? 0)}`}
        />
      </div>

      <div className="rounded-xl border border-border bg-bg-elevated/70 p-4">
        <ChartPicker
          value={chartKey}
          options={CHARGING_CHART_OPTIONS}
          onChange={setChartKey}
          searchValue={chartSearch}
          onSearchChange={setChartSearch}
        />
        {chartKey === 'charge-level' ? (
          <SocAreaChart data={buildChargeLevelSeries(sessions)} loading={sessionsLoading} height={240} showBrush />
        ) : (
          <ChargingSessionsChart
            sessions={sessions}
            selectedId={selectedId}
            onSelect={handleSelect}
            loading={sessionsLoading}
            height={220}
          />
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-bg-elevated/70">
        <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
          All Sessions ({sessionsLoading ? '...' : sessions.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-tertiary">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Energy</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">SoC</th>
                <th className="px-4 py-2">Peak kW</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Location</th>
                <th className="px-4 py-2">Cost</th>
              </tr>
            </thead>
            <tbody>
              {sessionsLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-fg-tertiary">Loading...</td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-fg-tertiary">
                    No sessions found for this date range.
                  </td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    selected={session.id === selectedId}
                    onSelect={handleSelect}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSession ? (
        <SelectedSessionDetail
          session={selectedSession}
          curve={curve ?? []}
          curveFetching={curveFetching}
        />
      ) : null}
    </section>
  );
}

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: ChargeSession;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const socRange =
    session.soc_start != null && session.soc_end != null
      ? `${Math.round(session.soc_start)}% -> ${Math.round(session.soc_end)}%`
      : session.soc_end != null
        ? `-> ${Math.round(session.soc_end)}%`
        : '-';

  return (
    <tr
      className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-bg-elevated/50 ${
        selected ? 'bg-accent/10 outline outline-1 outline-accent/40' : ''
      }`}
      onClick={() => onSelect(session.id)}
    >
      <td className="px-4 py-2 text-fg">
        {new Date(session.started_at).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </td>
      <td className="px-4 py-2 font-mono text-fg">{formatKwh(session.energy_added_kwh)}</td>
      <td className="px-4 py-2 text-fg-secondary">{formatDuration(session.duration_min)}</td>
      <td className="px-4 py-2 font-mono text-fg-secondary">{socRange}</td>
      <td className="px-4 py-2 font-mono text-fg-secondary">{formatKw(session.peak_power_kw)}</td>
      <td className="px-4 py-2 text-fg-secondary">{formatChargerType(session.charger_type)}</td>
      <td className="max-w-[180px] truncate px-4 py-2 text-fg-secondary">{session.location_name ?? '-'}</td>
      <td className="px-4 py-2 font-mono text-fg-secondary">{formatCurrency(session.cost_usd)}</td>
    </tr>
  );
}

function SelectedSessionDetail({
  session,
  curve,
  curveFetching,
}: {
  session: ChargeSession;
  curve: ChargeCurvePoint[];
  curveFetching: boolean;
}) {
  const curveData = curve.map((point) => ({ soc: point.soc_pct, power_kw: point.power_kw }));
  const socRange =
    session.soc_start != null && session.soc_end != null
      ? `${Math.round(session.soc_start)}% -> ${Math.round(session.soc_end)}%`
      : '-';

  return (
    <div className="space-y-4 rounded-xl border border-accent/40 bg-bg-elevated/70 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-fg">Session Detail</div>
        <div className="text-xs text-fg-tertiary">
          {new Date(session.started_at).toLocaleString()}
          {session.ended_at ? ` - ${new Date(session.ended_at).toLocaleTimeString()}` : ''}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailStat label="Energy Added" value={formatKwh(session.energy_added_kwh)} />
        <DetailStat label="Duration" value={formatDuration(session.duration_min)} />
        <DetailStat label="State of Charge" value={socRange} />
        <DetailStat label="Peak Power" value={formatKw(session.peak_power_kw)} />
        <DetailStat label="Charger Type" value={formatChargerType(session.charger_type)} />
        <DetailStat label="Location" value={session.location_name ?? '-'} />
        <DetailStat label="Cost" value={formatCurrency(session.cost_usd)} />
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
          Charge Curve - Power vs State of Charge
        </div>
        {curveData.length === 0 && !curveFetching ? (
          <div className="rounded-lg border border-border bg-bg/50 p-4 text-sm text-fg-tertiary">
            No charge curve telemetry available for this session.
          </div>
        ) : (
          <ChargeCurveChart data={curveData} loading={curveFetching} height={200} />
        )}
      </div>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-fg">{value}</div>
    </div>
  );
}

function buildChargeLevelSeries(sessions: ChargeSession[]) {
  return [...sessions]
    .filter((session) => session.soc_end != null)
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
    .flatMap((session) => {
      const points = [];
      if (session.soc_start != null) points.push({ ts: session.started_at, soc: session.soc_start });
      points.push({ ts: session.ended_at ?? session.started_at, soc: session.soc_end ?? 0 });
      return points;
    });
}

function formatStatNumber(value: number | null | undefined, decimals = 1) {
  return value == null ? '-' : formatNumber(value, decimals);
}

function formatPercentValue(value: number | null | undefined) {
  return value == null ? '-' : `${formatNumber(value, 1)}%`;
}

function formatKw(value: number | null | undefined) {
  return value == null ? '-' : `${formatNumber(value, 1)} kW`;
}

function formatChargerType(value: string | null | undefined) {
  if (!value) return '-';
  if (value === 'ac_l2') return 'AC L2';
  return value.toUpperCase();
}
