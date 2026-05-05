import React, { useState } from 'react';
import { useChargeSessions, useChargeCurve, useChargingSummary } from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import { ChargingSessionsChart, ChargeCurveChart } from '@riviamigo/ui/charts';
import { formatCurrency, formatKwh, formatDuration } from '@riviamigo/ui/lib/utils';
import type { ChargeSession } from '@riviamigo/types';
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
      renderBeforeDashboard={({ isEditMode, ctx }) =>
        !isEditMode ? (
          <ChargingPanel vehicleId={ctx.vehicleId} from={ctx.from} to={ctx.to} />
        ) : null
      }
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

  const { data: summary, isLoading: summaryLoading } = useChargingSummary(vehicleId, from, to);
  const { data: sessionsPage, isLoading: sessionsLoading } = useChargeSessions(vehicleId, from, to, 1);
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
      {/* Summary stats row */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Sessions" value={summaryLoading ? '...' : String(summary?.session_count ?? 0)} />
        <MetricCard label="Total Energy" value={summaryLoading ? '...' : formatKwh(summary?.total_energy_kwh ?? 0)} />
        <MetricCard label="Total Cost" value={summaryLoading ? '...' : formatCurrency(summary?.total_cost_usd ?? 0)} />
        <MetricCard
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

      {/* Home/Away + AC/DC split */}
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-bg-elevated/70 p-3">
          <div className="text-xs uppercase tracking-wide text-fg-tertiary">Home vs Public</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-fg">{homeShare.toFixed(0)}%</div>
          <div className="mt-1 text-xs text-fg-tertiary">
            Home {formatKwh(summary?.home_kwh ?? 0)} &bull; Away {formatKwh(summary?.away_kwh ?? 0)}
          </div>
          {(summary?.home_kwh == null || summary.home_kwh === 0) && (
            <div className="mt-1 text-[10px] italic text-fg-tertiary/70">
              Home/away split not reported by Rivian for all sessions
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-bg-elevated/70 p-3">
          <div className="text-xs uppercase tracking-wide text-fg-tertiary">AC vs DC</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-fg">{dcShare.toFixed(0)}% DC</div>
          <div className="mt-1 text-xs text-fg-tertiary">
            AC {formatKwh(summary?.ac_kwh ?? 0)} &bull; DC {formatKwh(summary?.dc_kwh ?? 0)}
          </div>
          {(summary?.ac_kwh == null || (summary.ac_kwh === 0 && summary.dc_kwh === 0)) && (
            <div className="mt-1 text-[10px] italic text-fg-tertiary/70">
              AC/DC split not reported by Rivian for all sessions
            </div>
          )}
        </div>
      </div>

      {/* Sessions chart */}
      <div className="rounded-xl border border-border bg-bg-elevated/70 p-4">
        <ChargingSessionsChart
          title="Charging Sessions — Click a Bar to Inspect"
          sessions={sessions}
          selectedId={selectedId}
          onSelect={handleSelect}
          loading={sessionsLoading}
          height={220}
        />
      </div>

      {/* Sessions table */}
      <div className="rounded-xl border border-border bg-bg-elevated/70 overflow-hidden">
        <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-fg-tertiary border-b border-border">
          All Sessions ({sessionsLoading ? '…' : sessions.length})
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
                  <td colSpan={8} className="px-4 py-6 text-center text-fg-tertiary">
                    Loading…
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-fg-tertiary">
                    No sessions found for this date range.
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    selected={s.id === selectedId}
                    onSelect={handleSelect}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected session detail */}
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
      ? `${Math.round(session.soc_start)}% → ${Math.round(session.soc_end)}%`
      : session.soc_end != null
      ? `→ ${Math.round(session.soc_end)}%`
      : '—';

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
      <td className="px-4 py-2 font-mono text-fg-secondary">
        {session.peak_power_kw != null ? `${session.peak_power_kw.toFixed(0)} kW` : <NullNote />}
      </td>
      <td className="px-4 py-2 text-fg-secondary">{session.charger_type ?? <NullNote />}</td>
      <td className="max-w-[180px] truncate px-4 py-2 text-fg-secondary">
        {session.location_name ?? <NullNote />}
      </td>
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
  curve: Array<{ soc_pct: number; power_kw: number }>;
  curveFetching: boolean;
}) {
  const curveData = curve.map((p) => ({ soc: p.soc_pct, power_kw: p.power_kw }));
  const socRange =
    session.soc_start != null && session.soc_end != null
      ? `${Math.round(session.soc_start)}% → ${Math.round(session.soc_end)}%`
      : '—';

  return (
    <div className="space-y-4 rounded-xl border border-accent/40 bg-bg-elevated/70 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-fg">Session Detail</div>
        <div className="text-xs text-fg-tertiary">
          {new Date(session.started_at).toLocaleString()}
          {session.ended_at ? ` – ${new Date(session.ended_at).toLocaleTimeString()}` : ''}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DetailStat label="Energy Added" value={formatKwh(session.energy_added_kwh)} />
        <DetailStat label="Duration" value={formatDuration(session.duration_min)} />
        <DetailStat label="State of Charge" value={socRange} />
        <DetailStat
          label="Peak Power"
          value={session.peak_power_kw != null ? `${session.peak_power_kw.toFixed(1)} kW` : null}
          note={
            session.peak_power_kw == null
              ? 'Not logged by Rivian for this session'
              : undefined
          }
        />
        <DetailStat
          label="Charger Type"
          value={session.charger_type}
          note={
            session.charger_type == null
              ? 'Not reported by Rivian for this session'
              : undefined
          }
        />
        <DetailStat
          label="Location"
          value={session.location_name}
          note={
            session.location_name == null
              ? 'GPS logged but no place matched — add a geofence to auto-label sessions'
              : undefined
          }
        />
        <DetailStat label="Cost" value={formatCurrency(session.cost_usd)} />
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
          Charge Curve — Power vs State of Charge
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

function DetailStat({
  label,
  value,
  note,
}: {
  label: string;
  value: string | null | undefined;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">{label}</div>
      {value != null ? (
        <div className="mt-1 font-mono text-sm font-semibold text-fg">{value}</div>
      ) : (
        <div className="mt-1 text-xs italic text-fg-tertiary">{note ?? 'Not available'}</div>
      )}
    </div>
  );
}

function NullNote() {
  return (
    <span
      className="text-[11px] italic text-fg-tertiary/60"
      title="Not reported by Rivian for this session"
    >
      —
    </span>
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
