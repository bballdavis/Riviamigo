import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  useAuth,
  useBatteryHealth,
  useBatteryMileage,
  useChargeCurve,
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
  useTrips,
  useVehicles,
} from '@riviamigo/hooks';
import {
  ChargeCurveChart,
  RichTimeSeriesChart,
} from '@riviamigo/ui/charts';
import { Card, ChartPicker, StatCard, Tooltip } from '@riviamigo/ui/primitives';
import {
  formatAltitude,
  formatCurrency,
  formatDuration,
  formatEfficiency,
  formatKwh,
  formatMiles,
  formatMph,
  formatNumber,
  formatPressure,
  formatTemp,
  getEfficiencyDisplay,
  getUnitSystem,
  whPerMileToKmPerKwh,
  whPerMileToMiPerKwh,
  whPerMileToWhPerKm,
} from '@riviamigo/ui/lib/utils';
import type { ChargeCurvePoint, ChargeSession, VehicleImages, VehicleStatus } from '@riviamigo/types';
import { Battery, Car, Cpu, Gauge, Lock, MapPin, PlugZap, Thermometer, Unlock, Unplug } from 'lucide-react';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';

type ChartOption<T extends string> = { value: T; label: string };

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

const OVERVIEW_CHART_OPTIONS: Array<ChartOption<OverviewChartKey>> = [
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

type BatteryChartKey = 'capacity-mileage' | 'projected-range-mileage' | 'degradation';
const BATTERY_CHART_OPTIONS: Array<ChartOption<BatteryChartKey>> = [
  { value: 'capacity-mileage', label: 'Battery Capacity by Mileage' },
  { value: 'projected-range-mileage', label: 'Projected Range - Mileage' },
  { value: 'degradation', label: 'Battery Health' },
];

type ChargingChartKey = 'sessions' | 'charge-level';
const CHARGING_CHART_OPTIONS: Array<ChartOption<ChargingChartKey>> = [
  { value: 'sessions', label: 'Energy per Session' },
  { value: 'charge-level', label: 'Charge Level' },
];

type EfficiencyChartKey = 'temperature' | 'drives';
const EFFICIENCY_CHART_OPTIONS: Array<ChartOption<EfficiencyChartKey>> = [
  { value: 'temperature', label: 'Temperature - Driving Efficiency' },
  { value: 'drives', label: 'Drives and 7-Day Trend' },
];

function OverviewVehicleWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { defaultVehicleId } = useAuth();
  const vehicleId = ctx.vehicleId ?? defaultVehicleId;
  const { data: status } = useCurrentVehicleStatus(vehicleId);
  const { data: vehicles } = useVehicles();
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === vehicleId);

  return <CurrentVehicleStatePanel status={status} images={activeVehicle?.images} />;
}

function OverviewStatsWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data: stats, isLoading } = useSummaryStats(ctx.vehicleId);

  return (
    <section className="grid h-full gap-3 md:grid-cols-4">
      <StatCard label="Total Miles" value={isLoading ? '...' : formatMiles(stats?.total_miles ?? 0)} accent className="h-full" />
      <StatCard label="Total Trips" value={isLoading ? '...' : String(stats?.total_trips ?? 0)} className="h-full" />
      <StatCard label="Energy Charged" value={isLoading ? '...' : formatKwh(stats?.total_energy_kwh ?? 0)} className="h-full" />
      <StatCard label="Avg Efficiency" value={isLoading ? '...' : formatEfficiency(stats?.avg_efficiency_wh_mi)} className="h-full" />
    </section>
  );
}

function OverviewChartPickerWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const [chartKey, setChartKey] = useState<OverviewChartKey>('soc');
  const [chartSearch, setChartSearch] = useState('');

  return (
    <ChartShell>
      <ChartPicker value={chartKey} options={OVERVIEW_CHART_OPTIONS} onChange={setChartKey} searchValue={chartSearch} onSearchChange={setChartSearch} />
      <OverviewChart chartKey={chartKey} ctx={ctx} height={300} />
    </ChartShell>
  );
}

function OverviewChart({ chartKey, ctx, height }: { chartKey: OverviewChartKey; ctx: WidgetCtx; height: number }) {
  const { data: soc = [], isFetching: socFetching } = useSocHistory(chartKey === 'soc' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: range = [], isFetching: rangeFetching } = useRangeHistory(chartKey === 'range' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: trend = [], isFetching: trendFetching } = useEfficiencyTrend(chartKey === 'efficiency-trend' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: chargeSummary, isFetching: chargeFetching } = useChargingSummary(chartKey === 'energy' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: sessionsPage, isLoading: sessionsLoading } = useChargeSessions(chartKey === 'charging-sessions' || chartKey === 'charge-level' ? ctx.vehicleId : null, ctx.from, ctx.to, 1, 200);
  const { data: phantom = [], isFetching: phantomFetching } = usePhantomDrain(chartKey === 'phantom' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: degradation = [], isLoading: degradationLoading } = useDegradation(chartKey === 'battery-degradation' ? ctx.vehicleId : null);
  const { data: mileage = [], isLoading: mileageLoading } = useBatteryMileage(chartKey === 'battery-capacity-mileage' || chartKey === 'projected-range-mileage' ? ctx.vehicleId : null);
  const { data: efficiencyByMode = [], isFetching: efficiencyByModeFetching } = useEfficiencyByMode(chartKey === 'efficiency-mode' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: efficiencyByTemp = [], isFetching: efficiencyByTempFetching } = useEfficiencyVsTemp(chartKey === 'efficiency-temperature' ? ctx.vehicleId : null, ctx.from, ctx.to);

  const sessions = sessionsPage?.items ?? [];
  const weekly = chargeSummary?.weekly ?? [];
  const efficiencyUnit = getEfficiencyUnit();

  switch (chartKey) {
    case 'soc':
      return <UPlotSingle data={soc.map((p) => ({ ts: p.ts, value: p.soc ?? null }))} label="Battery Level" unit="%" loading={socFetching} height={height} mode="area" />;
    case 'range':
      return <UPlotSingle data={range.map((p) => ({ ts: p.ts, value: p.range_mi ?? null }))} label="Estimated Range" unit="mi" loading={rangeFetching} height={height} mode="area" />;
    case 'charge-level':
      return <UPlotSingle data={buildChargeLevelSeries(sessions).map((p) => ({ ts: p.ts, value: p.soc }))} label="Charge Level" unit="%" loading={sessionsLoading} height={height} mode="line" />;
    case 'energy':
      return <UPlotSingle data={weekly.map((p) => ({ ts: p.week_start, value: p.energy_kwh ?? null }))} label="Energy Charged" unit="kWh" loading={chargeFetching} height={height} mode="bar" />;
    case 'efficiency-trend':
      return <UPlotSingle data={trend.map((p) => ({ ts: p.day, value: convertEfficiency(p.rolling_7d_wh_mi ?? p.day_avg_wh_mi ?? null) }))} label="Efficiency Trend" unit={efficiencyUnit} loading={trendFetching} height={height} mode="line" />;
    case 'phantom':
      return <UPlotSingle data={phantom.map((p) => ({ ts: p.date, value: p.drain_pct ?? null }))} label="Phantom Drain" unit="%" loading={phantomFetching} height={height} mode="bar" />;
    case 'battery-degradation':
      return <UPlotSingle data={degradation.map((p) => ({ ts: p.ts, value: p.capacity_pct ?? null }))} label="Battery Health" unit="%" loading={degradationLoading} height={height} mode="line" />;
    case 'battery-capacity-mileage':
      return <BatteryCapacityMileageUPlot data={mileage} loading={mileageLoading} height={height} />;
    case 'projected-range-mileage':
      return <ProjectedRangeMileageUPlot data={mileage} loading={mileageLoading} height={height} />;
    case 'charging-sessions':
      return <ChargingSessionsUPlot sessions={sessions} loading={sessionsLoading} height={height} />;
    case 'efficiency-temperature':
      return <EfficiencyTemperatureUPlot data={efficiencyByTemp} loading={efficiencyByTempFetching} height={height} />;
    case 'efficiency-mode':
      return <EfficiencyModeUPlot data={efficiencyByMode} loading={efficiencyByModeFetching} height={height} />;
  }
}

function BatteryPanelWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const navigate = useNavigate();
  const [chartKey, setChartKey] = useState<BatteryChartKey>('capacity-mileage');
  const [chartSearch, setChartSearch] = useState('');
  const { data: currentStatus, isLoading: statusLoading } = useCurrentVehicleStatus(ctx.vehicleId);
  const { data: health, isLoading: healthLoading } = useBatteryHealth(ctx.vehicleId);
  const { data: mileage = [], isLoading: mileageLoading } = useBatteryMileage(ctx.vehicleId);
  const { data: degradation = [], isLoading: degradationLoading } = useDegradation(ctx.vehicleId);

  const remainingRangeNow = currentStatus?.range_miles ?? null;
  const batteryLevelNow = currentStatus?.battery_level ?? null;
  const chargingCycles = health?.charging_cycles ?? health?.charge_count ?? null;
  const maxRangeNow = remainingRangeNow != null && batteryLevelNow != null && batteryLevelNow > 0 ? (remainingRangeNow / batteryLevelNow) * 100 : null;
  const maxRangeNew = maxRangeNow != null && health?.battery_health_pct != null && health.battery_health_pct > 0 ? (maxRangeNow / health.battery_health_pct) * 100 : null;
  const rangeLoading = healthLoading || statusLoading;

  return (
    <section className="h-full space-y-4 overflow-auto">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Battery Health" value={healthLoading ? '...' : formatPercentValue(health?.battery_health_pct)} accent />
        <StatCard label="Estimated Degradation" value={healthLoading ? '...' : formatPercentValue(health?.estimated_degradation_pct)} />
        <ComparisonCard label="Capacity" labelSuffix="now/new" nowValue={formatKwh(health?.usable_now_kwh)} newValue={formatKwh(health?.usable_new_kwh)} loading={healthLoading} onNewClick={() => navigate({ to: '/settings', search: `?section=vehicles&vehicleId=${ctx.vehicleId}` })} />
        <ComparisonCard label="Max Range" labelSuffix="now/new" nowValue={maxRangeNow != null ? `${formatNumber(maxRangeNow, 0)} mi` : '-'} newValue={maxRangeNew != null ? `${formatNumber(maxRangeNew, 0)} mi` : '-'} loading={rangeLoading} onNewClick={() => navigate({ to: '/settings', search: `?section=vehicles&vehicleId=${ctx.vehicleId}` })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Charges" value={healthLoading ? '...' : String(health?.charge_count ?? 0)} />
        <StatCard label="Charging Cycles" value={healthLoading ? '...' : formatStatNumber(chargingCycles, 0)} />
        <StatCard label="Energy Added" value={healthLoading ? '...' : formatKwh(health?.total_energy_added_kwh)} />
        <StatCard label="Charging Efficiency" value={healthLoading ? '...' : formatPercentValue(health?.charging_efficiency_pct)} />
      </div>
      <ChartShell>
        <ChartPicker value={chartKey} options={BATTERY_CHART_OPTIONS} onChange={setChartKey} searchValue={chartSearch} onSearchChange={setChartSearch} />
        {chartKey === 'capacity-mileage' ? (
          <BatteryCapacityMileageUPlot data={mileage} loading={mileageLoading} height={300} />
        ) : chartKey === 'projected-range-mileage' ? (
          <ProjectedRangeMileageUPlot data={mileage} loading={mileageLoading} height={300} />
        ) : (
          <UPlotSingle data={degradation.map((p) => ({ ts: p.ts, value: p.capacity_pct ?? null }))} label="Battery Health" unit="%" loading={degradationLoading} height={300} mode="line" />
        )}
      </ChartShell>
    </section>
  );
}

function ChargingStatsWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data: summary, isLoading } = useChargingSummary(ctx.vehicleId, ctx.from, ctx.to);
  const totalKwh = summary?.total_energy_kwh ?? 0;
  const homeShare = totalKwh > 0 ? ((summary?.home_kwh ?? 0) / totalKwh) * 100 : 0;
  const dcShare = totalKwh > 0 ? ((summary?.dc_kwh ?? 0) / totalKwh) * 100 : 0;

  return (
    <section className="grid h-full gap-3 overflow-auto sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Sessions" value={isLoading ? '...' : String(summary?.session_count ?? 0)} />
      <StatCard label="Total Energy" value={isLoading ? '...' : formatKwh(summary?.total_energy_kwh ?? 0)} accent />
      <StatCard label="Total Cost" value={isLoading ? '...' : formatCurrency(summary?.total_cost_usd ?? 0)} />
      <StatCard label="Avg / Session" value={isLoading ? '...' : summary?.session_count ? formatKwh((summary.total_energy_kwh ?? 0) / summary.session_count) : '-'} />
      <StatCard label="Charging Cycles" value={isLoading ? '...' : formatStatNumber(summary?.charging_cycles, 0)} />
      <StatCard label="Charging Efficiency" value={isLoading ? '...' : formatPercentValue(summary?.charging_efficiency_pct)} />
      <StatCard label="Max Charge Rate" value={isLoading ? '...' : formatKw(summary?.max_charge_rate_kw)} />
      <StatCard label="Max Charge Limit" value={isLoading ? '...' : formatPercentValue(summary?.max_charge_limit_pct)} />
      <StatCard label="Home Charging" value={isLoading ? '...' : `${homeShare.toFixed(0)}%`} detail={`Home ${formatKwh(summary?.home_kwh ?? 0)} / Away ${formatKwh(summary?.away_kwh ?? 0)}`} />
      <StatCard label="DC Share" value={isLoading ? '...' : `${dcShare.toFixed(0)}%`} detail={`AC ${formatKwh(summary?.ac_kwh ?? 0)} / DC ${formatKwh(summary?.dc_kwh ?? 0)}`} />
    </section>
  );
}

function ChargingSessionsBrowserWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chartKey, setChartKey] = useState<ChargingChartKey>('sessions');
  const [chartSearch, setChartSearch] = useState('');
  const { data: sessionsPage, isLoading } = useChargeSessions(ctx.vehicleId, ctx.from, ctx.to, 1, 200);
  const sessions = sessionsPage?.items ?? [];
  const { data: curve, isFetching: curveFetching } = useChargeCurve(selectedId, ctx.vehicleId);
  const selectedSession = sessions.find((s) => s.id === selectedId) ?? null;

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  return (
    <section className="h-full space-y-4 overflow-auto">
      <ChartShell>
        <ChartPicker value={chartKey} options={CHARGING_CHART_OPTIONS} onChange={setChartKey} searchValue={chartSearch} onSearchChange={setChartSearch} />
        {chartKey === 'charge-level' ? (
          <UPlotSingle data={buildChargeLevelSeries(sessions).map((p) => ({ ts: p.ts, value: p.soc }))} label="Charge Level" unit="%" loading={isLoading} height={240} mode="line" />
        ) : (
          <ChargingSessionsUPlot sessions={sessions} selectedId={selectedId} loading={isLoading} height={220} />
        )}
      </ChartShell>
      <ChargingSessionsTable sessions={sessions} selectedId={selectedId} loading={isLoading} onSelect={handleSelect} />
      {selectedSession ? <SelectedSessionDetail session={selectedSession} curve={curve ?? []} curveFetching={curveFetching} /> : null}
    </section>
  );
}

function DrivesSummaryWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useTrips(ctx.vehicleId, ctx.from, ctx.to, 1);
  const trips = data?.items ?? [];
  const totalDistance = trips.reduce((sum, trip) => sum + (trip.distance_mi ?? 0), 0);
  const totalEnergy = trips.reduce((sum, trip) => sum + (trip.energy_used_kwh ?? 0), 0);
  const avgEfficiency = totalDistance > 0 && totalEnergy > 0 ? (totalEnergy * 1000) / totalDistance : null;
  const avgDuration = trips.length > 0 ? trips.reduce((sum, trip) => sum + (trip.duration_min ?? 0), 0) / trips.length : null;

  return (
    <section className="grid h-full gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Trips in Range" value={isLoading ? '...' : String(data?.total ?? 0)} />
      <StatCard label="Distance (Page)" value={isLoading ? '...' : formatMiles(totalDistance)} accent />
      <StatCard label="Avg Efficiency" value={isLoading ? '...' : avgEfficiency === null ? '-' : formatEfficiency(avgEfficiency)} />
      <StatCard label="Avg Duration" value={isLoading ? '...' : avgDuration === null ? '-' : formatDuration(avgDuration)} />
    </section>
  );
}

function EfficiencyPanelWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const [chartKey, setChartKey] = useState<EfficiencyChartKey>('temperature');
  const [chartSearch, setChartSearch] = useState('');
  const { data: trend = [], isFetching: trendFetching } = useEfficiencyTrend(ctx.vehicleId, ctx.from, ctx.to);
  const { data: temp = [], isFetching: tempFetching } = useEfficiencyVsTemp(ctx.vehicleId, ctx.from, ctx.to);
  const { data: tripPage, isFetching: tripsFetching } = useTrips(ctx.vehicleId, ctx.from, ctx.to, 1, 200);
  const drives = tripPage?.items ?? [];
  const loading = trendFetching || tripsFetching || tempFetching;
  const validDays = trend.filter((point) => point.day_avg_wh_mi != null);
  const avgWh = validDays.length ? validDays.reduce((sum, point) => sum + (point.day_avg_wh_mi ?? 0), 0) / validDays.length : null;
  const validRolling = trend.filter((point) => point.rolling_7d_wh_mi != null);
  const latestRolling = validRolling[validRolling.length - 1]?.rolling_7d_wh_mi ?? null;

  return (
    <section className="h-full space-y-3 overflow-auto">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Avg Efficiency (range)" value={loading ? '...' : formatEfficiency(avgWh)} />
        <StatCard label="7-Day Rolling Avg" value={loading ? '...' : formatEfficiency(latestRolling)} />
        <StatCard label="Drives in Range" value={loading ? '...' : String(tripPage?.total ?? drives.length)} />
      </div>
      <ChartShell>
        <ChartPicker value={chartKey} options={EFFICIENCY_CHART_OPTIONS} onChange={setChartKey} searchValue={chartSearch} onSearchChange={setChartSearch} />
        {chartKey === 'temperature' ? (
          <>
            <EfficiencyTemperatureUPlot data={temp} loading={tempFetching} height={300} />
            <TemperatureEfficiencyTable data={temp} loading={tempFetching} />
          </>
        ) : (
          <EfficiencyDrivesUPlot trend={trend} drives={drives} loading={trendFetching || tripsFetching} height={300} />
        )}
      </ChartShell>
    </section>
  );
}

function CurrentVehicleStatePanel({ status, images }: { status: VehicleStatus | null | undefined; images?: VehicleImages | null | undefined }) {
  const batteryLevel = clamp(status?.battery_level ?? 0, 0, 100);
  const baseOverheadLight = images?.overhead?.light ?? findFirstOverheadImage(images?.all, 'light');
  const baseOverheadDark = images?.overhead?.dark ?? findFirstOverheadImage(images?.all, 'dark');
  const baseOverheadFallback = baseOverheadLight ?? baseOverheadDark ?? findFirstOverheadImage(images?.all);
  const openDoorStates = getOpenDoorStates(status);
  const overlaysLight = getDoorOverlayUrls(images?.all, openDoorStates, 'light');
  const overlaysDark = getDoorOverlayUrls(images?.all, openDoorStates, 'dark');
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const [imageStageHeight, setImageStageHeight] = useState(0);
  const [imageStageWidth, setImageStageWidth] = useState(0);
  const locksKnown = [status?.door_front_left_locked, status?.door_front_right_locked, status?.door_rear_left_locked, status?.door_rear_right_locked].some((value) => value !== null && value !== undefined);
  const tires = {
    fl: formatTire(status?.tire_fl_psi, status?.tire_fl_status),
    fr: formatTire(status?.tire_fr_psi, status?.tire_fr_status),
    rl: formatTire(status?.tire_rl_psi, status?.tire_rl_status),
    rr: formatTire(status?.tire_rr_psi, status?.tire_rr_status),
  };
  const stats = [
    { label: 'Driver mode', value: renderDriverMode(status?.drive_mode, status?.gear_status), icon: <Car className="h-3.5 w-3.5" /> },
    { label: 'Altitude', value: formatAltitude(status?.altitude_m), icon: <MapPin className="h-3.5 w-3.5" /> },
    { label: 'Cabin', value: formatTemp(status?.cabin_temp_c), icon: <Thermometer className="h-3.5 w-3.5" /> },
    { label: 'Speed', value: formatMph(status?.speed_mph), icon: <Gauge className="h-3.5 w-3.5" /> },
    { label: 'Software', value: formatSoftware(status), icon: <Cpu className="h-3.5 w-3.5" /> },
  ];

  useEffect(() => {
    const element = imageStageRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      setImageStageHeight(bounds.height);
      setImageStageWidth(bounds.width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="h-full overflow-hidden rounded-2xl border border-border bg-[radial-gradient(circle_at_20%_20%,rgba(253,131,4,0.16),transparent_32%),linear-gradient(135deg,var(--rm-bg-surface),var(--rm-bg-elevated))] p-4 shadow-lg shadow-black/10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-tertiary">Vehicle overview</p>
        <span className="rounded-lg border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-tertiary">
          {status?.last_updated ? `Updated ${new Date(status.last_updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Awaiting telemetry'}
        </span>
      </div>
      <div className="grid h-[calc(100%-2.25rem)] gap-4 xl:grid-cols-[16rem_minmax(22rem,1fr)_18rem]">
        <div className="grid min-h-60 grid-cols-[3.75rem_minmax(0,1fr)] gap-4 rounded-2xl border border-accent/25 bg-accent/10 p-4">
          <div className="relative h-full min-h-48 overflow-hidden rounded-2xl border border-accent/40 bg-bg-surface">
            <div className="absolute inset-x-1 bottom-1 rounded-xl transition-all" style={{ height: `${batteryLevel}%`, background: 'linear-gradient(to top, var(--rm-accent), #10B981)' }} />
            <Battery className="absolute left-1/2 top-3 h-4 w-4 -translate-x-1/2 text-fg/80" />
          </div>
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <div>
              <span className="text-xs uppercase tracking-[0.16em] text-fg-tertiary">SoC</span>
              <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-fg">{formatPercent(status?.battery_level)}</p>
            </div>
            <div className="grid gap-2 text-xs">
              <SocDatum label="Range" value={formatMiles(status?.range_miles)} />
              <SocDatum label="Limit" value={formatPercent(status?.battery_limit)} />
              <SocDatum label="Charging" value={<ChargingGlyph chargerState={status?.charger_state} chargerStatus={status?.charger_status} />} />
              <SocDatum label="Capacity" value={formatKwh(status?.battery_capacity_kwh)} />
            </div>
          </div>
        </div>
        <div ref={imageStageRef} className="relative min-h-60 overflow-hidden rounded-2xl border border-border bg-bg-surface/70 p-1">
          <div className="absolute right-3 top-3 z-30 inline-flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg-tertiary shadow-sm backdrop-blur">
            {status?.doors_locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3 text-accent" />}
            {locksKnown ? (status?.doors_locked ? 'Locked' : 'Unlocked') : 'Locks pending'}
          </div>
          <div className="absolute inset-1 z-10 flex items-center justify-center">
            {baseOverheadFallback ? (
              <VehicleArtFrame source={baseOverheadFallback} heightPx={imageStageHeight} widthPx={imageStageWidth}>
                <VehicleOverheadLayers base={baseOverheadLight ?? baseOverheadFallback} overlays={overlaysLight} darkClassName="dark:hidden" />
                <VehicleOverheadLayers base={baseOverheadDark ?? baseOverheadFallback} overlays={overlaysDark} darkClassName="hidden dark:block" />
                <VehicleLabel className="left-[27%] top-[0%]" value={tires.rl} />
                <VehicleLabel className="left-[82%] top-[0%]" value={tires.fl} />
                <VehicleLabel className="left-[27%] top-[102%]" value={tires.rr} />
                <VehicleLabel className="left-[82%] top-[102%]" value={tires.fr} />
                <LockLabel className="left-[43%] top-[-0%]" locked={status?.door_rear_left_locked} />
                <LockLabel className="left-[60%] top-[-0%]" locked={status?.door_front_left_locked} />
                <LockLabel className="left-[43%] top-[102%]" locked={status?.door_rear_right_locked} />
                <LockLabel className="left-[60%] top-[102%]" locked={status?.door_front_right_locked} />
                <LockLabel className="left-[4%] top-1/2" locked={status?.closure_liftgate_locked ?? status?.closure_tailgate_locked} title="Rear gate lock" />
                <LockLabel className="left-[102%] top-1/2" locked={status?.closure_frunk_locked} title="Frunk lock" />
              </VehicleArtFrame>
            ) : (
              <div className="flex h-28 w-64 items-center justify-center rounded-[2rem] border border-dashed border-border bg-bg-elevated text-fg-tertiary">
                <Car className="h-10 w-10" />
              </div>
            )}
          </div>
        </div>
        <div className="grid gap-2">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/70 px-3 py-2 text-xs">
              <span className="inline-flex items-center gap-2 text-fg-tertiary">{stat.icon}{stat.label}</span>
              <span className="font-mono font-medium tabular-nums text-fg">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ChargingSessionsTable({ sessions, selectedId, loading, onSelect }: { sessions: ChargeSession[]; selectedId: string | null; loading: boolean; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-elevated/70">
      <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">
        All Sessions ({loading ? '...' : sessions.length})
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
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-fg-tertiary">Loading...</td></tr>
            ) : sessions.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-fg-tertiary">No sessions found for this date range.</td></tr>
            ) : (
              sessions.map((session) => <SessionRow key={session.id} session={session} selected={session.id === selectedId} onSelect={onSelect} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SessionRow({ session, selected, onSelect }: { session: ChargeSession; selected: boolean; onSelect: (id: string) => void }) {
  const socRange = session.soc_start != null && session.soc_end != null ? `${Math.round(session.soc_start)}% -> ${Math.round(session.soc_end)}%` : session.soc_end != null ? `-> ${Math.round(session.soc_end)}%` : '-';
  return (
    <tr className={`cursor-pointer border-b border-border/50 transition-colors hover:bg-bg-elevated/50 ${selected ? 'bg-accent/10 outline outline-1 outline-accent/40' : ''}`} onClick={() => onSelect(session.id)}>
      <td className="px-4 py-2 text-fg">{new Date(session.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
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

function SelectedSessionDetail({ session, curve, curveFetching }: { session: ChargeSession; curve: ChargeCurvePoint[]; curveFetching: boolean }) {
  const curveData = curve.map((point) => ({ soc: point.soc_pct, power_kw: point.power_kw }));
  const socRange = session.soc_start != null && session.soc_end != null ? `${Math.round(session.soc_start)}% -> ${Math.round(session.soc_end)}%` : '-';
  return (
    <div className="space-y-4 rounded-xl border border-accent/40 bg-bg-elevated/70 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-fg">Session Detail</div>
        <div className="text-xs text-fg-tertiary">{new Date(session.started_at).toLocaleString()}{session.ended_at ? ` - ${new Date(session.ended_at).toLocaleTimeString()}` : ''}</div>
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
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">Charge Curve - Power vs State of Charge</div>
        {curveData.length === 0 && !curveFetching ? (
          <div className="rounded-lg border border-border bg-bg/50 p-4 text-sm text-fg-tertiary">No charge curve telemetry available for this session.</div>
        ) : (
          <ChargeCurveChart data={curveData} loading={curveFetching} height={200} />
        )}
      </div>
    </div>
  );
}

function TemperatureEfficiencyTable({ data, loading }: { data: Array<{ temp_c_low: number; temp_c_high: number; avg_efficiency_wh_mi: number | null; trip_count: number }>; loading: boolean }) {
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
            <tr><td colSpan={3} className="px-3 py-5 text-center text-fg-tertiary">Loading...</td></tr>
          ) : data.length === 0 ? (
            <tr><td colSpan={3} className="px-3 py-5 text-center text-fg-tertiary">No outside-temperature telemetry is available for this range yet.</td></tr>
          ) : (
            data.map((row) => (
              <tr key={`${row.temp_c_low}-${row.temp_c_high}`} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2 text-fg">{formatTemp(row.temp_c_low)} - {formatTemp(row.temp_c_high)}</td>
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

function UPlotSingle({ data, label, unit, loading, height, mode }: { data: Array<{ ts: string; value: number | null }>; label: string; unit: string; loading: boolean; height: number; mode: 'line' | 'area' | 'bar' }) {
  return (
    <RichTimeSeriesChart
      points={data.map((point) => ({ ts: point.ts }))}
      series={[{ key: 'value', label, values: data.map((point) => point.value) }]}
      loading={loading}
      height={height}
      yUnit={unit}
      mode={mode}
    />
  );
}

function BatteryCapacityMileageUPlot({ data, loading, height }: { data: Array<{ odometer_mi?: number | null; usable_kwh?: number | null }>; loading: boolean; height: number }) {
  const points = data
    .filter((point) => point.odometer_mi != null && point.usable_kwh != null)
    .map((point) => ({ x: point.odometer_mi ?? 0, y: point.usable_kwh ?? null }));
  return (
    <RichTimeSeriesChart
      points={points.map((point) => ({ ts: point.x }))}
      series={[{ key: 'usable_kwh', label: 'Battery capacity', values: points.map((point) => point.y) }]}
      loading={loading}
      emptyTitle="No battery capacity data recorded yet"
      height={height}
      xTime={false}
      xUnit="mi"
      yUnit="kWh"
      mode="scatter"
      xValueFormatter={(value) => formatMiles(value).replace(/\s.*/, '')}
    />
  );
}

function ProjectedRangeMileageUPlot({ data, loading, height }: { data: Array<{ odometer_mi?: number | null; range_mi?: number | null }>; loading: boolean; height: number }) {
  const points = data
    .filter((point) => point.odometer_mi != null && point.range_mi != null)
    .map((point) => ({ x: point.odometer_mi ?? 0, y: point.range_mi ?? null }));
  return (
    <RichTimeSeriesChart
      points={points.map((point) => ({ ts: point.x }))}
      series={[{ key: 'range_mi', label: 'Projected range', values: points.map((point) => point.y) }]}
      loading={loading}
      emptyTitle="No range data recorded yet"
      height={height}
      xTime={false}
      xUnit="mi"
      yUnit="mi"
      mode="line"
      xValueFormatter={(value) => formatMiles(value).replace(/\s.*/, '')}
    />
  );
}

function ChargingSessionsUPlot({ sessions, selectedId, loading, height }: { sessions: ChargeSession[]; selectedId?: string | null; loading: boolean; height: number }) {
  const sorted = [...sessions].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  const selectedValues = sorted.map((session) => session.id === selectedId ? session.energy_added_kwh ?? null : null);
  return (
    <div>
      <RichTimeSeriesChart
        points={sorted.map((session) => ({ ts: session.started_at }))}
        series={[
          { key: 'energy', label: 'Energy', values: sorted.map((session) => session.energy_added_kwh ?? null) },
          { key: 'selected', label: 'Selected', color: '#ffffff', values: selectedValues },
        ]}
        loading={loading}
        height={height}
        yUnit="kWh"
        mode="bar"
      />
      <div className="mt-1 flex items-center gap-4 text-[10px] text-fg-tertiary">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#38bdf8]" />Energy</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-white" />Selected</span>
      </div>
    </div>
  );
}

function EfficiencyTemperatureUPlot({ data, loading, height }: { data: Array<{ temp_c_low: number; temp_c_high: number; avg_efficiency_wh_mi: number | null }>; loading: boolean; height: number }) {
  const points = data
    .filter((point) => point.avg_efficiency_wh_mi != null)
    .map((point) => ({
      x: (point.temp_c_low + point.temp_c_high) / 2,
      y: convertEfficiency(point.avg_efficiency_wh_mi),
    }));
  return (
    <RichTimeSeriesChart
      points={points.map((point) => ({ ts: point.x }))}
      series={[{ key: 'efficiency', label: 'Avg Efficiency', values: points.map((point) => point.y) }]}
      loading={loading}
      emptyTitle="No outside-temperature telemetry is available for this range yet."
      height={height}
      xTime={false}
      xUnit={getUnitSystem() === 'metric' ? 'C' : 'F'}
      yUnit={getEfficiencyUnit()}
      mode="scatter"
      xValueFormatter={(value) => formatTemp(value)}
    />
  );
}

function EfficiencyModeUPlot({ data, loading, height }: { data: Array<{ drive_mode: string; avg_efficiency: number | null }>; loading: boolean; height: number }) {
  const rows = data.filter((point) => point.avg_efficiency != null);
  return (
    <RichTimeSeriesChart
      points={rows.map((_, index) => ({ ts: index + 1 }))}
      series={[{ key: 'efficiency', label: 'Avg Efficiency', values: rows.map((point) => convertEfficiency(point.avg_efficiency)) }]}
      loading={loading}
      emptyTitle="No drive mode efficiency data for this range."
      height={height}
      xTime={false}
      yUnit={getEfficiencyUnit()}
      mode="bar"
      xValueFormatter={(value) => rows[Math.round(value) - 1]?.drive_mode ?? ''}
    />
  );
}

function EfficiencyDrivesUPlot({ trend, drives, loading, height }: { trend: Array<{ day: string; rolling_7d_wh_mi: number | null }>; drives: Array<{ started_at: string; efficiency_wh_mi?: number | null }>; loading: boolean; height: number }) {
  const rolling = trend.filter((point) => point.rolling_7d_wh_mi != null);
  const drivePoints = drives.filter((drive) => drive.efficiency_wh_mi != null);
  const xValues = [...rolling.map((point) => point.day), ...drivePoints.map((drive) => drive.started_at)]
    .map((value) => new Date(value).getTime())
    .sort((a, b) => a - b);
  const points = Array.from(new Set(xValues)).map((value) => new Date(value).toISOString());
  const indexByTs = new Map(points.map((point, index) => [new Date(point).getTime(), index]));
  const rollingValues = points.map(() => null as number | null);
  const driveValues = points.map(() => null as number | null);

  rolling.forEach((point) => {
    const index = indexByTs.get(new Date(point.day).getTime());
    if (index != null) rollingValues[index] = convertEfficiency(point.rolling_7d_wh_mi);
  });
  drivePoints.forEach((drive) => {
    const index = indexByTs.get(new Date(drive.started_at).getTime());
    if (index != null) driveValues[index] = convertEfficiency(drive.efficiency_wh_mi);
  });

  return (
    <RichTimeSeriesChart
      points={points.map((point) => ({ ts: point }))}
      series={[
        { key: 'rolling', label: '7-day avg', values: rollingValues, mode: 'line' },
        { key: 'drives', label: 'Drives', values: driveValues, mode: 'scatter' },
      ]}
      loading={loading}
      emptyTitle="No drive data for this range."
      height={height}
      yUnit={getEfficiencyUnit()}
      mode="line"
    />
  );
}

function ChartShell({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border bg-bg-elevated/70 p-4">{children}</div>;
}

function ComparisonCard({ label, labelSuffix, nowValue, newValue, onNewClick, loading = false }: { label: string; labelSuffix: string; nowValue: string; newValue: string; onNewClick: () => void; loading?: boolean }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-tertiary">{label}<span className="ml-1 text-[10px] font-normal leading-none">({labelSuffix})</span></p>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-fg">{loading ? '...' : nowValue}</span>
        <button onClick={onNewClick} disabled={loading} className="font-mono text-sm tabular-nums text-fg-tertiary transition-colors hover:text-fg-secondary hover:underline disabled:opacity-50">
          {loading ? '...' : `/${newValue}`}
        </button>
      </div>
    </Card>
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

function SocDatum({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-accent/15 bg-bg-surface/55 px-2.5 py-1.5">
      <span className="text-fg-tertiary">{label}</span>
      <span className="min-w-0 truncate font-mono font-medium tabular-nums text-fg">{value}</span>
    </div>
  );
}

function ChargingGlyph({ chargerState, chargerStatus }: { chargerState: string | null | undefined; chargerStatus: string | null | undefined }) {
  const charging = chargerState && !['unknown', 'disconnected'].includes(chargerState.toLowerCase()) && chargerStatus !== 'chrgr_sts_not_connected';
  const Icon = charging ? PlugZap : Unplug;
  return <span aria-label={charging ? 'Charging' : 'Not charging'} title={charging ? 'Charging' : 'Not charging'} className={`inline-flex items-center justify-end ${charging ? 'text-accent' : 'text-fg-tertiary'}`}><Icon className="h-5 w-5" /></span>;
}

function VehicleLabel({ className, value }: { className: string; value: string }) {
  return <span className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-elevated/90 px-2 py-1 font-mono text-[11px] text-fg shadow-sm backdrop-blur ${className}`}>{value}</span>;
}

function LockLabel({ className, locked, title }: { className: string; locked: boolean | null | undefined; title?: string }) {
  const known = locked !== null && locked !== undefined;
  const unlocked = known && locked === false;
  const Icon = unlocked ? Unlock : Lock;
  return (
    <span
      title={title}
      className={`absolute z-30 inline-flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm backdrop-blur ${unlocked ? 'border-accent/60 bg-bg-elevated/90 text-accent' : known ? 'border-border bg-bg-elevated/90 text-fg' : 'border-border bg-bg-elevated/60 text-fg-tertiary'} ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function VehicleArtFrame({ source, heightPx, widthPx, children }: { source: string; heightPx: number; widthPx: number; children: React.ReactNode }) {
  const [rotatedAspectRatio, setRotatedAspectRatio] = useState(2.25);
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) setRotatedAspectRatio(image.naturalHeight / image.naturalWidth);
    };
    image.src = source;
  }, [source]);
  const maxHeight = heightPx > 0 ? Math.max(120, (heightPx - 34) / 1.12) : 216;
  const maxWidth = widthPx > 0 ? Math.max(260, (widthPx - 34) / 1.04) : 520;
  const frameHeight = Math.round(Math.min(maxHeight, maxWidth / rotatedAspectRatio));
  const frameWidth = Math.round(frameHeight * rotatedAspectRatio);
  return <div className="relative" style={{ height: frameHeight, width: frameWidth, transform: 'translateX(-5%)', '--vehicle-frame-height': `${frameHeight}px`, '--vehicle-frame-width': `${frameWidth}px` } as React.CSSProperties}>{children}</div>;
}

function VehicleOverheadLayers({ base, overlays, darkClassName }: { base: string; overlays: string[]; darkClassName: string }) {
  const imageStyle = { height: 'var(--vehicle-frame-width)', width: 'var(--vehicle-frame-height)', transform: 'translate(-50%, -50%) rotate(90deg)' } as React.CSSProperties;
  return (
    <div className={`absolute inset-0 ${darkClassName}`}>
      <img src={base} alt="" className="absolute left-1/2 top-1/2 max-w-none object-contain object-center" style={imageStyle} />
      {overlays.map((overlayUrl) => <img key={overlayUrl} src={overlayUrl} alt="" className="absolute left-1/2 top-1/2 max-w-none object-contain object-center" style={imageStyle} />)}
    </div>
  );
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

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value)}%`;
}

function formatPercentValue(value: number | null | undefined) {
  return value == null ? '-' : `${formatNumber(value, 1)}%`;
}

function getEfficiencyUnit() {
  const isMetric = getUnitSystem() === 'metric';
  const display = getEfficiencyDisplay();
  return display === 'energy_per_distance'
    ? isMetric ? 'Wh/km' : 'Wh/mi'
    : isMetric ? 'km/kWh' : 'mi/kWh';
}

function convertEfficiency(value: number | null | undefined) {
  if (value == null) return null;
  const isMetric = getUnitSystem() === 'metric';
  const display = getEfficiencyDisplay();
  if (display === 'energy_per_distance') {
    return isMetric ? whPerMileToWhPerKm(value) : value;
  }
  return isMetric ? whPerMileToKmPerKwh(value) : whPerMileToMiPerKwh(value);
}

function formatStatNumber(value: number | null | undefined, decimals = 1) {
  return value == null ? '-' : formatNumber(value, decimals);
}

function formatKw(value: number | null | undefined) {
  return value == null ? '-' : `${formatNumber(value, 1)} kW`;
}

function formatChargerType(value: string | null | undefined) {
  if (!value) return '-';
  if (value === 'ac_l2') return 'AC L2';
  return value.toUpperCase();
}

function formatTire(psi: number | null | undefined, status?: string | null) {
  if (psi !== null && psi !== undefined) return formatPressure(psi);
  return status ? prettify(status) : '-';
}

function renderDriverMode(driveMode: string | null | undefined, gearStatus: string | null | undefined) {
  const value = driveMode ? prettifyDriveMode(driveMode) : gearStatus ? prettify(gearStatus) : '-';
  if (value === 'Unknown') {
    return (
      <Tooltip content="Current sensor status is unknown." align="end">
        <span className="inline-flex items-center justify-end text-fg-tertiary">Pending</span>
      </Tooltip>
    );
  }
  return value;
}

function formatSoftware(status: VehicleStatus | null | undefined) {
  const otaStatus = status?.ota_status ?? status?.software_update_status ?? status?.ota_current_status;
  const available = status?.ota_available_version;
  const current = status?.ota_current_version;
  if (!otaStatus && !available && !current) return '-';
  if (!available || available === '0.0.0' || available === current) return 'Up to date';
  if (otaStatus && !['idle', 'unknown'].includes(otaStatus.toLowerCase())) return prettify(otaStatus);
  return `Available ${available}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function prettifyDriveMode(value: string) {
  const map: Record<string, string> = {
    everyday: 'All-Purpose',
    all_purpose: 'All-Purpose',
    sport: 'Sport',
    distance: 'Conserve',
    conserve: 'Conserve',
    winter: 'Snow',
    towing: 'Towing',
    off_road_auto: 'All-Terrain',
    off_road_sand: 'Soft Sand',
    off_road_rocks: 'Rock Crawl',
    off_road_sport_auto: 'Rally',
    off_road_sport_drift: 'Drift',
  };
  return map[value] ?? prettify(value);
}

function prettify(value: string | null | undefined) {
  if (!value) return '-';
  return value.replace(/^chrgr_sts_/, '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

type DoorKey = 'front_left' | 'front_right' | 'rear_left' | 'rear_right' | 'frunk' | 'rear_gate';

function getOpenDoorStates(status: VehicleStatus | null | undefined): DoorKey[] {
  const states: Array<{ key: DoorKey; open: boolean }> = [
    { key: 'front_left', open: status?.door_front_left_closed === false },
    { key: 'front_right', open: status?.door_front_right_closed === false },
    { key: 'rear_left', open: status?.door_rear_left_closed === false },
    { key: 'rear_right', open: status?.door_rear_right_closed === false },
    { key: 'frunk', open: status?.closure_frunk_closed === false },
    { key: 'rear_gate', open: status?.closure_liftgate_closed === false || status?.closure_tailgate_closed === false },
  ];
  return states.filter((state) => state.open).map((state) => state.key);
}

function getDoorOverlayUrls(images: VehicleImages['all'] | undefined, openDoors: DoorKey[], designPreference: 'light' | 'dark'): string[] {
  if (!images || openDoors.length === 0) return [];
  const overheadImages = images.filter((image) => normalizePlacement(image.placement) === 'overhead');
  const urls = openDoors.map((door) => findBestDoorOverlay(overheadImages, door, designPreference)).filter((url): url is string => Boolean(url));
  return Array.from(new Set(urls));
}

function findBestDoorOverlay(images: VehicleImages['all'], door: DoorKey, designPreference: 'light' | 'dark'): string | undefined {
  const tokenSets = doorImageTokenSets(door);
  for (const tokens of tokenSets) {
    const preferred = images.find((image) => designMatches(image.design, designPreference) && tokens.every((token) => imageText(image).includes(token)));
    if (preferred?.url) return preferred.url;
  }
  for (const tokens of tokenSets) {
    const fallback = images.find((image) => tokens.every((token) => imageText(image).includes(token)));
    if (fallback?.url) return fallback.url;
  }
  return undefined;
}

function doorImageTokenSets(door: DoorKey): string[][] {
  switch (door) {
    case 'front_left':
      return [['front', 'left', 'open']];
    case 'front_right':
      return [['front', 'right', 'open']];
    case 'rear_left':
      return [['rear', 'left', 'open']];
    case 'rear_right':
      return [['rear', 'right', 'open']];
    case 'frunk':
      return [['frunk', 'open']];
    case 'rear_gate':
      return [['tailgate', 'open'], ['liftgate', 'open'], ['hatch', 'open']];
    default:
      return [['open']];
  }
}

function findFirstOverheadImage(images: VehicleImages['all'] | undefined, design?: 'light' | 'dark'): string | undefined {
  if (!images) return undefined;
  if (design) {
    const preferred = images.find((image) => normalizePlacement(image.placement) === 'overhead' && designMatches(image.design, design));
    if (preferred?.url) return preferred.url;
  }
  return images.find((image) => normalizePlacement(image.placement) === 'overhead')?.url;
}

function normalizePlacement(value: string | null | undefined): 'side' | 'overhead' | 'front' | 'rear' | 'unknown' {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.includes('side')) return 'side';
  if (normalized.includes('overhead') || normalized.includes('top') || normalized.includes('bird')) return 'overhead';
  if (normalized.includes('front')) return 'front';
  if (normalized.includes('rear') || normalized.includes('back')) return 'rear';
  return 'unknown';
}

function designMatches(value: string | null | undefined, expected: 'light' | 'dark') {
  return (value ?? '').toLowerCase().includes(expected);
}

function imageText(image: VehicleImages['all'][number]) {
  return `${image.placement ?? ''} ${image.design ?? ''} ${JSON.stringify(image.metadata ?? {})}`.toLowerCase();
}

registerWidget({ id: 'custom.overview_vehicle', category: 'custom', title: 'Vehicle Overview', defaultSize: { w: 12, h: 4 }, minSize: { w: 8, h: 3 }, editMode: 'json', component: OverviewVehicleWidget });
registerWidget({ id: 'custom.overview_stats', category: 'custom', title: 'Overview Stats', defaultSize: { w: 12, h: 2 }, minSize: { w: 6, h: 1 }, editMode: 'json', component: OverviewStatsWidget });
registerWidget({ id: 'custom.overview_chart_picker', category: 'custom', title: 'Overview Chart Picker', defaultSize: { w: 12, h: 5 }, minSize: { w: 6, h: 4 }, editMode: 'json', component: OverviewChartPickerWidget });
registerWidget({ id: 'custom.battery_panel', category: 'custom', title: 'Battery Panel', defaultSize: { w: 12, h: 8 }, minSize: { w: 8, h: 5 }, editMode: 'json', component: BatteryPanelWidget });
registerWidget({ id: 'custom.charging_stats', category: 'custom', title: 'Charging Stats', defaultSize: { w: 12, h: 3 }, minSize: { w: 8, h: 2 }, editMode: 'json', component: ChargingStatsWidget });
registerWidget({ id: 'custom.charging_browser', category: 'custom', title: 'Charging Chart and Sessions', defaultSize: { w: 12, h: 9 }, minSize: { w: 8, h: 5 }, editMode: 'json', component: ChargingSessionsBrowserWidget });
registerWidget({ id: 'custom.drives_summary', category: 'custom', title: 'Drives Summary', defaultSize: { w: 12, h: 2 }, minSize: { w: 6, h: 1 }, editMode: 'json', component: DrivesSummaryWidget });
registerWidget({ id: 'custom.efficiency_panel', category: 'custom', title: 'Efficiency Panel', defaultSize: { w: 12, h: 7 }, minSize: { w: 8, h: 5 }, editMode: 'json', component: EfficiencyPanelWidget });
