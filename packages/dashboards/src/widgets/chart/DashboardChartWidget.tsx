import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  useBatteryMileage,
  useChargeCurve,
  useChargeCurveAnalysis,
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
import { ChargeSessionDistributionChart, EfficiencyPillBarChart, RichTimeSeriesChart } from '@riviamigo/ui/charts';
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
import type { ChargeCurveAnalysisPoint, ChargeCurvePoint, ChargeSession } from '@riviamigo/types';
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
  curveSmoothing?: number | boolean;
}

interface ResolvedDashboardChartOptions {
  chartId: string;
  chartIds: string[];
  page?: DashboardChartPage;
  showPicker: boolean;
  curveSmoothing: number;
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
    curveSmoothing: normalizeCurveSmoothing(options.curveSmoothing),
    ...(page ? { page } : {}),
  };
}

const DEFAULT_SMOOTHING = 0.2;
const MIN_ENABLED_SMOOTHING = 0.05;

export function DashboardChartWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const options = readOptions(instance);
  const chartOptions = getChartOptions(options.page).filter((option) => options.chartIds.includes(option.value));
  const [chartId, setChartId] = React.useState(options.chartId);
  const [search, setSearch] = React.useState('');
  // smoothing: 0 = off, >0 = smoothing amount (0–1)
  const [smoothing, setSmoothing] = React.useState(options.curveSmoothing);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settingsRef = React.useRef<HTMLDivElement>(null);
  const { ref, height } = useMeasuredWidgetHeight(260, 160);

  const smoothingOn = smoothing > 0;
  const smoothingTrackPercent = Math.min(
    100,
    Math.max(0, ((smoothing - MIN_ENABLED_SMOOTHING) / (1 - MIN_ENABLED_SMOOTHING)) * 100),
  );

  React.useEffect(() => {
    if (!options.chartIds.includes(chartId)) {
      setChartId(options.chartId);
    }
  }, [chartId, options.chartId, options.chartIds]);

  React.useEffect(() => {
    setSmoothing(options.curveSmoothing);
  }, [options.curveSmoothing]);

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
              aria-label="Toggle smooth curves"
              aria-checked={smoothingOn}
              onClick={() => setSmoothing((v) => v > 0 ? 0 : MIN_ENABLED_SMOOTHING)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border px-0.5',
                'transition-all duration-200 ease-in-out',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                smoothingOn
                  ? 'border-accent bg-accent shadow-[0_0_0_1px_var(--rm-accent)]'
                  : 'border-border-strong bg-bg-elevated',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 rounded-full border bg-white shadow-sm',
                  'transition-transform duration-200 ease-in-out',
                  smoothingOn
                    ? 'translate-x-5 border-accent'
                    : 'translate-x-0 border-border-strong',
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
                min={MIN_ENABLED_SMOOTHING}
                max={1}
                step={0.05}
                value={smoothing}
                onChange={(e) => setSmoothing(Number(e.target.value))}
                className="rm-accent-range w-full"
                style={{
                  background: `linear-gradient(to right, var(--rm-accent) 0%, var(--rm-accent) ${smoothingTrackPercent}%, var(--rm-border-strong) ${smoothingTrackPercent}%, var(--rm-border-strong) 100%)`,
                }}
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
      ) : (
        <div className="mb-3 flex shrink-0 justify-end">
          {settingsButton}
        </div>
      )}
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
  const { data: selectedChargeCurve = [], isLoading: selectedChargeCurveLoading } = useChargeCurve(
    source === 'charge_session_curve' ? ctx.chargeSessionId ?? null : null,
    source === 'charge_session_curve' ? ctx.vehicleId : null,
  );
  const { data: chargeCurveAnalysis = [], isLoading: chargeCurveAnalysisLoading } = useChargeCurveAnalysis(
    source === 'charging_curve_analysis' ? ctx.vehicleId : null,
    ctx.from,
    ctx.to,
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
    case 'charge_session_curve':
      return (
        <ChargeSessionCurveChart
          definition={definition}
          data={selectedChargeCurve}
          loading={selectedChargeCurveLoading}
          height={height}
          smoothing={smoothing}
        />
      );
    case 'charging_curve_analysis':
      return (
        <ChargingCurveAnalysisChart
          definition={definition}
          data={chargeCurveAnalysis}
          loading={chargeCurveAnalysisLoading}
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
      stepInterpolation={definition.stepInterpolation && smoothing <= 0}
      mode={definition.mode}
      smoothing={smoothing}
    />
  );
}

function ChargingSessionsChart({
  definition,
  sessions,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  sessions: ChargeSession[];
  loading: boolean;
  height: number;
}) {
  const bands = [
    { label: '<5', min: 0, max: 5 },
    { label: '5-10', min: 5, max: 10 },
    { label: '10-20', min: 10, max: 20 },
    { label: '20-40', min: 20, max: 40 },
    { label: '40+', min: 40, max: Number.POSITIVE_INFINITY },
  ].map((band) => {
    const matching = sessions.filter((session) => {
      const energy = session.energy_added_kwh;
      return energy != null && energy >= band.min && energy < band.max;
    });
    const validRates = matching
      .map((session) => {
        if (session.energy_added_kwh == null || session.duration_min == null || session.duration_min <= 0) {
          return null;
        }
        return session.energy_added_kwh / (session.duration_min / 60);
      })
      .filter((value): value is number => value != null && Number.isFinite(value));

    return {
      label: `${band.label} kWh`,
      count: matching.length,
      averageRateKw: validRates.length > 0
        ? validRates.reduce((sum, value) => sum + value, 0) / validRates.length
        : null,
    };
  });

  return (
    <ChargeSessionDistributionChart
      bands={bands}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
    />
  );
}

function ChargeSessionCurveChart({
  definition,
  data,
  loading,
  height,
  smoothing,
}: {
  definition: DashboardChartDefinition;
  data: ChargeCurvePoint[];
  loading: boolean;
  height: number;
  smoothing: number;
}) {
  const rows = data.filter((point) => Number.isFinite(point.soc_pct) && Number.isFinite(point.power_kw));

  return (
    <RichTimeSeriesChart
      points={rows.map((point) => ({ ts: point.soc_pct }))}
      series={[{ key: 'rate', label: 'Charge Rate', values: rows.map((point) => point.power_kw) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={false}
      xUnit="%"
      yUnit="kW"
      mode="line"
      xValueFormatter={(value) => `${Math.round(value)}%`}
      smoothing={smoothing}
    />
  );
}

function ChargingCurveAnalysisChart({
  definition,
  data,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  data: ChargeCurveAnalysisPoint[];
  loading: boolean;
  height: number;
}) {
  const rows = data.filter((point) =>
    Number.isFinite(point.soc_pct) &&
    Number.isFinite(point.charge_rate_kw) &&
    point.charge_rate_kw > 0
  );
  const typed = rows.map((point) => ({
    x: point.soc_pct,
    y: point.charge_rate_kw,
    bucket: normalizeChargeCurveType(point.charger_type),
  }));
  const points = [...typed].sort((a, b) => a.x - b.x);
  const regressions = {
    ac: buildRegression(points.filter((point) => point.bucket === 'ac')),
    dc: buildRegression(points.filter((point) => point.bucket === 'dc')),
    unknown: buildRegression(points.filter((point) => point.bucket === 'unknown')),
  };

  return (
    <RichTimeSeriesChart
      points={points.map((point) => ({ ts: point.x }))}
      series={[
        {
          key: 'ac-points',
          label: 'AC Samples',
          color: '#34d399',
          mode: 'scatter',
          values: points.map((point) => point.bucket === 'ac' ? point.y : null),
        },
        {
          key: 'dc-points',
          label: 'DC Samples',
          color: '#38bdf8',
          mode: 'scatter',
          values: points.map((point) => point.bucket === 'dc' ? point.y : null),
        },
        {
          key: 'unknown-points',
          label: 'Unclassified Samples',
          color: '#f59e0b',
          mode: 'scatter',
          values: points.map((point) => point.bucket === 'unknown' ? point.y : null),
        },
        {
          key: 'ac-fit',
          label: 'AC Regression',
          color: '#10b981',
          mode: 'line',
          values: points.map((point) => regressions.ac ? regressions.ac(point.x) : null),
        },
        {
          key: 'dc-fit',
          label: 'DC Regression',
          color: '#0ea5e9',
          mode: 'line',
          values: points.map((point) => regressions.dc ? regressions.dc(point.x) : null),
        },
        {
          key: 'unknown-fit',
          label: 'Unclassified Regression',
          color: '#d97706',
          mode: 'line',
          values: points.map((point) => regressions.unknown ? regressions.unknown(point.x) : null),
        },
      ]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={false}
      xUnit="%"
      yUnit="kW"
      mode="scatter"
      xValueFormatter={(value) => `${Math.round(value)}%`}
      smoothing={0}
    />
  );
}

function normalizeChargeCurveType(chargerType: ChargeCurveAnalysisPoint['charger_type']) {
  const normalized = chargerType as string | null;
  if (normalized === 'dc' || normalized === 'dcfc') return 'dc';
  if (normalized === 'ac' || normalized === 'ac_l2') return 'ac';
  return 'unknown';
}

function buildRegression(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const numerator = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  if (denominator === 0) return null;
  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  return (x: number) => Math.max(0, intercept + slope * x);
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
      label: `${formatTemp(point.temp_c_low)} to ${formatTemp(point.temp_c_high)}`,
      value: convertEfficiency(point.avg_efficiency_wh_mi),
    }));

  return (
    <EfficiencyPillBarChart
      data={points.filter((point): point is { label: string; value: number } => point.value != null)}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      valueUnit={getEfficiencyUnit()}
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
  data: Array<{ drive_mode: string; avg_efficiency: number | null; trip_count?: number | null }>;
  loading: boolean;
  height: number;
}) {
  const rows = data
    .filter((point) => point.avg_efficiency != null)
    .map((point) => ({
      label: formatDriveModeLabel(point.drive_mode),
      value: convertEfficiency(point.avg_efficiency),
      count: typeof point.trip_count === 'number' ? point.trip_count : null,
    }))
    .filter((point): point is { label: string; value: number; count: number | null } => point.value != null);

  return (
    <EfficiencyPillBarChart
      data={rows}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      valueUnit={getEfficiencyUnit()}
    />
  );
}

function formatDriveModeLabel(value: string) {
  const labels: Record<string, string> = {
    everyday: 'All-Purpose',
    all_purpose: 'All-Purpose',
    sport: 'Sport',
    distance: 'Conserve',
    conserve: 'Conserve',
    winter: 'Snow',
    snow: 'Snow',
    off_road_auto: 'All-Terrain',
    all_terrain: 'All-Terrain',
    off_road_sand: 'Soft Sand',
    soft_sand: 'Soft Sand',
    off_road_rocks: 'Rock Crawl',
    rock_crawl: 'Rock Crawl',
    off_road_sport_auto: 'Rally',
    rally: 'Rally',
    off_road_sport_drift: 'Drift',
    drift: 'Drift',
    towing: 'Towing',
  };
  return labels[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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

function normalizeCurveSmoothing(value: unknown) {
  if (typeof value === 'boolean') return value ? DEFAULT_SMOOTHING : 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  return DEFAULT_SMOOTHING;
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
    curveSmoothing: DEFAULT_SMOOTHING,
  },
  component: DashboardChartWidget,
});
