import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  useBatteryMileage,
  useChargeCurve,
  useChargeCurveAnalysis,
  useChargingChartSeries,
  useDegradation,
  useEfficiencyByMode,
  useEfficiencyTrend,
  useEfficiencyVsTemp,
  usePhantomDrain,
  useRangeHistory,
  useSocHistory,
} from '@riviamigo/hooks';
import { CHART_COLORS, DailyChargeSessionsChart, EfficiencyPillBarChart, RichTimeSeriesChart } from '@riviamigo/ui/charts';
import { ChartPicker } from '@riviamigo/ui/primitives';
import { cn } from '@riviamigo/ui/lib/utils';
import { formatDriveMode } from '@riviamigo/ui/lib/driveMode';
import {
  formatMiles,
  formatTemp,
  getEfficiencyDisplay,
  getUnitSystem,
  whPerMileToKmPerKwh,
  whPerMileToMiPerKwh,
  whPerMileToWhPerKm,
} from '@riviamigo/ui/lib/utils';
import type { ChargeCurveAnalysisPoint, ChargeCurvePoint } from '@riviamigo/types';
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
  /** Optional subtitle shown in the compact header when showPicker is false. */
  headerSubtitle?: string;
}

interface ResolvedDashboardChartOptions {
  chartId: string;
  chartIds: string[];
  page?: DashboardChartPage;
  showPicker: boolean;
  curveSmoothing: number;
  headerSubtitle?: string;
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
    ...(typeof options.headerSubtitle === 'string' ? { headerSubtitle: options.headerSubtitle } : {}),
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
        <div className="absolute right-0 top-[calc(100%+0.375rem)] z-50 w-52 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-bg-surface p-3 shadow-lg">
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
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {options.showPicker && chartOptions.length > 1 ? (
        // Full picker row (chart selector + settings button).
        <ChartPicker
          value={activeChartId}
          options={chartOptions}
          onChange={setChartId}
          searchValue={search}
          onSearchChange={setSearch}
          className="shrink-0"
          trailing={settingsButton}
        />
      ) : instance.title ? (
        // Compact header: title + optional subtitle on the left, settings button on
        // the right. Keeps the button in flow so it doesn't overlap the chart canvas.
        <div className="mb-2 flex shrink-0 items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-fg-secondary">
              {instance.title}
            </p>
            {options.headerSubtitle && (
              <p className="mt-0.5 text-xs text-fg-tertiary">{options.headerSubtitle}</p>
            )}
          </div>
          <div className="shrink-0">{settingsButton}</div>
        </div>
      ) : (
        // No title and no picker — float the button so it doesn't consume height.
        <div className="absolute right-0 top-0 z-10">{settingsButton}</div>
      )}
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
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
  const { data: chargingChartSeries, isLoading: chargingChartSeriesLoading } = useChargingChartSeries(
    source === 'charging_weekly_energy' || source === 'charging_sessions_energy' ? ctx.vehicleId : null,
    ctx.from,
    ctx.to,
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
  const { data: degradation = [], isLoading: degradationLoading } = useDegradation(
    source === 'battery_degradation' ? ctx.vehicleId : null,
    ctx.from,
    ctx.to,
  );
  const { data: mileage = [], isLoading: mileageLoading } = useBatteryMileage(
    source === 'battery_capacity_mileage' || source === 'projected_range_mileage' ? ctx.vehicleId : null,
    ctx.from,
    ctx.to,
  );

  if (!definition) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary">
        Unknown chart: {chartId}
      </div>
    );
  }

  const dailyChargeSeries = chargingChartSeries?.daily ?? [];
  const dailyChargeSessions = chargingChartSeries?.daily_sessions ?? [];
  const mileagePoints = mileage.map((point) => ({
    ts: point.ts,
    x: point.odometer_mi,
    y: point.usable_kwh,
    rangeMi: point.range_mi,
    projectedMaxRangeMi: point.projected_max_range_mi,
    degradationPct: point.degradation_pct,
  }));

  switch (definition.source) {
    case 'soc_history':
      return renderSocHistoryChart(definition, height, socLoading, soc.map((point) => ({ ts: point.ts, value: point.value })), smoothing);
    case 'range_history':
      return renderSingleChart(definition, height, rangeLoading, range.map((point) => ({ ts: point.ts, value: point.value })), smoothing);
    case 'charging_sessions_energy':
      return (
        <ChargingSessionsChart
          definition={definition}
          daily={dailyChargeSeries}
          dailySessions={dailyChargeSessions}
          loading={chargingChartSeriesLoading}
          height={height}
        />
      );
    case 'charging_weekly_energy':
      return (
        <DailyEnergyChart
          definition={definition}
          daily={dailyChargeSeries}
          loading={chargingChartSeriesLoading}
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
          startedAt={ctx.from || null}
          sessionEnergyKwh={ctx.chargeSessionEnergyKwh ?? null}
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
        <BatteryCapacityMileageChart
          definition={definition}
          loading={mileageLoading}
          height={height}
          points={mileagePoints}
          smoothing={smoothing}
        />
      );
    case 'projected_range_mileage':
      return (
        <ProjectedRangeMileageChart
          definition={definition}
          loading={mileageLoading}
          height={height}
          points={mileagePoints}
          smoothing={smoothing}
        />
      );
  }
}

function renderSocHistoryChart(
  definition: DashboardChartDefinition,
  height: number,
  loading: boolean,
  data: Array<{ ts: string; value: number | null }>,
  smoothing = 0,
) {
  const values = data.map((point) => point.value).filter((value): value is number => value != null && Number.isFinite(value));
  const average = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  return (
    <RichTimeSeriesChart
      points={data.map((point) => ({ ts: point.ts }))}
      series={[
        { key: definition.id, label: definition.title, values: data.map((point) => point.value), mode: definition.mode ?? 'line' },
        {
          key: `${definition.id}-avg`,
          label: 'Period Avg',
          values: data.map(() => average),
          color: CHART_COLORS.emerald,
          mode: 'line',
        },
      ]}
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
  daily,
  dailySessions,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  daily: Array<{ day_local: string; day_start: string; total_energy_kwh: number; session_count: number }>;
  dailySessions: Array<{
    session_id: string;
    day_local: string;
    day_start: string;
    started_at: string;
    energy_added_kwh: number | null;
    charger_type: string | null;
    location_name: string | null;
  }>;
  loading: boolean;
  height: number;
}) {
  return (
    <DailyChargeSessionsChart
      daily={daily}
      dailySessions={dailySessions}
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
  startedAt,
  sessionEnergyKwh,
}: {
  definition: DashboardChartDefinition;
  data: ChargeCurvePoint[];
  loading: boolean;
  height: number;
  smoothing: number;
  startedAt: string | null;
  sessionEnergyKwh: number | null;
}) {
  const allRows = data.filter((point) => Number.isFinite(point.soc_pct) && Number.isFinite(point.power_kw));

  // Build time-based points when minutes_elapsed is available. This produces a
  // single chart with charge rate (left Y, kW) and cumulative energy (right Y, kWh)
  // on the same time axis — much easier to read than a SOC-on-X layout.
  const { points, rateValues, energyValues, useTime } = React.useMemo(() => {
    const startMs = startedAt ? new Date(startedAt).getTime() : null;
    const timed = startMs != null && allRows.some((p) => p.minutes_elapsed != null);

    // Drop trailing zero-power points: when ended_at is later than when charging
    // actually stopped, we accumulate a long flat zero tail. Keep only one point
    // past the last active reading so the dropoff is still visible.
    const lastActiveIdx = allRows.reduce(
      (last, p, i) => ((p.power_kw ?? 0) > 0.1 ? i : last),
      -1,
    );
    const rows =
      lastActiveIdx >= 0 && lastActiveIdx < allRows.length - 2
        ? allRows.slice(0, lastActiveIdx + 2)
        : allRows;

    // Compute cumulative energy (kWh) across the trimmed rows.
    let cumulative = 0;
    const energyValsRaw: number[] = rows.map((p, i) => {
      if (i > 0) {
        const prev = rows[i - 1]!;
        if (prev.minutes_elapsed != null && p.minutes_elapsed != null) {
          const dtHours = (p.minutes_elapsed - prev.minutes_elapsed) / 60;
          cumulative += Math.max(0, p.power_kw ?? 0) * dtHours;
        }
      }
      return Math.max(0, cumulative);
    });

    // Keep visual shape from sampled power, but anchor the cumulative endpoint
    // to the session aggregate so the chart total matches the detail stat chip.
    const finalEnergy = energyValsRaw[energyValsRaw.length - 1] ?? 0;
    const targetEnergy = typeof sessionEnergyKwh === 'number' && Number.isFinite(sessionEnergyKwh)
      ? Math.max(0, sessionEnergyKwh)
      : null;
    const energyVals =
      targetEnergy != null && finalEnergy > 0
        ? energyValsRaw.map((value) => value * (targetEnergy / finalEnergy))
        : energyValsRaw;

    if (timed) {
      // Prepend a zero-valued anchor at the session start time so any pre-charging
      // wait (e.g. plugged in at 6 PM, scheduled charging starts at 11 PM) shows
      // as a flat line rather than silently missing from the chart.
      const firstMs = startMs! + (rows[0]?.minutes_elapsed ?? 0) * 60000;
      const gapMs = firstMs - startMs!;
      const anchored = gapMs > 5 * 60 * 1000; // >5 min gap → prepend anchor

      const allPts = [
        ...(anchored ? [{ ts: startedAt!, rate: 0, energy: 0 }] : []),
        ...rows.map((p, i) => ({
          ts: new Date(startMs! + p.minutes_elapsed! * 60000).toISOString(),
          rate: p.power_kw,
          energy: energyVals[i]!,
        })),
      ];
      return {
        useTime: true,
        points: allPts.map((p) => ({ ts: p.ts })),
        rateValues: allPts.map((p) => p.rate),
        energyValues: allPts.map((p) => p.energy),
      };
    }

    // Fallback: SOC on X axis (no minutes_elapsed data available).
    return {
      useTime: false,
      points: rows.map((p) => ({ ts: p.soc_pct })),
      rateValues: rows.map((p) => p.power_kw),
      energyValues: energyVals,
    };
  }, [allRows, startedAt, sessionEnergyKwh]);

  const xSplits = React.useMemo(() => {
    if (!useTime || points.length < 2) return undefined;

    const xSeconds = points
      .map((point) => new Date(String(point.ts)).getTime() / 1000)
      .filter((value) => Number.isFinite(value));
    if (xSeconds.length < 2) return undefined;

    const start = xSeconds[0]!;
    const end = xSeconds[xSeconds.length - 1]!;
    const firstWholeHour = Math.ceil(start / 3600) * 3600;
    const splits: number[] = [];
    for (let tick = firstWholeHour; tick <= end; tick += 3600) {
      splits.push(tick);
    }

    return splits.length >= 2 ? splits : undefined;
  }, [points, useTime]);

  return (
    <RichTimeSeriesChart
      points={points}
      series={[
        // Energy Added rendered first (bottom layer) so the area fill sits behind
        // the Charge Rate line, which is drawn second (top layer).
        {
          key: 'energy',
          label: 'Energy Added',
          color: CHART_COLORS.emerald,
          values: energyValues,
          mode: 'area',
          yScale: 'y2',
        },
        {
          key: 'rate',
          label: 'Charge Rate',
          color: CHART_COLORS.accent,
          values: rateValues,
          yScale: 'y',
        },
      ]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={useTime}
      xUnit={useTime ? undefined : '%'}
      yUnit="kW"
      yRightUnit="kWh"
      mode="line"
      xValueFormatter={useTime ? undefined : (value) => `${Math.round(value)}%`}
      xSplits={xSplits}
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
  const rows = data
    .filter((point): point is ChargeCurveAnalysisPoint & { soc_pct: number; charge_rate_kw: number } =>
      Number.isFinite(point.soc_pct) &&
      Number.isFinite(point.charge_rate_kw) &&
      point.charge_rate_kw > 0 &&
      normalizeChargeCurveType(point.charger_type) === 'dc'
    )
    .map((point) => ({
      ...point,
      sample_source: normalizeSampleSource(point.sample_source),
    }))
    .sort((left, right) =>
      left.soc_pct - right.soc_pct ||
      (left.session_id || '').localeCompare(right.session_id || '') ||
      (left.minutes_elapsed ?? 0) - (right.minutes_elapsed ?? 0)
    );

  const trendValues = buildChargeCurveTrend(rows);
  const telemetryValues = rows.map((row) => (row.sample_source === 'rivian_charge_curve_points' ? null : row.charge_rate_kw));
  const fallbackValues = rows.map((row) => (row.sample_source === 'rivian_charge_curve_points' ? row.charge_rate_kw : null));
  const hasFallbackSamples = fallbackValues.some((value) => value != null);

  return (
    <RichTimeSeriesChart
      points={rows.map((point) => ({ ts: point.soc_pct }))}
      series={[
        {
          key: 'dc-telemetry',
          label: 'DC Samples',
          color: CHART_COLORS.rose,
          mode: 'scatter',
          values: telemetryValues,
        },
        ...(hasFallbackSamples ? [{
          key: 'dc-fallback',
          label: 'Fallback Samples',
          color: CHART_COLORS.amber,
          mode: 'scatter' as const,
          values: fallbackValues,
        }] : []),
        {
          key: 'dc-trend',
          label: 'Smoothed Trend',
          color: CHART_COLORS.orange,
          mode: 'line',
          values: trendValues,
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

function normalizeSampleSource(value: unknown) {
  const source = typeof value === 'string' ? value : '';
  return source === 'rivian_charge_curve_points' ? source : 'telemetry';
}

function buildChargeCurveTrend(rows: Array<{ session_id: string; soc_pct: number; charge_rate_kw: number; sample_source: string }>) {
  if (rows.length < 4) {
    return rows.map(() => null);
  }

  const binSize = 5;
  const sessionBins = new Map<string, Map<number, number[]>>();

  for (const row of rows) {
    const sessionId = row.session_id || 'unknown';
    const bin = Math.max(0, Math.min(20, Math.floor(row.soc_pct / binSize)));
    const perSession = sessionBins.get(sessionId) ?? new Map<number, number[]>();
    const values = perSession.get(bin) ?? [];
    values.push(row.charge_rate_kw);
    perSession.set(bin, values);
    sessionBins.set(sessionId, perSession);
  }

  const binValues = new Map<number, number[]>();
  for (const perSession of sessionBins.values()) {
    for (const [bin, values] of perSession.entries()) {
      const sessionMedian = median(values);
      const existing = binValues.get(bin) ?? [];
      existing.push(sessionMedian);
      binValues.set(bin, existing);
    }
  }

  const trendPoints = Array.from(binValues.entries())
    .map(([bin, values]) => ({
      x: bin * binSize + binSize / 2,
      y: median(values),
    }))
    .sort((left, right) => left.x - right.x);

  const smoothed = smoothTrendPoints(trendPoints);
  return rows.map((row) => interpolateTrend(smoothed, row.soc_pct));
}

function smoothTrendPoints(points: Array<{ x: number; y: number }>) {
  if (points.length < 3) return points;

  return points.map((point, index) => {
    const window = points.slice(Math.max(0, index - 1), Math.min(points.length, index + 2));
    return {
      x: point.x,
      y: median(window.map((item) => item.y)),
    };
  });
}

function interpolateTrend(points: Array<{ x: number; y: number }>, x: number) {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0]!.y;
  if (x <= points[0]!.x) return points[0]!.y;
  if (x >= points[points.length - 1]!.x) return points[points.length - 1]!.y;

  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index]!;
    const right = points[index + 1]!;
    if (x < left.x || x > right.x) continue;
    const span = right.x - left.x;
    if (span <= 0) return right.y;
    const ratio = (x - left.x) / span;
    return left.y + (right.y - left.y) * ratio;
  }

  return points[points.length - 1]!.y;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
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

function normalizeChargeCurveType(chargerType: ChargeCurveAnalysisPoint['charger_type']) {
  const normalized = chargerType as string | null;
  if (normalized === 'dc' || normalized === 'dcfc') return 'dc';
  if (normalized === 'ac' || normalized === 'ac_l2') return 'ac';
  return 'unknown';
}

function DailyEnergyChart({
  definition,
  daily,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  daily: Array<{ day_local: string; day_start: string; total_energy_kwh: number }>;
  loading: boolean;
  height: number;
}) {
  const formatDayLabel = (seconds: number) => {
    const d = new Date(seconds * 1000);
    return d.toLocaleString([], { month: 'short', day: 'numeric' });
  };

  return (
    <RichTimeSeriesChart
      points={daily.map((point) => ({ ts: point.day_start }))}
      series={[{ key: 'energy', label: 'Energy Charged', values: daily.map((point) => point.total_energy_kwh ?? null) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      mode="bar"
      xValueFormatter={formatDayLabel}
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
  data: Array<{ temp_c_low: number; temp_c_high: number; avg_efficiency_wh_mi: number | null; total_miles?: number | null; avg_speed_mph?: number | null }>;
  loading: boolean;
  height: number;
}) {
  const points = data
    .filter((point) => point.avg_efficiency_wh_mi != null)
    .sort((left, right) => right.temp_c_low - left.temp_c_low)
    .map((point) => ({
      label: formatTemp(point.temp_c_low),
      value: convertEfficiency(point.avg_efficiency_wh_mi),
      distance: typeof point.total_miles === 'number' ? Math.round(point.total_miles) : null,
      speed: typeof point.avg_speed_mph === 'number' ? point.avg_speed_mph : null,
    }));

  return (
    <EfficiencyPillBarChart
      data={points.filter((point): point is typeof points[number] & { value: number } => point.value != null)}
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
  return formatDriveMode(value);
}

function BatteryCapacityMileageChart({
  definition,
  points,
  loading,
  height,
  smoothing,
}: {
  definition: DashboardChartDefinition;
  points: Array<{ x: number | null; y: number | null; degradationPct: number | null }>;
  loading: boolean;
  height: number;
  smoothing?: number;
}) {
  const rows = points
    .filter((point): point is { x: number; y: number; degradationPct: number | null } => point.x != null && point.y != null)
    .sort((a, b) => a.x - b.x);

  const trendline = buildRegression(rows.map((point) => ({ x: point.x, y: point.y })));

  return (
    <RichTimeSeriesChart
      points={rows.map((point) => ({ ts: point.x }))}
      series={[
        {
          key: 'degradation-under-10',
          label: 'Degradation <10%',
          color: CHART_COLORS.emerald,
          mode: 'scatter',
          values: rows.map((point) => point.degradationPct != null && point.degradationPct < 10 ? point.y : null),
        },
        {
          key: 'degradation-10-20',
          label: 'Degradation 10-20%',
          color: CHART_COLORS.amber,
          mode: 'scatter',
          values: rows.map((point) => point.degradationPct != null && point.degradationPct >= 10 && point.degradationPct < 20 ? point.y : null),
        },
        {
          key: 'degradation-20-30',
          label: 'Degradation 20-30%',
          color: CHART_COLORS.orange,
          mode: 'scatter',
          values: rows.map((point) => point.degradationPct != null && point.degradationPct >= 20 && point.degradationPct < 30 ? point.y : null),
        },
        {
          key: 'degradation-over-30',
          label: 'Degradation >30%',
          color: CHART_COLORS.rose,
          mode: 'scatter',
          values: rows.map((point) => point.degradationPct != null && point.degradationPct >= 30 ? point.y : null),
        },
        {
          key: 'capacity-trend',
          label: 'Trend',
          color: CHART_COLORS.muted,
          mode: 'line',
          values: rows.map((point) => trendline ? trendline(point.x) : null),
        },
      ]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={false}
      xUnit="mi"
      yUnit={definition.yUnit}
      yRange={definition.yRange}
      mode="scatter"
      xValueFormatter={(value) => formatMiles(value).replace(/\s.*/, '')}
      smoothing={smoothing}
    />
  );
}

function ProjectedRangeMileageChart({
  definition,
  points,
  loading,
  height,
  smoothing,
}: {
  definition: DashboardChartDefinition;
  points: Array<{ ts: string; rangeMi: number | null; projectedMaxRangeMi: number | null; x: number | null }>;
  loading: boolean;
  height: number;
  smoothing?: number;
}) {
  const rows = points
    .filter((point) => point.x != null)
    .map((point) => ({
      ts: point.ts,
      projectedRangeMi: point.projectedMaxRangeMi ?? point.rangeMi,
      odometerMi: point.x,
    }))
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const yRange = getProjectedRangeMileageYRange(rows.map((point) => point.projectedRangeMi));

  return (
    <RichTimeSeriesChart
      points={rows.map((point) => ({ ts: point.ts }))}
      series={[
        {
          key: definition.id,
          label: 'Projected Max Range',
          values: rows.map((point) => point.projectedRangeMi),
          color: CHART_COLORS.amber,
          mode: 'area',
        },
        {
          key: 'odometer-mi',
          label: 'Mileage',
          values: rows.map((point) => point.odometerMi),
          color: CHART_COLORS.emerald,
          mode: 'line',
          yScale: 'y2',
        },
      ]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      yRange={yRange}
      yRightUnit="mi"
      mode={definition.mode}
      smoothing={smoothing}
    />
  );
}

export function getProjectedRangeMileageYRange(values: Array<number | null | undefined>) {
  const populated = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (populated.length === 0) return undefined;

  const min = 200;
  const step = 25;
  const max = Math.max(...populated);
  const upper = Math.max(min + step, Math.ceil(max / step) * step);

  return [min, upper] as [number, number];
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
