import React, { useState } from 'react';
import { useEfficiencyTrend, useEfficiencyVsTemp, useTrips } from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import { EfficiencyDrivesChart, EfficiencyVsTempChart } from '@riviamigo/ui/charts';
import { ChartPicker, StatCard } from '@riviamigo/ui/primitives';
import { formatEfficiency, formatTemp } from '@riviamigo/ui/lib/utils';
import { createDefaultDashboardEditActions, renderDefaultDashboardTitleAction, type DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

type EfficiencyChartKey = 'temperature' | 'drives';

const EFFICIENCY_CHART_OPTIONS: Array<{ value: EfficiencyChartKey; label: string }> = [
  { value: 'temperature', label: 'Temperature - Driving Efficiency' },
  { value: 'drives', label: 'Drives and 7-Day Trend' },
];

export function EfficiencyDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions(updateDashboard)}
      showEfficiencyDisplayToggle
      renderBeforeDashboard={({ isEditMode, ctx }) =>
        !isEditMode ? <EfficiencySummaryPanel vehicleId={ctx.vehicleId} from={ctx.from} to={ctx.to} /> : null
      }
      renderDashboard={({ isEditMode }) => isEditMode}
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
  const [chartKey, setChartKey] = useState<EfficiencyChartKey>('temperature');
  const [chartSearch, setChartSearch] = useState('');
  const { data: trend = [], isFetching: trendFetching } = useEfficiencyTrend(vehicleId, from, to);
  const { data: temp = [], isFetching: tempFetching } = useEfficiencyVsTemp(vehicleId, from, to);
  const { data: tripPage, isFetching: tripsFetching } = useTrips(vehicleId, from, to, 1, 200);
  const drives = tripPage?.items ?? [];
  const loading = trendFetching || tripsFetching || tempFetching;

  const validDays = trend.filter((point) => point.day_avg_wh_mi != null);
  const avgWh = validDays.length
    ? validDays.reduce((sum, point) => sum + (point.day_avg_wh_mi ?? 0), 0) / validDays.length
    : null;
  const validRolling = trend.filter((point) => point.rolling_7d_wh_mi != null);
  const latestRolling = validRolling[validRolling.length - 1]?.rolling_7d_wh_mi ?? null;

  return (
    <section className="mb-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Avg Efficiency (range)" value={loading ? '...' : formatEfficiency(avgWh)} />
        <StatCard label="7-Day Rolling Avg" value={loading ? '...' : formatEfficiency(latestRolling)} />
        <StatCard label="Drives in Range" value={loading ? '...' : String(tripPage?.total ?? drives.length)} />
      </div>

      <div className="rounded-xl border border-border bg-bg-elevated/70 p-4">
        <ChartPicker
          value={chartKey}
          options={EFFICIENCY_CHART_OPTIONS}
          onChange={setChartKey}
          searchValue={chartSearch}
          onSearchChange={setChartSearch}
        />
        {chartKey === 'temperature' ? (
          <>
            <EfficiencyVsTempChart data={temp} loading={tempFetching} height={300} />
            <TemperatureEfficiencyTable data={temp} loading={tempFetching} />
          </>
        ) : (
          <EfficiencyDrivesChart
            trend={trend}
            drives={drives}
            loading={trendFetching || tripsFetching}
            height={300}
          />
        )}
      </div>
    </section>
  );
}

function TemperatureEfficiencyTable({
  data,
  loading,
}: {
  data: Array<{ temp_c_low: number; temp_c_high: number; avg_efficiency_wh_mi: number | null; trip_count: number }>;
  loading: boolean;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border bg-bg/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-tertiary">
            <th className="px-3 py-2">Temperature</th>
            <th className="px-3 py-2">Avg Efficiency</th>
            <th className="px-3 py-2 text-right">Drives</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={3} className="px-3 py-5 text-center text-fg-tertiary">Loading...</td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-5 text-center text-fg-tertiary">
                No outside-temperature telemetry is available for this range yet.
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr key={`${row.temp_c_low}-${row.temp_c_high}`} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 text-fg">
                  {formatTemp(row.temp_c_low)} - {formatTemp(row.temp_c_high)}
                </td>
                <td className="px-3 py-2 font-mono text-fg-secondary">{formatEfficiency(row.avg_efficiency_wh_mi)}</td>
                <td className="px-3 py-2 text-right font-mono text-fg-secondary">{row.trip_count}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
