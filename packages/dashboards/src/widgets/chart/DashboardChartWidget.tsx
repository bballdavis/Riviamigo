import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  useBatteryMileage,
  useChargeSessions,
  useChargingSummary,
  useDegradation,
  useEfficiencyByMode,
  useEfficiencyTrend,
  useEfficiencyVsTemp,
  usePhantomDrain,
  useRangeHistory,
  useSocHistory,
} from '@riviamigo/hooks';
import { RichTimeSeriesChart } from '@riviamigo/ui/charts';
import { ChartPicker } from '@riviamigo/ui/primitives';
import { cn } from '@riviamigo/ui/lib/utils';
import {
  formatMiles,
  formatTemp,
  getEfficiencyDisplay,
  getUnitSystem,
  whPerMileToKmPerKwh,
  whPerMileToMiPerKwh,
  whPerMileToWhPerKm,
} from '@riviamigo/ui/lib/utils';
import type { ChargeSession } from '@riviamigo/types';
import {
  getChartDefinition,
  getChartDefinitions,
  getChartOptions,
  type DashboardChartDefinition,
  type DashboardChartPage,
} from '../../charts/catalog';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';
import { useMeasuredWidgetHeight } from '../useMeasuredWidgetHeight';

interface DashboardChartOptions {
  chartId?: string;
  chartIds?: string[];
  page?: DashboardChartPage;
  showPicker?: boolean;
}

interface ResolvedDashboardChartOptions {
  chartId: string;
  chartIds: string[];
  page?: DashboardChartPage;
  showPicker: boolean;
}

function readOptions(instance: WidgetInstance): ResolvedDashboardChartOptions {
  const options = (instance.options ?? {}) as DashboardChartOptions;
  const page = isDashboardChartPage(options.page) ? options.page : undefined;
  const pageDefinitions = getChartDefinitions(page);
  const validIds = new Set(pageDefinitions.map((definition) => definition.id));
  const chartIds = Array.isArray(options.chartIds)
    ? options.chartIds.filter((id): id is string => typeof id === 'string' && validIds.has(id))
    : [];
  const fallbackIds = chartIds.length > 0 ? chartIds : pageDefinitions.map((definition) => definition.id);
  const fallbackChartId = fallbackIds[0] ?? getChartDefinitions()[0]?.id ?? 'soc-history';
  const chartId = typeof options.chartId === 'string' && validIds.has(options.chartId)
    ? options.chartId
    : fallbackChartId;

  return {
    chartId,
    chartIds: fallbackIds,
    showPicker: options.showPicker ?? fallbackIds.length > 1,
    ...(page ? { page } : {}),
  };
}

const DEFAULT_SMOOTHING = 0.4;

export function DashboardChartWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const options = readOptions(instance);
  const chartOptions = getChartOptions(options.page).filter((option) => options.chartIds.includes(option.value));
  const [chartId, setChartId] = React.useState(options.chartId);
  const [search, setSearch] = React.useState('');
  // smoothing: 0 = off, >0 = smoothing amount (0–1)
  const [smoothing, setSmoothing] = React.useState(DEFAULT_SMOOTHING);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settingsRef = React.useRef<HTMLDivElement>(null);
  const { ref, height } = useMeasuredWidgetHeight(260, 160);

  const smoothingOn = smoothing > 0;

  React.useEffect(() => {
    if (!options.chartIds.includes(chartId)) {
      setChartId(options.chartId);
    }
  }, [chartId, options.chartId, options.chartIds]);

  React.useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const activeChartId = options.chartIds.includes(chartId) ? chartId : options.chartId;

  const settingsButton = (
    <div ref={settingsRef} className="relative">
      <button
        type="button"
        aria-label="Chart settings"
        onClick={() => setSettingsOpen((v) => !v)}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-surface text-fg-tertiary transition-colors',
          'hover:border-border-strong hover:text-fg focus:outline-none focus:ring-1 focus:ring-accent',
          settingsOpen && 'border-accent text-accent',
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      {settingsOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.375rem)] z-50 w-52 rounded-lg border border-border bg-bg-surface p-3 shadow-lg">
          {/* Smooth curves toggle row */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-fg">Smooth curves</span>
            {/* Toggle — fixed sizing so thumb fits exactly */}
            <button
              type="button"
              role="switch"
              aria-checked={smoothingOn}
              onClick={() => setSmoothing((v) => v > 0 ? 0 : DEFAULT_SMOOTHING)}
              className={cn(
                'relative inline-flex h-[22px] w-[42px] shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                'transition-colors duration-200 ease-in-out',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                smoothingOn ? 'bg-accent' : 'bg-border-strong',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm',
                  'transition-transform duration-200 ease-in-out',
                  smoothingOn ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </button>
          </div>
          {/* Smoothing amount slider — only shown when on */}
          {smoothingOn ? (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs text-fg-tertiary">Amount</span>
                <span className="text-xs text-fg-tertiary">
                  {smoothing < 0.25 ? 'Light' : smoothing < 0.6 ? 'Medium' : 'Heavy'}
                </span>
              </div>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={smoothing}
                onChange={(e) => setSmoothing(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border-strong accent-accent"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {options.showPicker && chartOptions.length > 1 ? (
        <ChartPicker
          value={activeChartId}
          options={chartOptions}
          onChange={setChartId}
          searchValue={search}
          onSearchChange={setSearch}
          className="shrink-0"
          trailing={settingsButton}
        />
      ) : null}
      <div ref={ref} className="min-h-0 flex-1">
        <DashboardChartRenderer chartId={activeChartId} ctx={ctx} height={height} smoothing={smoothing} />
      </div>
    </div>
  );
}

export function DashboardChartRenderer({ chartId, ctx, height, smoothing = 0 }: { chartId: string; ctx: WidgetCtx; height: number; smoothing?: number }) {
  const definition = getChartDefinition(chartId);
  const source = definition?.source;
  const needsSoc = source === 'soc_history';
  const { data: soc = [], isLoading: socLoading } = useSocHistory(needsSoc ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: range = [], isLoading: rangeLoading } = useRangeHistory(source === 'range_history' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: chargeSummary, isLoading: chargeSummaryLoading } = useChargingSummary(source === 'charging_weekly_energy' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: sessionsPage, isLoading: sessionsLoading } = useChargeSessions(
    source === 'charging_sessions_energy' ? ctx.vehicleId : null,
    ctx.from,
    ctx.to,
    1,
    200,
  );
  const { data: trend = [], isLoading: trendLoading } = useEfficiencyTrend(source === 'efficiency_trend' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: efficiencyByMode = [], isLoading: efficiencyByModeLoading } = useEfficiencyByMode(source === 'efficiency_mode' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: efficiencyByTemp = [], isLoading: efficiencyByTempLoading } = useEfficiencyVsTemp(source === 'efficiency_temperature' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: phantom = [], isLoading: phantomLoading } = usePhantomDrain(source === 'phantom_drain' ? ctx.vehicleId : null, ctx.from, ctx.to);
  const { data: degradation = [], isLoading: degradationLoading } = useDegradation(source === 'battery_degradation' ? ctx.vehicleId : null);
  const { data: mileage = [], isLoading: mileageLoading } = useBatteryMileage(
    source === 'battery_capacity_mileage' || source === 'projected_range_mileage' ? ctx.vehicleId : null,
  );

  if (!definition) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary">
        Unknown chart: {chartId}
      </div>
    );
  }

  const sessions = sessionsPage?.items ?? [];
  const weekly = chargeSummary?.weekly ?? [];

  switch (definition.source) {
    case 'soc_history':
      return renderSingleChart(definition, height, socLoading, soc.map((point) => ({ ts: point.ts, value: point.value })), smoothing);
    case 'range_history':
      return renderSingleChart(definition, height, rangeLoading, range.map((point) => ({ ts: point.ts, value: point.value })), smoothing);
    case 'charging_sessions_energy':
      return (
        <ChargingSessionsChart
          definition={definition}
          sessions={sessions}
          loading={sessionsLoading}
          height={height}
          smoothing={smoothing}
        />
      );
    case 'charging_weekly_energy':
      return (
        <WeeklyEnergyChart
          definition={definition}
          weekly={weekly}
          loading={chargeSummaryLoading}
          height={height}
        />
      );
    case 'efficiency_trend':
      return <EfficiencyTrendChart definition={definition} trend={trend} loading={trendLoading} height={height} smoothing={smoothing} />;
    case 'efficiency_temperature':
      return <EfficiencyTemperatureChart definition={definition} data={efficiencyByTemp} loading={efficiencyByTempLoading} height={height} />;
    case 'efficiency_mode':
      return <EfficiencyModeChart definition={definition} data={efficiencyByMode} loading={efficiencyByModeLoading} height={height} />;
    case 'phantom_drain':
      return renderSingleChart(definition, height, phantomLoading, phantom.map((point) => ({ ts: point.day, value: point.total_soc_lost })), smoothing);
    case 'battery_degradation':
      return renderSingleChart(definition, height, degradationLoading, degradation.map((point) => ({ ts: point.ts, value: point.capacity_pct ?? null })), smoothing);
    case 'battery_capacity_mileage':
      return (
        <MileageChart
          definition={definition}
          loading={mileageLoading}
          height={height}
          points={mileage.map((point) => ({ x: point.odometer_mi, y: point.usable_kwh }))}
          smoothing={smoothing}
        />
      );
    case 'projected_range_mileage':
      return (
        <MileageChart
          definition={definition}
          loading={mileageLoading}
          height={height}
          points={mileage.map((point) => ({ x: point.odometer_mi, y: point.range_mi }))}
          smoothing={smoothing}
        />
      );
  }
}

function renderSingleChart(
  definition: DashboardChartDefinition,
  height: number,
  loading: boolean,
  data: Array<{ ts: string; value: number | null }>,
  smoothing = 0,
) {
  return (
    <RichTimeSeriesChart
      points={data.map((point) => ({ ts: point.ts }))}
      series={[{ key: definition.id, label: definition.title, values: data.map((point) => point.value) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      yRange={definition.yRange}
      stepInterpolation={definition.stepInterpolation}
      mode={definition.mode}
      smoothing={definition.stepInterpolation ? 0 : smoothing}
    />
  );
}

function ChargingSessionsChart({
  definition,
  sessions,
  loading,
  height,
  smoothing,
}: {
  definition: DashboardChartDefinition;
  sessions: ChargeSession[];
  loading: boolean;
  height: number;
  smoothing?: number;
}) {
  const sorted = [...sessions].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  return (
    <RichTimeSeriesChart
      points={sorted.map((session) => ({ ts: session.started_at }))}
      series={[{ key: 'energy', label: 'Energy Added', values: sorted.map((session) => session.energy_added_kwh ?? null) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      mode={definition.mode}
      smoothing={0}
    />
  );
}

function WeeklyEnergyChart({
  definition,
  weekly,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  weekly: Array<{ week_start: string; energy_kwh: number | null }>;
  loading: boolean;
  height: number;
}) {
  const formatWeekLabel = (seconds: number) => {
    const d = new Date(seconds * 1000);
    return d.toLocaleString([], { month: 'short', day: 'numeric' });
  };

  return (
    <RichTimeSeriesChart
      points={weekly.map((point) => ({ ts: point.week_start }))}
      series={[{ key: 'energy', label: 'Energy Charged', values: weekly.map((point) => point.energy_kwh ?? null) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      mode="bar"
      xValueFormatter={formatWeekLabel}
      smoothing={0}
    />
  );
}

function EfficiencyTrendChart({
  definition,
  trend,
  loading,
  height,
  smoothing,
}: {
  definition: DashboardChartDefinition;
  trend: Array<{ day: string; day_avg_wh_mi: number | null; rolling_7d_wh_mi: number | null }>;
  loading: boolean;
  height: number;
  smoothing?: number;
}) {
  const unit = getEfficiencyUnit();
  return (
    <RichTimeSeriesChart
      points={trend.map((point) => ({ ts: point.day }))}
      series={[
        { key: 'daily', label: 'Daily', values: trend.map((point) => convertEfficiency(point.day_avg_wh_mi)) },
        { key: 'rolling', label: '7-day avg', values: trend.map((point) => convertEfficiency(point.rolling_7d_wh_mi)) },
      ]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={unit}
      mode={definition.mode}
      smoothing={smoothing}
    />
  );
}

function EfficiencyTemperatureChart({
  definition,
  data,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  data: Array<{ temp_c_low: number; temp_c_high: number; avg_efficiency_wh_mi: number | null }>;
  loading: boolean;
  height: number;
}) {
  const points = data
    .filter((point) => point.avg_efficiency_wh_mi != null)
    .map((point) => ({
      x: (point.temp_c_low + point.temp_c_high) / 2,
      y: convertEfficiency(point.avg_efficiency_wh_mi),
    }));

  return (
    <RichTimeSeriesChart
      points={points.map((point) => ({ ts: point.x }))}
      series={[{ key: 'efficiency', label: definition.title, values: points.map((point) => point.y) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={false}
      xUnit={getUnitSystem() === 'metric' ? 'C' : 'F'}
      yUnit={getEfficiencyUnit()}
      mode="scatter"
      xValueFormatter={(value) => formatTemp(value)}
      smoothing={0}
    />
  );
}

function EfficiencyModeChart({
  definition,
  data,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  data: Array<{ drive_mode: string; avg_efficiency: number | null }>;
  loading: boolean;
  height: number;
}) {
  const rows = data.filter((point) => point.avg_efficiency != null);
  const splits = rows.map((_, index) => index + 1);

  return (
    <RichTimeSeriesChart
      points={rows.map((_, index) => ({ ts: index + 1 }))}
      series={[{ key: 'efficiency', label: 'Avg Efficiency', values: rows.map((point) => convertEfficiency(point.avg_efficiency)) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={false}
      yUnit={getEfficiencyUnit()}
      mode="bar"
      xSplits={splits}
      xValueFormatter={(value) => rows[Math.round(value) - 1]?.drive_mode ?? ''}
      smoothing={0}
    />
  );
}

function MileageChart({
  definition,
  points,
  loading,
  height,
  smoothing,
}: {
  definition: DashboardChartDefinition;
  points: Array<{ x: number | null; y: number | null }>;
  loading: boolean;
  height: number;
  smoothing?: number;
}) {
  const rows = points
    .filter((point): point is { x: number; y: number } => point.x != null && point.y != null)
    .sort((a, b) => a.x - b.x);

  return (
    <RichTimeSeriesChart
      points={rows.map((point) => ({ ts: point.x }))}
      series={[{ key: definition.id, label: definition.title, values: rows.map((point) => point.y) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={false}
      xUnit="mi"
      yUnit={definition.yUnit}
      yRange={definition.yRange}
      mode={definition.mode}
      xValueFormatter={(value) => formatMiles(value).replace(/\s.*/, '')}
      smoothing={smoothing}
    />
  );
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

function isDashboardChartPage(value: unknown): value is DashboardChartPage {
  return value === 'overview' || value === 'battery' || value === 'charging' || value === 'efficiency' || value === 'trips';
}

registerWidget({
  componentType: 'chart',
  definitionId: 'catalog',
  title: 'Chart',
  defaultSize: { w: 12, h: 8 },
  minSize: { w: 4, h: 6 },
  defaultOptions: {
    page: 'overview',
    chartId: 'soc-history',
    showPicker: true,
  },
  component: DashboardChartWidget,
});
