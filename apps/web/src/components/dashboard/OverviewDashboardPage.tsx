import React, { useState } from 'react';
import {
  useAuth,
  useBatteryMileage,
  useChargeSessions,
  useChargingSummary,
  useCurrentVehicleStatus,
  useDegradation,
  useEfficiencyByMode,
  useEfficiencyTrend,
  useEfficiencyVsTemp,
  usePhantomDrain,
  useRangeHistory,
  useSocHistory,
  useSummaryStats,
  useVehicles,
} from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import {
  BatteryCapacityByMileageChart,
  ChargingSessionsChart,
  DegradationChart,
  EfficiencyChart,
  EfficiencyTrendChart,
  EfficiencyVsTempChart,
  EnergyBarChart,
  PhantomDrainChart,
  ProjectedRangeByMileageChart,
  RangeAreaChart,
  SocAreaChart,
} from '@riviamigo/ui/charts';
import { ChartPicker, StatCard } from '@riviamigo/ui/primitives';
import { formatEfficiency, formatKwh, formatMiles } from '@riviamigo/ui/lib/utils';
import {
  createDefaultDashboardEditActions,
  CurrentVehicleStatePanel,
  renderDefaultDashboardTitleAction,
  type DashboardPageProps,
} from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

type OverviewChartKey =
  | 'soc'
  | 'range'
  | 'charge-level'
  | 'charging-sessions'
  | 'energy'
  | 'efficiency-trend'
  | 'efficiency-temperature'
  | 'efficiency-mode'
  | 'phantom'
  | 'battery-degradation'
  | 'battery-capacity-mileage'
  | 'projected-range-mileage';

const OVERVIEW_CHART_OPTIONS: Array<{ value: OverviewChartKey; label: string }> = [
  { value: 'soc', label: 'Battery Level' },
  { value: 'range', label: 'Estimated Range' },
  { value: 'charge-level', label: 'Charge Level' },
  { value: 'charging-sessions', label: 'Charging Sessions' },
  { value: 'energy', label: 'Energy Charged' },
  { value: 'efficiency-trend', label: 'Efficiency Trend' },
  { value: 'efficiency-temperature', label: 'Efficiency by Temperature' },
  { value: 'efficiency-mode', label: 'Efficiency by Drive Mode' },
  { value: 'phantom', label: 'Phantom Drain' },
  { value: 'battery-degradation', label: 'Battery Health' },
  { value: 'battery-capacity-mileage', label: 'Battery Capacity by Mileage' },
  { value: 'projected-range-mileage', label: 'Projected Range - Mileage' },
];

export function OverviewDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const { defaultVehicleId } = useAuth();
  const updateDashboard = useUpdateDashboard();
  const { data: currentStatus } = useCurrentVehicleStatus(defaultVehicleId);
  const { data: vehicles } = useVehicles();
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === defaultVehicleId);

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions(updateDashboard)}
      showEfficiencyDisplayToggle
      renderBeforeDashboard={({ isEditMode, ctx }) =>
        !isEditMode ? (
          <>
            <CurrentVehicleStatePanel status={currentStatus} images={activeVehicle?.images} />
            <OverviewStatsRow vehicleId={ctx.vehicleId} />
            <OverviewChartPanel vehicleId={ctx.vehicleId} from={ctx.from} to={ctx.to} />
          </>
        ) : (
          <CurrentVehicleStatePanel status={currentStatus} images={activeVehicle?.images} />
        )
      }
      renderDashboard={({ isEditMode }) => isEditMode}
    />
  );
}

function OverviewStatsRow({ vehicleId }: { vehicleId: string | null }) {
  const { data: stats, isLoading } = useSummaryStats(vehicleId);

  return (
    <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Total Miles"
        value={isLoading ? '...' : formatMiles(stats?.total_miles ?? 0)}
        accent
      />
      <StatCard label="Total Trips" value={isLoading ? '...' : String(stats?.total_trips ?? 0)} />
      <StatCard
        label="Energy Charged"
        value={isLoading ? '...' : formatKwh(stats?.total_energy_kwh ?? 0)}
      />
      <StatCard
        label="Avg Efficiency"
        value={isLoading ? '...' : formatEfficiency(stats?.avg_efficiency_wh_mi)}
      />
    </section>
  );
}

function OverviewChartPanel({
  vehicleId,
  from,
  to,
}: {
  vehicleId: string | null;
  from: string;
  to: string;
}) {
  const [chartKey, setChartKey] = useState<OverviewChartKey>('soc');
  const [chartSearch, setChartSearch] = useState('');

  return (
    <div className="mb-4 rounded-xl border border-border bg-bg-elevated/70 p-4">
      <ChartPicker
        value={chartKey}
        options={OVERVIEW_CHART_OPTIONS}
        onChange={setChartKey}
        searchValue={chartSearch}
        onSearchChange={setChartSearch}
      />
      <OverviewChart chartKey={chartKey} vehicleId={vehicleId} from={from} to={to} />
    </div>
  );
}

function OverviewChart({
  chartKey,
  vehicleId,
  from,
  to,
}: {
  chartKey: OverviewChartKey;
  vehicleId: string | null;
  from: string;
  to: string;
}) {
  const { data: soc = [], isFetching: socFetching } = useSocHistory(
    chartKey === 'soc' ? vehicleId : null,
    from,
    to,
  );
  const { data: range = [], isFetching: rangeFetching } = useRangeHistory(
    chartKey === 'range' ? vehicleId : null,
    from,
    to,
  );
  const { data: trend = [], isFetching: trendFetching } = useEfficiencyTrend(
    chartKey === 'efficiency-trend' ? vehicleId : null,
    from,
    to,
  );
  const { data: chargeSummary, isFetching: chargeFetching } = useChargingSummary(
    chartKey === 'energy' ? vehicleId : null,
    from,
    to,
  );
  const { data: sessionsPage, isLoading: sessionsLoading } = useChargeSessions(
    chartKey === 'charging-sessions' || chartKey === 'charge-level' ? vehicleId : null,
    from,
    to,
    1,
    200,
  );
  const { data: phantom = [], isFetching: phantomFetching } = usePhantomDrain(
    chartKey === 'phantom' ? vehicleId : null,
    from,
    to,
  );
  const { data: degradation = [], isLoading: degradationLoading } = useDegradation(
    chartKey === 'battery-degradation' ? vehicleId : null,
  );
  const { data: mileage = [], isLoading: mileageLoading } = useBatteryMileage(
    chartKey === 'battery-capacity-mileage' || chartKey === 'projected-range-mileage' ? vehicleId : null,
  );
  const { data: efficiencyByMode = [], isFetching: efficiencyByModeFetching } = useEfficiencyByMode(
    chartKey === 'efficiency-mode' ? vehicleId : null,
    from,
    to,
  );
  const { data: efficiencyByTemp = [], isFetching: efficiencyByTempFetching } = useEfficiencyVsTemp(
    chartKey === 'efficiency-temperature' ? vehicleId : null,
    from,
    to,
  );

  const sessions = sessionsPage?.items ?? [];
  const weekly = (chargeSummary?.weekly ?? []).map((week) => ({
    ts: week.week_start,
    energy_added_kwh: week.energy_kwh,
  }));

  switch (chartKey) {
    case 'soc':
      return <SocAreaChart data={soc} loading={socFetching} height={300} showBrush showGrid />;
    case 'range':
      return <RangeAreaChart data={range} loading={rangeFetching} height={300} showBrush />;
    case 'charge-level':
      return <SocAreaChart data={buildChargeLevelSeries(sessions)} loading={sessionsLoading} height={300} showBrush />;
    case 'charging-sessions':
      return <ChargingSessionsChart sessions={sessions} loading={sessionsLoading} height={300} />;
    case 'energy':
      return <EnergyBarChart data={weekly} loading={chargeFetching} height={300} showBrush />;
    case 'efficiency-trend':
      return <EfficiencyTrendChart data={trend} loading={trendFetching} height={300} showBrush />;
    case 'efficiency-temperature':
      return <EfficiencyVsTempChart data={efficiencyByTemp} loading={efficiencyByTempFetching} height={300} />;
    case 'efficiency-mode':
      return <EfficiencyChart data={efficiencyByMode} loading={efficiencyByModeFetching} height={300} />;
    case 'phantom':
      return <PhantomDrainChart data={phantom} loading={phantomFetching} height={300} />;
    case 'battery-degradation':
      return <DegradationChart data={degradation} loading={degradationLoading} height={300} showBrush />;
    case 'battery-capacity-mileage':
      return <BatteryCapacityByMileageChart data={mileage} loading={mileageLoading} height={300} />;
    case 'projected-range-mileage':
      return <ProjectedRangeByMileageChart data={mileage} loading={mileageLoading} height={300} />;
  }
}

function buildChargeLevelSeries(sessions: Array<{ started_at: string; ended_at?: string | null; soc_start?: number | null; soc_end?: number | null }>) {
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
