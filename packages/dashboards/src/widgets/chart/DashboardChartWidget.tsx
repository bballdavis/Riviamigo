import React from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, SlidersHorizontal, X } from 'lucide-react';
import {
  useBatteryMileage,
  useChargeCurve,
  useChargeCurveAnalysis,
  useChargingChartSeries,
  useDegradation,
  useEfficiencyByMode,
  useEfficiencyTrend,
  useEfficiencyVsTemp,
  usePhantomDrainPeriods,
  useRangeHistory,
  useSocHistory,
} from '@riviamigo/hooks';
import {
  CHART_COLORS,
  CURVE_SMOOTHNESS_OPTIONS,
  DEFAULT_CHART_TIME_FILTER,
  DEFAULT_CURVE_SMOOTHNESS,
  DailyChargeSessionsChart,
  DailyEnergyBarChart,
  EfficiencyPillBarChart,
  formatChartNumber,
  getAdaptiveDecimalPrecision,
  normalizeTimeFilter,
  curveSmoothnessLabel,
  normalizeCurveSmoothness,
  RichTimeSeriesChart,
  TIME_FILTER_OPTIONS,
  timeFilterLabel,
  type TimeFilterWindow,
  type CurveSmoothness,
} from '@riviamigo/ui/charts';
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
  getChartSettingsCapabilities,
  supportsDashboardChartSmoothness,
  type DashboardChartAxisCapability,
  type DashboardChartAxisId,
  type DashboardChartDefinition,
  type DashboardChartPage,
  type DashboardChartSettingsCapabilities,
} from '../../charts/catalog';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';
import { useMeasuredWidgetHeight } from '../useMeasuredWidgetHeight';
import { PhantomDrainChart } from './PhantomDrainChart';
import { MobileChartViewer } from './MobileChartViewer';

export { buildPhantomDrainDailySeries } from './PhantomDrainChart';

interface DashboardChartOptions {
  chartId?: string;
  chartIds?: string[];
  page?: DashboardChartPage;
  showPicker?: boolean;
  timeFilter?: TimeFilterWindow;
  smoothness?: CurveSmoothness;
  curveSmoothing?: number | boolean;
  chartSettings?: Record<string, DashboardChartDisplaySettings>;
  /** Optional subtitle shown in the compact header when showPicker is false. */
  headerSubtitle?: string;
}

type DashboardChartAxisMode = 'auto' | 'manual';

interface DashboardChartAxisRangeSetting {
  mode?: DashboardChartAxisMode;
  min?: number;
  max?: number;
}

interface DashboardChartDisplaySettings {
  timeFilter?: TimeFilterWindow;
  smoothness?: CurveSmoothness;
  /** Legacy geometric interpolation setting, retained only while reading saved dashboards. */
  smoothing?: number;
  axes?: Partial<Record<DashboardChartAxisId, DashboardChartAxisRangeSetting>>;
}

interface ResolvedDashboardChartOptions {
  chartId: string;
  chartIds: string[];
  page?: DashboardChartPage;
  showPicker: boolean;
  legacyTimeFilter: TimeFilterWindow;
  legacySmoothness: CurveSmoothness;
  chartSettings: Record<string, DashboardChartDisplaySettings>;
  headerSubtitle?: string;
}

const LEGACY_CHART_ID_ALIASES: Record<string, string> = {
  'range-history': 'soc-history',
};

const CHART_DEFAULTS_STORAGE_KEY = 'rm-dashboard-chart-defaults';

function normalizeChartId(chartId: string) {
  return LEGACY_CHART_ID_ALIASES[chartId] ?? chartId;
}

function chartDefaultStorageKey(ctx: WidgetCtx, instance: WidgetInstance) {
  return `${ctx.dashboardSlug ?? 'dashboard'}:${instance.id}`;
}

function readStoredChartDefault(storageKey: string, validIds: readonly string[], fallback: string) {
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(CHART_DEFAULTS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const value = (parsed as Record<string, unknown>)[storageKey];
    return typeof value === 'string' && validIds.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function saveStoredChartDefault(storageKey: string, chartId: string) {
  if (typeof window === 'undefined') return;

  try {
    const raw = window.localStorage.getItem(CHART_DEFAULTS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const stored = parsed && typeof parsed === 'object'
      ? { ...(parsed as Record<string, unknown>) }
      : {};
    stored[storageKey] = chartId;
    window.localStorage.setItem(CHART_DEFAULTS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Preferences are best-effort when storage is unavailable or full.
  }
}

function readOptions(instance: WidgetInstance): ResolvedDashboardChartOptions {
  const options = (instance.options ?? {}) as DashboardChartOptions;
  const page = isDashboardChartPage(options.page) ? options.page : undefined;
  const pageDefinitions = getChartDefinitions(page);
  const validIds = new Set(pageDefinitions.map((definition) => definition.id));
  const chartIds = Array.isArray(options.chartIds)
    ? [...new Set(options.chartIds
      .filter((id): id is string => typeof id === 'string')
      .map(normalizeChartId)
      .filter((id) => validIds.has(id)))]
    : [];
  const fallbackIds = chartIds.length > 0 ? chartIds : pageDefinitions.map((definition) => definition.id);
  const fallbackChartId = fallbackIds[0] ?? getChartDefinitions()[0]?.id ?? 'soc-history';
  const configuredChartId = typeof options.chartId === 'string' ? normalizeChartId(options.chartId) : undefined;
  const chartId = configuredChartId && validIds.has(configuredChartId)
    ? configuredChartId
    : fallbackChartId;

  return {
    chartId,
    chartIds: fallbackIds,
    showPicker: options.showPicker ?? fallbackIds.length > 1,
    legacyTimeFilter: normalizeTimeFilter(
      options.timeFilter,
      legacySmoothingToTimeFilter(options.curveSmoothing),
    ),
    legacySmoothness: normalizeCurveSmoothness(options.smoothness, normalizeCurveSmoothness(options.curveSmoothing)),
    chartSettings: normalizeChartSettingsMap(options.chartSettings),
    ...(page ? { page } : {}),
    ...(typeof options.headerSubtitle === 'string' ? { headerSubtitle: options.headerSubtitle } : {}),
  };
}

const AXIS_ORDER: DashboardChartAxisId[] = ['x', 'y', 'y2'];
const EMPTY_CAPABILITIES: DashboardChartSettingsCapabilities = {
  timeFilter: false,
  axes: {},
  xDomainSource: 'dashboard-timeframe',
};

export function DashboardChartWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const options = readOptions(instance);
  const chartOptions = getChartOptions(options.page).filter((option) => options.chartIds.includes(option.value));
  const defaultStorageKey = chartDefaultStorageKey(ctx, instance);
  const chartIdsSignature = options.chartIds.join('|');
  const [chartId, setChartId] = React.useState(() => (
    readStoredChartDefault(defaultStorageKey, options.chartIds, options.chartId)
  ));
  const [defaultChartId, setDefaultChartId] = React.useState(() => (
    readStoredChartDefault(defaultStorageKey, options.chartIds, options.chartId)
  ));
  const previousDefaultStorageKeyRef = React.useRef(defaultStorageKey);
  const [search, setSearch] = React.useState('');
  const [draftChartSettings, setDraftChartSettings] = React.useState(options.chartSettings);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const settingsTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const expandTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const { ref, height } = useMeasuredWidgetHeight(260, 160);
  const chartSettingsSignature = JSON.stringify(options.chartSettings);

  React.useEffect(() => {
    const storedDefault = readStoredChartDefault(defaultStorageKey, options.chartIds, options.chartId);
    setDefaultChartId(storedDefault);
    setChartId((current) => {
      if (previousDefaultStorageKeyRef.current !== defaultStorageKey) return storedDefault;
      return options.chartIds.includes(current) ? current : storedDefault;
    });
    previousDefaultStorageKeyRef.current = defaultStorageKey;
  }, [defaultStorageKey, options.chartId, chartIdsSignature]);

  React.useEffect(() => {
    setDraftChartSettings(options.chartSettings);
  }, [chartSettingsSignature]);

  const activeChartId = options.chartIds.includes(chartId) ? chartId : options.chartId;
  const activeChartDefinition = getChartDefinition(activeChartId);
  const activeCapabilities = activeChartDefinition
    ? { ...getChartSettingsCapabilities(activeChartDefinition), smoothness: supportsDashboardChartSmoothness(activeChartDefinition) }
    : EMPTY_CAPABILITIES;
  const activeSettings = resolveChartDisplaySettings(draftChartSettings, activeChartId, options.legacyTimeFilter, options.legacySmoothness);
  const activeChartTitle = activeChartDefinition?.title ?? instance.title ?? 'Chart';

  function updateActiveChartSettings(
    updater: (current: DashboardChartDisplaySettings) => DashboardChartDisplaySettings,
  ) {
    setDraftChartSettings((current) => {
      const nextEntry = updater(current[activeChartId] ?? {});
      const nextMap = setChartSettingsEntry(current, activeChartId, nextEntry);
      ctx.updateWidgetOptions?.(instance.id, { chartSettings: nextMap });
      return nextMap;
    });
  }

  function setChartAsDefault(nextChartId: string) {
    saveStoredChartDefault(defaultStorageKey, nextChartId);
    setDefaultChartId(nextChartId);
  }

  const settingsButton = (
    <div className="relative">
      <button
        ref={settingsTriggerRef}
        type="button"
        aria-label="Chart settings"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen((value) => !value)}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-surface text-fg-tertiary transition-colors',
          'hover:border-border-strong hover:text-fg focus:outline-none focus:ring-1 focus:ring-accent',
          settingsOpen && 'border-accent text-accent',
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
    </div>
  );

  const chartControls = (
    <div className="flex items-center gap-2">
      {settingsButton}
      <button
        ref={expandTriggerRef}
        type="button"
        aria-label="Expand chart"
        onClick={() => setViewerOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-surface text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg focus:outline-none focus:ring-1 focus:ring-accent sm:hidden"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
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
          trailing={chartControls}
          defaultValue={defaultChartId}
          onSetDefault={setChartAsDefault}
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
          <div className="shrink-0">{chartControls}</div>
        </div>
      ) : (
        // No title and no picker — float the button so it doesn't consume height.
        <div className="absolute right-0 top-0 z-10">{chartControls}</div>
      )}
      {!viewerOpen ? (
        <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
          <DashboardChartRenderer chartId={activeChartId} ctx={ctx} height={height} settings={activeSettings} />
        </div>
      ) : null}
      <ChartSettingsPanel
        open={settingsOpen}
        triggerRef={settingsTriggerRef}
        chartTitle={activeChartTitle}
        capabilities={activeCapabilities}
        settings={activeSettings}
        persistent={Boolean(ctx.updateWidgetOptions)}
        onClose={() => setSettingsOpen(false)}
        onTimeFilterChange={(next) =>
          updateActiveChartSettings((current) => ({
            ...current,
            timeFilter: next,
          }))
        }
        onSmoothnessChange={(next) =>
          updateActiveChartSettings((current) => ({
            ...current,
            smoothness: next,
          }))
        }
        onAxisModeChange={(axisId, mode) =>
          updateActiveChartSettings((current) => ({
            ...current,
            axes: {
              ...(current.axes ?? {}),
              [axisId]: {
                ...(current.axes?.[axisId] ?? {}),
                mode,
              },
            },
          }))
        }
        onAxisValueChange={(axisId, bound, rawValue) =>
          updateActiveChartSettings((current) => ({
            ...current,
            axes: {
              ...(current.axes ?? {}),
              [axisId]: {
                ...(current.axes?.[axisId] ?? {}),
                mode: current.axes?.[axisId]?.mode ?? 'manual',
                [bound]: rawValue,
              },
            },
          }))
        }
      />
      {viewerOpen ? (
        <MobileChartViewer
          chartId={activeChartId}
          chartTitle={activeChartTitle}
          chartOptions={chartOptions}
          onChartChange={setChartId}
          defaultChartId={defaultChartId}
          onSetDefault={setChartAsDefault}
          onClose={() => {
            setViewerOpen(false);
            requestAnimationFrame(() => expandTriggerRef.current?.focus());
          }}
        >
          {(viewerHeight) => (
            <DashboardChartRenderer
              chartId={activeChartId}
              ctx={ctx}
              height={viewerHeight}
              settings={activeSettings}
              presentation="mobile-viewer"
            />
          )}
        </MobileChartViewer>
      ) : null}
    </div>
  );
}

export function DashboardChartRenderer({
  chartId,
  ctx,
  height,
  timeFilter = 'raw',
  settings,
  presentation = 'embedded',
}: {
  chartId: string;
  ctx: WidgetCtx;
  height: number;
  timeFilter?: TimeFilterWindow;
  settings?: DashboardChartDisplaySettings;
  presentation?: 'embedded' | 'mobile-viewer';
}) {
  const definition = getChartDefinition(normalizeChartId(chartId));
  if (!definition) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary">
        Unknown chart: {chartId}
      </div>
    );
  }
  return (
    <ActiveDashboardChartSource
      definition={definition}
      ctx={ctx}
      height={height}
      timeFilter={settings?.timeFilter ?? timeFilter}
      smoothness={settings?.smoothness ?? DEFAULT_CURVE_SMOOTHNESS}
      presentation={presentation}
      {...(settings ? { settings } : {})}
    />
  );
}

type ActiveDashboardChartSourceProps = {
  definition: DashboardChartDefinition;
  ctx: WidgetCtx;
  height: number;
  timeFilter: TimeFilterWindow;
  smoothness: CurveSmoothness;
  settings?: DashboardChartDisplaySettings;
  presentation: 'embedded' | 'mobile-viewer';
};

function ActiveDashboardChartSource(props: ActiveDashboardChartSourceProps) {
  switch (props.definition.source) {
    case 'soc_history': return <SocHistorySource {...props} />;
    case 'charging_sessions_energy': return <ChargingSeriesSource {...props} sessions />;
    case 'charging_weekly_energy': return <ChargingSeriesSource {...props} />;
    case 'charge_session_curve': return <ChargeSessionCurveSource {...props} />;
    case 'charging_curve_analysis': return <ChargingCurveAnalysisSource {...props} />;
    case 'efficiency_trend': return <EfficiencyTrendSource {...props} />;
    case 'efficiency_temperature': return <EfficiencyTemperatureSource {...props} />;
    case 'efficiency_mode': return <EfficiencyModeSource {...props} />;
    case 'phantom_drain': return <PhantomDrainSource {...props} />;
    case 'battery_degradation': return <BatteryDegradationSource {...props} />;
    case 'battery_capacity_mileage': return <BatteryMileageSource {...props} />;
    case 'projected_range_mileage': return <ProjectedRangeMileageSource {...props} />;
  }
}

function chartInteractionMode(presentation: ActiveDashboardChartSourceProps['presentation']) {
  return presentation === 'mobile-viewer' ? 'touch-explore' as const : 'standard' as const;
}

function sourceAxisRanges(settings?: DashboardChartDisplaySettings) {
  return {
    xRange: getManualAxisRange(settings?.axes?.x),
    yRange: getManualAxisRange(settings?.axes?.y),
    yRightRange: getManualAxisRange(settings?.axes?.y2),
  };
}

function SocHistorySource({ definition, ctx, height, timeFilter, smoothness, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data: soc = [], isLoading: socLoading } = useSocHistory(ctx.vehicleId, ctx.from, ctx.to);
  const { data: range = [], isLoading: rangeLoading } = useRangeHistory(ctx.vehicleId, ctx.from, ctx.to);
  return renderSocHistoryChart(
    definition,
    height,
    socLoading || rangeLoading,
    soc.map((point) => ({ ts: point.ts, value: point.value })),
    range.map((point) => ({ ts: point.ts, value: point.value })),
    timeFilter,
    smoothness,
    sourceAxisRanges(settings).yRange,
    chartInteractionMode(presentation),
  );
}

function ChargingSeriesSource({ definition, ctx, height, settings, presentation, sessions }: ActiveDashboardChartSourceProps & { sessions?: boolean }) {
  const { data, isLoading } = useChargingChartSeries(ctx.vehicleId, ctx.from, ctx.to);
  const daily = data?.daily ?? [];
  if (sessions) {
    return (
      <ChargingSessionsChart
        definition={definition}
        daily={daily}
        dailySessions={data?.daily_sessions ?? []}
        loading={isLoading}
        height={height}
        interactionMode={chartInteractionMode(presentation)}
        selectedDayLocal={ctx.chargeSessionDayLocal ?? null}
        {...(ctx.setChargeSessionDayLocal ? { onDayClick: ctx.setChargeSessionDayLocal } : {})}
      />
    );
  }
  const { yRange } = sourceAxisRanges(settings);
  return <DailyEnergyChart definition={definition} daily={daily} loading={isLoading} height={height} interactionMode={chartInteractionMode(presentation)} {...(yRange ? { yRange } : {})} />;
}

function ChargeSessionCurveSource({ definition, ctx, height, timeFilter, smoothness, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useChargeCurve(ctx.chargeSessionId ?? null, ctx.vehicleId);
  const { yRange, yRightRange } = sourceAxisRanges(settings);
  return (
    <ChargeSessionCurveChart
      definition={definition}
      data={data}
      loading={isLoading}
      height={height}
      timeFilter={timeFilter}
      smoothness={smoothness}
      startedAt={ctx.from || null}
      sessionEnergyKwh={ctx.chargeSessionEnergyKwh ?? null}
      interactionMode={chartInteractionMode(presentation)}
      {...(yRange ? { yRange } : {})}
      {...(yRightRange ? { yRightRange } : {})}
    />
  );
}

function ChargingCurveAnalysisSource({ definition, ctx, height, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useChargeCurveAnalysis(ctx.vehicleId, ctx.from, ctx.to);
  const { xRange, yRange } = sourceAxisRanges(settings);
  return <ChargingCurveAnalysisChart definition={definition} data={data} loading={isLoading} height={height} interactionMode={chartInteractionMode(presentation)} {...(xRange ? { xRange } : {})} {...(yRange ? { yRange } : {})} />;
}

function EfficiencyTrendSource({ definition, ctx, height, timeFilter, smoothness, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useEfficiencyTrend(ctx.vehicleId, ctx.from, ctx.to);
  const { yRange } = sourceAxisRanges(settings);
  return <EfficiencyTrendChart definition={definition} trend={data} loading={isLoading} height={height} timeFilter={timeFilter} smoothness={smoothness} interactionMode={chartInteractionMode(presentation)} {...(yRange ? { yRange } : {})} />;
}

function EfficiencyTemperatureSource({ definition, ctx, height }: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useEfficiencyVsTemp(ctx.vehicleId, ctx.from, ctx.to);
  return <EfficiencyTemperatureChart definition={definition} data={data} loading={isLoading} height={height} />;
}

function EfficiencyModeSource({ definition, ctx, height }: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useEfficiencyByMode(ctx.vehicleId, ctx.from, ctx.to);
  return <EfficiencyModeChart definition={definition} data={data} loading={isLoading} height={height} />;
}

function PhantomDrainSource({ definition, ctx, height, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data, isLoading } = usePhantomDrainPeriods(ctx.vehicleId, ctx.from, ctx.to, 500, 6);
  return <PhantomDrainChart periods={data?.periods ?? []} loading={isLoading} height={height} emptyTitle={definition.emptyTitle} yUnit={definition.yUnit} yRange={sourceAxisRanges(settings).yRange ?? definition.yRange} interactionMode={chartInteractionMode(presentation)} />;
}

function BatteryDegradationSource({ definition, ctx, height, timeFilter, smoothness, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useDegradation(ctx.vehicleId, ctx.from, ctx.to);
  return renderSingleChart(definition, height, isLoading, data.map((point) => ({ ts: point.ts, value: point.capacity_pct ?? null })), timeFilter, sourceAxisRanges(settings).yRange, chartInteractionMode(presentation), smoothness);
}

function mileagePoints(data: Awaited<ReturnType<typeof useBatteryMileage>>['data']) {
  return (data ?? []).map((point) => ({
    ts: point.ts,
    x: point.odometer_mi,
    y: point.usable_kwh,
    rangeMi: point.range_mi,
    projectedMaxRangeMi: point.projected_max_range_mi,
    degradationPct: point.degradation_pct,
  }));
}

function BatteryMileageSource({ definition, ctx, height, timeFilter, smoothness, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data, isLoading } = useBatteryMileage(ctx.vehicleId, ctx.from, ctx.to);
  const { yRange, yRightRange } = sourceAxisRanges(settings);
  return <BatteryCapacityMileageChart definition={definition} loading={isLoading} height={height} points={mileagePoints(data)} timeFilter={timeFilter} interactionMode={chartInteractionMode(presentation)} {...(yRange ? { yRange } : {})} {...(yRightRange ? { yRightRange } : {})} />;
}

function ProjectedRangeMileageSource({ definition, ctx, height, timeFilter, smoothness, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data, isLoading } = useBatteryMileage(ctx.vehicleId, ctx.from, ctx.to);
  const { yRange, yRightRange } = sourceAxisRanges(settings);
  return <ProjectedRangeMileageChart definition={definition} loading={isLoading} height={height} points={mileagePoints(data)} timeFilter={timeFilter} interactionMode={chartInteractionMode(presentation)} {...(yRange ? { yRange } : {})} {...(yRightRange ? { yRightRange } : {})} />;
}

function renderSocHistoryChart(
  definition: DashboardChartDefinition,
  height: number,
  loading: boolean,
  soc: Array<{ ts: string; value: number | null }>,
  range: Array<{ ts: string; value: number | null }>,
  timeFilter: TimeFilterWindow = 'raw',
  smoothness: CurveSmoothness = DEFAULT_CURVE_SMOOTHNESS,
  manualYRange?: [number, number],
  interactionMode: 'standard' | 'touch-explore' = 'standard',
) {
  const rangeByTimestamp = new Map(range.map((point) => [point.ts, point.value]));

  return (
    <RichTimeSeriesChart
      points={soc.map((point) => ({ ts: point.ts }))}
      series={[
        {
          key: definition.id,
          label: definition.title,
          values: soc.map((point) => point.value),
          mode: definition.mode ?? 'line',
        },
        {
          key: `${definition.id}-active-range`,
          label: 'Active Range',
          values: soc.map((point) => rangeByTimestamp.get(point.ts) ?? null),
          tooltipOnly: true,
          tooltipFormatter: formatMiles,
        },
      ]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      yRange={manualYRange ?? definition.yRange}
      stepInterpolation={definition.stepInterpolation}
      mode={definition.mode}
      timeFilter={timeFilter}
      smoothness={smoothness}
      interactionMode={interactionMode}
    />
  );
}

function renderSingleChart(
  definition: DashboardChartDefinition,
  height: number,
  loading: boolean,
  data: Array<{ ts: string; value: number | null }>,
  timeFilter: TimeFilterWindow = 'raw',
  manualYRange?: [number, number],
  interactionMode: 'standard' | 'touch-explore' = 'standard',
  smoothness: CurveSmoothness = DEFAULT_CURVE_SMOOTHNESS,
) {
  return (
    <RichTimeSeriesChart
      points={data.map((point) => ({ ts: point.ts }))}
      series={[{ key: definition.id, label: definition.title, values: data.map((point) => point.value) }]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      yRange={manualYRange ?? definition.yRange}
      stepInterpolation={definition.stepInterpolation}
      mode={definition.mode}
      timeFilter={timeFilter}
      smoothness={smoothness}
      interactionMode={interactionMode}
    />
  );
}

function ChargingSessionsChart({
  definition,
  daily,
  dailySessions,
  loading,
  height,
  selectedDayLocal,
  onDayClick,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  daily: Array<{ day_local: string; day_start: string; total_energy_kwh: number; session_count: number }>;
  dailySessions: Array<{
    session_id: string;
    day_local: string;
    day_start: string;
    started_at: string;
    energy_added_kwh: number | null;
    cost_usd: number | null;
    charger_type: string | null;
    location_name: string | null;
  }>;
  loading: boolean;
  height: number;
  selectedDayLocal?: string | null;
  onDayClick?: (dayLocal: string | null) => void;
  interactionMode: 'standard' | 'touch-explore';
}) {
  return (
    <DailyChargeSessionsChart
      daily={daily}
      dailySessions={dailySessions}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      interactionMode={interactionMode}
      {...(selectedDayLocal !== undefined ? { selectedDayLocal } : {})}
      {...(onDayClick ? { onDayClick } : {})}
    />
  );
}

function ChargeSessionCurveChart({
  definition,
  data,
  loading,
  height,
  timeFilter,
  smoothness,
  startedAt,
  sessionEnergyKwh,
  yRange,
  yRightRange,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  data: ChargeCurvePoint[];
  loading: boolean;
  height: number;
  timeFilter: TimeFilterWindow;
  smoothness: CurveSmoothness;
  startedAt: string | null;
  sessionEnergyKwh: number | null;
  yRange?: [number, number];
  yRightRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
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
          filterable: false,
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
      yRange={yRange}
      yRightRange={yRightRange}
      mode="line"
      xValueFormatter={useTime ? undefined : (value) => `${Math.round(value)}%`}
      xSplits={xSplits}
      timeFilter={timeFilter}
      smoothness={smoothness}
      interactionMode={interactionMode}
    />
  );
}

function ChargingCurveAnalysisChart({
  definition,
  data,
  loading,
  height,
  xRange,
  yRange,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  data: ChargeCurveAnalysisPoint[];
  loading: boolean;
  height: number;
  xRange?: [number, number];
  yRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
}) {
  const [mode, setMode] = React.useState<ChargeCurveMode>('observed');
  const [isMobile, setIsMobile] = React.useState(isMobileViewport);
  const plot = React.useMemo(() => buildChargeCurvePlot(data, mode), [data, mode]);

  React.useEffect(() => {
    const mediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 639px)')
      : null;
    const update = () => setIsMobile(mediaQuery?.matches ?? false);
    update();
    mediaQuery?.addEventListener?.('change', update);
    mediaQuery?.addListener?.(update);
    return () => {
      mediaQuery?.removeEventListener?.('change', update);
      mediaQuery?.removeListener?.(update);
    };
  }, []);

  const nextMode = nextChargeCurveMode(mode);
  const nextModeLabel = chargeCurveModeLabel(nextMode);

  return (
    <div className="relative h-full min-h-0">
      <RichTimeSeriesChart
        points={plot.rows.map((row) => ({ ts: row.plotSoc }))}
        series={[
          ...buildChargeCurveScatterSeries(plot.rows),
          ...(plot.hasEstimatedHistory ? [{
            key: 'dc-estimated-history',
            label: 'Estimated history',
            color: CHART_COLORS.amber,
            mode: 'scatter' as const,
            values: plot.rows.map((row) => row.estimatedKw),
            tooltipDetails: plot.rows.map((row) => row.estimatedDetail),
            pointSize: 6,
          }] : []),
          ...(mode === 'off' ? [] : [{
            key: 'dc-summary',
            label: mode === 'observed' ? 'Observed trend' : 'Best observed trend (P75)',
            color: CHART_COLORS.orange,
            mode: 'line' as const,
            values: plot.rows.map((row) => row.summaryKw),
            tooltipDetails: plot.rows.map((row) => row.summaryDetail),
          }] as const),
        ]}
        loading={loading}
        emptyTitle={definition.emptyTitle}
        height={height}
        xTime={false}
        xUnit="%"
        yUnit="kW"
        xRange={xRange ?? [0, 100]}
        yRange={yRange}
        mode="scatter"
        connectGaps
        xSplits={isMobile ? [0, 20, 40, 60, 80, 100] : [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
        xValueFormatter={(value) => `${Math.round(value)}%`}
        interactionMode={interactionMode}
      />
      <button
        type="button"
        aria-label={`Switch to ${nextModeLabel}`}
        title={`Switch to ${nextModeLabel}`}
        onClick={() => setMode(nextMode)}
        className="absolute right-3 top-3 z-10 rounded-md border border-border bg-bg-surface/95 px-2.5 py-1.5 text-xs font-medium text-fg shadow-sm transition-colors hover:bg-bg-elevated"
      >
        Trend: {chargeCurveModeLabel(mode)}
      </button>
    </div>
  );
}

type ChargeCurveMode = 'off' | 'observed' | 'best-observed';

type ChargeCurvePlotRow = {
  socPct: number;
  plotSoc: number;
  observedKw: number | null;
  observedDetail: string | null;
  estimatedKw: number | null;
  estimatedDetail: string | null;
  summaryKw: number | null;
  summaryDetail: string | null;
};

type CurvePoint = ChargeCurveAnalysisPoint & {
  soc_pct: number;
  charge_rate_kw: number;
  sample_source: 'telemetry' | 'telemetry_1min' | 'rivian_charge_curve_points';
  power_method: 'recorded' | 'soc_delta';
};

function normalizeSampleSource(value: unknown): CurvePoint['sample_source'] {
  const source = typeof value === 'string' ? value : '';
  if (source === 'rivian_charge_curve_points' || source === 'telemetry_1min') return source;
  return 'telemetry';
}

function buildChargeCurvePlot(data: ChargeCurveAnalysisPoint[], mode: ChargeCurveMode) {
  const points = data
    .filter((point): point is CurvePoint =>
      Number.isFinite(point.soc_pct) &&
      Number.isFinite(point.charge_rate_kw) &&
      point.charge_rate_kw > 0 &&
      normalizeChargeCurveType(point.charger_type) === 'dc'
    )
    .map((point) => ({
      ...point,
      sample_source: normalizeSampleSource(point.sample_source),
      power_method: point.power_method === 'recorded' ? 'recorded' as const : 'soc_delta' as const,
    }));

  if (points.length === 0) {
    return { rows: [] as ChargeCurvePlotRow[], hasEstimatedHistory: false };
  }

  const observed = points.filter((point) => point.sample_source !== 'rivian_charge_curve_points');
  const estimated = points.filter((point) => point.sample_source === 'rivian_charge_curve_points');
  const rows: ChargeCurvePlotRow[] = [
    ...observed.map((point) => ({
      socPct: point.soc_pct,
      plotSoc: point.soc_pct,
      observedKw: point.charge_rate_kw,
      observedDetail: `${formatExactSoc(point.soc_pct)} SoC; ${powerMethodLabel([point])}`,
      estimatedKw: null,
      estimatedDetail: null,
      summaryKw: null,
      summaryDetail: null,
    })),
    ...estimated.map((point) => ({
      socPct: point.soc_pct,
      plotSoc: point.soc_pct,
      observedKw: null,
      observedDetail: null,
      estimatedKw: point.charge_rate_kw,
      estimatedDetail: `${formatExactSoc(point.soc_pct)} SoC; Recorded kW; estimated SoC (excluded from summaries)`,
      summaryKw: null,
      summaryDetail: null,
    })),
    ...buildChargeCurveRegression(observed, mode).map((trend) => {
      return {
        socPct: trend.socPct,
        plotSoc: trend.socPct,
        observedKw: null,
        observedDetail: null,
        estimatedKw: null,
        estimatedDetail: null,
        summaryKw: trend.powerKw,
        summaryDetail: `${formatExactSoc(trend.socPct)} SoC; ${trend.sampleCount} nearby samples; ${mode === 'best-observed' ? 'local upper-quartile regression' : 'local weighted regression'}`,
      };
    }),
  ];

  return { rows: distributeChargeCurveSoc(rows), hasEstimatedHistory: estimated.length > 0 };
}

const CHARGE_CURVE_REGRESSION_RADIUS_SOC = 8;

function buildChargeCurveRegression(points: CurvePoint[], mode: ChargeCurveMode) {
  if (points.length < 3) return [];
  const minSoc = Math.ceil(Math.min(...points.map((point) => point.soc_pct)));
  const maxSoc = Math.floor(Math.max(...points.map((point) => point.soc_pct)));
  const trend: Array<{ socPct: number; powerKw: number; sampleCount: number }> = [];

  for (let socPct = minSoc; socPct <= maxSoc; socPct += 1) {
    const nearby = points
      .map((point) => {
        const distance = Math.abs(point.soc_pct - socPct);
        const normalizedDistance = distance / CHARGE_CURVE_REGRESSION_RADIUS_SOC;
        return { x: point.soc_pct, y: point.charge_rate_kw, weight: (1 - normalizedDistance ** 3) ** 3 };
      })
      .filter((point) => point.weight > 0);
    if (nearby.length < 3) continue;

    const regressionPoints = mode === 'best-observed'
      ? nearby.filter((point) => point.y >= weightedPercentile(nearby, 0.75))
      : nearby;
    const powerKw = weightedLinearPrediction(regressionPoints, socPct);
    if (powerKw == null) continue;
    trend.push({ socPct, powerKw, sampleCount: regressionPoints.length });
  }

  return trend;
}

function weightedLinearPrediction(points: Array<{ x: number; y: number; weight: number }>, atX: number) {
  if (points.length === 0) return null;
  const sums = points.reduce<{ weight: number; x: number; y: number; xx: number; xy: number }>(
    (total, point) => ({
      weight: total.weight + point.weight,
      x: total.x + point.weight * point.x,
      y: total.y + point.weight * point.y,
      xx: total.xx + point.weight * point.x * point.x,
      xy: total.xy + point.weight * point.x * point.y,
    }),
    { weight: 0, x: 0, y: 0, xx: 0, xy: 0 },
  );
  if (sums.weight === 0) return null;
  const denominator = sums.weight * sums.xx - sums.x ** 2;
  if (Math.abs(denominator) < Number.EPSILON) return Math.max(0, sums.y / sums.weight);
  const slope = (sums.weight * sums.xy - sums.x * sums.y) / denominator;
  const intercept = (sums.y - slope * sums.x) / sums.weight;
  return Math.max(0, intercept + slope * atX);
}

function weightedPercentile(points: Array<{ y: number; weight: number }>, quantile: number) {
  const sorted = [...points].sort((left, right) => left.y - right.y);
  const target = sorted.reduce((total, point) => total + point.weight, 0) * quantile;
  let cumulative = 0;
  for (const point of sorted) {
    cumulative += point.weight;
    if (cumulative >= target) return point.y;
  }
  return sorted.at(-1)?.y ?? 0;
}

function distributeChargeCurveSoc(rows: ChargeCurvePlotRow[]) {
  const sorted = [...rows].sort((left, right) => left.socPct - right.socPct);
  const result: ChargeCurvePlotRow[] = [];
  for (let index = 0; index < sorted.length;) {
    let end = index + 1;
    while (end < sorted.length && sorted[end]!.socPct === sorted[index]!.socPct) end += 1;
    const group = sorted.slice(index, end);
    const offset = Math.min(0.04, 0.2 / group.length);
    group.forEach((row, rowIndex) => {
      result.push({ ...row, plotSoc: row.socPct + (rowIndex - (group.length - 1) / 2) * offset });
    });
    index = end;
  }
  return result;
}

function formatExactSoc(soc: number) {
  return Number.isInteger(soc) ? String(soc) : soc.toFixed(1).replace(/\.0$/, '');
}

function nextChargeCurveMode(mode: ChargeCurveMode): ChargeCurveMode {
  if (mode === 'observed') return 'best-observed';
  if (mode === 'best-observed') return 'off';
  return 'observed';
}

function chargeCurveModeLabel(mode: ChargeCurveMode) {
  if (mode === 'best-observed') return 'Best observed';
  if (mode === 'off') return 'Off';
  return 'Observed';
}

const CHARGE_CURVE_SCATTER_BUCKETS = 6;

function buildChargeCurveScatterSeries(rows: ChargeCurvePlotRow[]) {
  const values = rows
    .map((row) => row.observedKw)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const low = Math.min(...values);
  const high = Math.max(...values);

  return Array.from({ length: CHARGE_CURVE_SCATTER_BUCKETS }, (_, bucket) => ({
    key: `dc-observed-samples-${bucket}`,
    label: 'Verified DC sessions',
    color: interpolateHexColor(CHART_COLORS.accent, CHART_COLORS.emerald, bucket / (CHARGE_CURVE_SCATTER_BUCKETS - 1)),
    mode: 'scatter' as const,
    showInLegend: false,
    pointSize: 6,
    values: rows.map((row) => chargeCurvePowerBucket(row.observedKw, low, high) === bucket ? row.observedKw : null),
    tooltipDetails: rows.map((row) => chargeCurvePowerBucket(row.observedKw, low, high) === bucket ? row.observedDetail : null),
  }));
}

function chargeCurvePowerBucket(value: number | null, low: number, high: number) {
  if (value == null || !Number.isFinite(value)) return -1;
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return CHARGE_CURVE_SCATTER_BUCKETS - 1;
  return Math.min(CHARGE_CURVE_SCATTER_BUCKETS - 1, Math.floor(((value - low) / (high - low)) * CHARGE_CURVE_SCATTER_BUCKETS));
}

function interpolateHexColor(start: string, end: string, ratio: number) {
  const parse = (color: string) => [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const [startRed, startGreen, startBlue] = parse(start);
  const [endRed, endGreen, endBlue] = parse(end);
  const channel = (from: number, to: number) => Math.round(from + (to - from) * ratio).toString(16).padStart(2, '0');
  return `#${channel(startRed!, endRed!)}${channel(startGreen!, endGreen!)}${channel(startBlue!, endBlue!)}`;
}

function powerMethodLabel(points: CurvePoint[]) {
  const methods = new Set(points.map((point) => point.power_method));
  if (methods.size === 1 && methods.has('recorded')) return 'Recorded kW';
  if (methods.size === 1) return 'SoC/time estimate';
  return 'Recorded and SoC/time estimates';
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const ratio = position - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * ratio;
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
  yRange,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  daily: Array<{ day_local: string; day_start: string; total_energy_kwh: number; session_count: number }>;
  loading: boolean;
  height: number;
  yRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
}) {
  return (
    <DailyEnergyBarChart
      daily={daily}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yRange={yRange}
      interactionMode={interactionMode}
    />
  );
}

function EfficiencyTrendChart({
  definition,
  trend,
  loading,
  height,
  timeFilter,
  smoothness,
  yRange,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  trend: Array<{ ts: string; trip_efficiency_wh_mi: number | null; rolling_24h_wh_mi: number | null }>;
  loading: boolean;
  height: number;
  timeFilter: TimeFilterWindow;
  smoothness: CurveSmoothness;
  yRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
}) {
  const unit = getEfficiencyUnit();
  return (
    <RichTimeSeriesChart
      points={trend.map((point) => ({ ts: point.ts }))}
      series={[
        { key: 'trip', label: 'Trip efficiency', values: trend.map((point) => convertEfficiency(point.trip_efficiency_wh_mi)) },
        { key: 'rolling', label: '24-hour avg', values: trend.map((point) => convertEfficiency(point.rolling_24h_wh_mi)) },
      ]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={unit}
      yRange={yRange}
      mode={definition.mode}
      timeFilter={timeFilter}
      smoothness={smoothness}
      interactionMode={interactionMode}
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
  timeFilter,
  yRange,
  yRightRange,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  points: Array<{ ts: string; x: number | null; y: number | null; degradationPct: number | null }>;
  loading: boolean;
  height: number;
  timeFilter: TimeFilterWindow;
  yRange?: [number, number];
  yRightRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
}) {
  const rows = points
    .filter((point) => point.x != null || point.y != null)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const yValues = rows
    .map((point) => point.y)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const yPrecision = getBatteryCapacityMileagePrecision(yValues);
  const autoYRange = getBatteryCapacityMileageYRange(yValues);

  return (
    <RichTimeSeriesChart
      points={rows.map((point) => ({ ts: point.ts }))}
      series={[
        {
          key: 'usable-capacity',
          label: 'Usable Capacity',
          color: CHART_COLORS.accent,
          mode: 'area',
          values: rows.map((point) => point.y),
        },
        {
          key: 'odometer-mi',
          label: 'Mileage',
          color: CHART_COLORS.emerald,
          mode: 'line',
          values: rows.map((point) => point.x),
          yScale: 'y2',
          filterable: false,
        },
      ]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      yRange={yRange ?? autoYRange ?? definition.yRange}
      yRightUnit="mi"
      yRightRange={yRightRange}
      mode={definition.mode}
      timeFilter={timeFilter}
      connectGaps
      yAxisValueFormatter={(value, unit) => formatChartNumber(value, unit, 0)}
      yRightAxisValueFormatter={(value, unit) => formatChartNumber(value, unit, 0)}
      yValueFormatter={(value, unit) => formatChartNumber(value, unit, yPrecision)}
      interactionMode={interactionMode}
    />
  );
}

export function getBatteryCapacityMileageYRange(values: Array<number | null | undefined>) {
  const populated = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (populated.length === 0) return undefined;

  const max = Math.max(...populated);
  return [0, max > 0 ? Math.ceil(max * 1.1) : 1] as [number, number];
}

function ProjectedRangeMileageChart({
  definition,
  points,
  loading,
  height,
  timeFilter,
  yRange: manualYRange,
  yRightRange,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  points: Array<{ ts: string; rangeMi: number | null; projectedMaxRangeMi: number | null; x: number | null }>;
  loading: boolean;
  height: number;
  timeFilter: TimeFilterWindow;
  yRange?: [number, number];
  yRightRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
}) {
  const rows = points
    .filter((point) => point.x != null)
    .map((point) => ({
      ts: point.ts,
      projectedRangeMi: point.projectedMaxRangeMi ?? point.rangeMi,
      odometerMi: point.x,
    }))
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const yRange = manualYRange ?? getProjectedRangeMileageYRange(rows.map((point) => point.projectedRangeMi));

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
          filterable: false,
        },
      ]}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={definition.yUnit}
      yRange={yRange}
      yRightUnit="mi"
      yRightRange={yRightRange}
      mode={definition.mode}
      timeFilter={timeFilter}
      interactionMode={interactionMode}
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

function getBatteryCapacityMileagePrecision(values: number[]) {
  if (!shouldUseBatteryCapacityMileageDecimals(values)) return 0;
  return Math.max(1, getAdaptiveDecimalPrecision(values));
}

function shouldUseBatteryCapacityMileageDecimals(values: number[]) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length < 2) return false;

  const roundedWholeValues = new Set(finiteValues.map((value) => Math.round(value)));
  const distinctValues = new Set(finiteValues.map((value) => value.toFixed(4)));
  return roundedWholeValues.size < distinctValues.size;
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

function legacySmoothingToTimeFilter(value: unknown): TimeFilterWindow {
  if (value === false || value === 0) return 'raw';
  return DEFAULT_CHART_TIME_FILTER;
}

function normalizeChartSettingsMap(value: unknown): Record<string, DashboardChartDisplaySettings> {
  if (!value || typeof value !== 'object') return {};

  const entries = Object.entries(value as Record<string, unknown>);
  const result: Record<string, DashboardChartDisplaySettings> = {};
  for (const [chartId, chartSettings] of entries) {
    const normalized = normalizeChartDisplaySettings(chartSettings);
    if (normalized && chartId === normalizeChartId(chartId)) {
      result[chartId] = normalized;
    }
  }
  for (const [chartId, chartSettings] of entries) {
    const normalized = normalizeChartDisplaySettings(chartSettings);
    const normalizedChartId = normalizeChartId(chartId);
    if (normalized && !(normalizedChartId in result)) {
      result[normalizedChartId] = normalized;
    }
  }
  return result;
}

function normalizeChartDisplaySettings(value: unknown): DashboardChartDisplaySettings | null {
  if (!value || typeof value !== 'object') return null;

  const settings = value as Record<string, unknown>;
  const normalizedAxes = normalizeChartAxisSettingsMap(settings.axes);
  const normalized: DashboardChartDisplaySettings = {};

  if ('timeFilter' in settings) {
    normalized.timeFilter = normalizeTimeFilter(settings.timeFilter, DEFAULT_CHART_TIME_FILTER);
  } else if ('smoothing' in settings && typeof settings.smoothing === 'number') {
    normalized.smoothing = settings.smoothing;
  }
  if ('smoothness' in settings) {
    normalized.smoothness = normalizeCurveSmoothness(settings.smoothness);
  }
  if (Object.keys(normalizedAxes).length > 0) {
    normalized.axes = normalizedAxes;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeChartAxisSettingsMap(value: unknown): Partial<Record<DashboardChartAxisId, DashboardChartAxisRangeSetting>> {
  if (!value || typeof value !== 'object') return {};

  const result: Partial<Record<DashboardChartAxisId, DashboardChartAxisRangeSetting>> = {};
  for (const [key, axisSettings] of Object.entries(value as Record<string, unknown>)) {
    if (!AXIS_ORDER.includes(key as DashboardChartAxisId)) continue;
    const normalized = normalizeChartAxisRangeSetting(axisSettings);
    if (normalized) {
      result[key as DashboardChartAxisId] = normalized;
    }
  }

  return result;
}

function normalizeChartAxisRangeSetting(value: unknown): DashboardChartAxisRangeSetting | null {
  if (!value || typeof value !== 'object') return null;

  const settings = value as Record<string, unknown>;
  const mode = settings.mode === 'manual' ? 'manual' : settings.mode === 'auto' ? 'auto' : undefined;
  const min = typeof settings.min === 'number' && Number.isFinite(settings.min) ? settings.min : undefined;
  const max = typeof settings.max === 'number' && Number.isFinite(settings.max) ? settings.max : undefined;

  if (!mode && min == null && max == null) return null;
  return { ...(mode ? { mode } : {}), ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) };
}

function resolveChartDisplaySettings(
  allSettings: Record<string, DashboardChartDisplaySettings>,
  chartId: string,
  legacyTimeFilter: TimeFilterWindow,
  legacySmoothness: CurveSmoothness,
) {
  const chartSettings = allSettings[chartId] ?? {};
  const axes = chartSettings.axes ?? {};
  return {
    timeFilter: chartSettings.timeFilter ?? (
      chartSettings.smoothing == null
        ? legacyTimeFilter
        : legacySmoothingToTimeFilter(chartSettings.smoothing)
    ),
    axes,
    smoothness: chartSettings.smoothness ?? normalizeCurveSmoothness(chartSettings.smoothing, legacySmoothness),
  };
}

function setChartSettingsEntry(
  current: Record<string, DashboardChartDisplaySettings>,
  chartId: string,
  chartSettings: DashboardChartDisplaySettings,
) {
  const normalized = normalizeChartDisplaySettings(chartSettings);
  if (!normalized) {
    const rest = { ...current };
    delete rest[chartId];
    return rest;
  }
  return {
    ...current,
    [chartId]: normalized,
  };
}

function getManualAxisRange(setting: DashboardChartAxisRangeSetting | undefined) {
  if (!setting || setting.mode !== 'manual') return undefined;
  if (typeof setting.min !== 'number' || typeof setting.max !== 'number') return undefined;
  if (!Number.isFinite(setting.min) || !Number.isFinite(setting.max)) return undefined;
  if (setting.min >= setting.max) return undefined;
  return [setting.min, setting.max] as [number, number];
}

function isMobileViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(max-width: 639px)').matches;
}

interface ChartSettingsPanelProps {
  open: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  chartTitle: string;
  capabilities: DashboardChartSettingsCapabilities;
  settings: DashboardChartDisplaySettings & { timeFilter: TimeFilterWindow; axes: Partial<Record<DashboardChartAxisId, DashboardChartAxisRangeSetting>> };
  persistent: boolean;
  onClose: () => void;
  onTimeFilterChange: (next: TimeFilterWindow) => void;
  onSmoothnessChange: (next: CurveSmoothness) => void;
  onAxisModeChange: (axisId: DashboardChartAxisId, mode: DashboardChartAxisMode) => void;
  onAxisValueChange: (axisId: DashboardChartAxisId, bound: 'min' | 'max', value: number | undefined) => void;
}

function ChartSettingsPanel({
  open,
  triggerRef,
  chartTitle,
  capabilities,
  settings,
  persistent,
  onClose,
  onTimeFilterChange,
  onSmoothnessChange,
  onAxisModeChange,
  onAxisValueChange,
}: ChartSettingsPanelProps) {
  const [isMobile, setIsMobile] = React.useState(isMobileViewport);
  const [position, setPosition] = React.useState({ top: 0, left: 0, visibility: 'hidden' as 'hidden' | 'visible' });
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const timeFilterIndex = Math.max(0, TIME_FILTER_OPTIONS.findIndex((option) => option.value === settings.timeFilter));
  const smoothnessIndex = Math.max(0, CURVE_SMOOTHNESS_OPTIONS.findIndex((option) => option.value === (settings.smoothness ?? DEFAULT_CURVE_SMOOTHNESS)));
  const axisEntries = AXIS_ORDER.flatMap((axisId) =>
    capabilities.axes[axisId] ? [[axisId, capabilities.axes[axisId]] as const] : [],
  );
  const hasControls = capabilities.timeFilter || capabilities.smoothness === true || axisEntries.length > 0;

  React.useEffect(() => {
    const mediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 639px)')
      : null;
    const handleViewportChange = () => setIsMobile(mediaQuery ? mediaQuery.matches : false);
    handleViewportChange();
    mediaQuery?.addEventListener?.('change', handleViewportChange);
    mediaQuery?.addListener?.(handleViewportChange);
    return () => {
      mediaQuery?.removeEventListener?.('change', handleViewportChange);
      mediaQuery?.removeListener?.(handleViewportChange);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, triggerRef]);

  React.useLayoutEffect(() => {
    if (!open || isMobile) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;

      const gap = 8;
      const padding = 8;
      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let top = triggerRect.bottom + gap;
      if (top + panelRect.height > viewportHeight - padding) {
        top = triggerRect.top - panelRect.height - gap;
      }
      top = Math.min(Math.max(top, padding), Math.max(padding, viewportHeight - padding - panelRect.height));

      let left = triggerRect.right - panelRect.width;
      left = Math.min(Math.max(left, padding), Math.max(padding, viewportWidth - padding - panelRect.width));

      setPosition({ top, left, visibility: 'visible' });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isMobile, open, triggerRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <>
      {isMobile ? (
        <button
          type="button"
          aria-label="Close chart settings"
          className="fixed inset-0 z-40 bg-bg-page/70 backdrop-blur-sm"
          onClick={onClose}
        />
      ) : null}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Chart settings"
        className={cn(
          'fixed z-50 overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-xl',
          isMobile ? 'inset-x-2 bottom-2 max-h-[calc(100vh-1rem)] w-auto' : 'w-[min(22rem,calc(100vw-1rem))]',
        )}
        style={
          isMobile
            ? { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)' }
            : { top: position.top, left: position.left, visibility: position.visibility }
        }
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Chart settings</p>
            <h3 className="truncate text-sm font-semibold text-fg">{chartTitle}</h3>
          </div>
          <button
            type="button"
            aria-label="Close chart settings"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-3 p-3">
          {capabilities.timeFilter ? (
            <section className="grid gap-2 rounded-xl border border-border bg-bg-elevated/50 p-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Display filter</p>
                <p className="text-sm text-fg">Time window</p>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-fg-tertiary">
                  <span>Raw points stay at their recorded timestamps.</span>
                  <span>{timeFilterLabel(settings.timeFilter)}</span>
                </div>
                <input
                  aria-label="Display filter"
                  type="range"
                  min={0}
                  max={TIME_FILTER_OPTIONS.length - 1}
                  step={1}
                  value={timeFilterIndex}
                  onChange={(event) => onTimeFilterChange(TIME_FILTER_OPTIONS[Number(event.target.value)]!.value)}
                  className="rm-accent-range w-full"
                />
              </div>
            </section>
          ) : null}
          {capabilities.smoothness ? (
            <section className="grid gap-2 rounded-xl border border-border bg-bg-elevated/50 p-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Curve smoothness</p>
                <p className="text-sm text-fg">Path between recorded points</p>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-fg-tertiary">
                  <span>Values and timestamps stay unchanged.</span>
                  <span>{curveSmoothnessLabel(settings.smoothness ?? DEFAULT_CURVE_SMOOTHNESS)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={CURVE_SMOOTHNESS_OPTIONS.length - 1}
                  step={1}
                  value={smoothnessIndex}
                  onChange={(event) => onSmoothnessChange(CURVE_SMOOTHNESS_OPTIONS[Number(event.target.value)]!.value)}
                  className="rm-accent-range w-full"
                  aria-label="Curve smoothness"
                />
              </div>
            </section>
          ) : null}
          {axisEntries.length > 0 ? (
            <section className="grid gap-2 rounded-xl border border-border bg-bg-elevated/50 p-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Axes</p>
                <p className="text-sm text-fg">Auto or manual range per supported axis.</p>
              </div>
              <div className="grid gap-2">
                {axisEntries.map(([axisId, capability]) => (
                  <ChartAxisRangeField
                    key={axisId}
                    axisId={axisId}
                    capability={capability}
                    setting={settings.axes[axisId]}
                    onModeChange={onAxisModeChange}
                    onValueChange={onAxisValueChange}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {!hasControls ? (
            <div className="rounded-xl border border-border bg-bg-elevated/50 px-3 py-4 text-sm text-fg-secondary">
              This chart does not expose shared display controls yet.
            </div>
          ) : null}
          {!persistent && hasControls ? (
            <p className="text-[11px] text-fg-tertiary">
              Preview only while viewing. Save chart settings from dashboard edit mode.
            </p>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

function ChartAxisRangeField({
  axisId,
  capability,
  setting,
  onModeChange,
  onValueChange,
}: {
  axisId: DashboardChartAxisId;
  capability: DashboardChartAxisCapability;
  setting: DashboardChartAxisRangeSetting | undefined;
  onModeChange: (axisId: DashboardChartAxisId, mode: DashboardChartAxisMode) => void;
  onValueChange: (axisId: DashboardChartAxisId, bound: 'min' | 'max', value: number | undefined) => void;
}) {
  const mode = setting?.mode === 'manual' ? 'manual' : 'auto';
  const hasValidRange = Boolean(getManualAxisRange(setting));

  return (
    <div className="rounded-lg border border-border bg-bg-surface/70 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg">
          {capability.label}
          {capability.unit ? <span className="ml-1 text-fg-tertiary">({capability.unit})</span> : null}
        </p>
        <div className="inline-flex rounded-lg border border-border bg-bg-elevated p-0.5">
          {(['auto', 'manual'] as const).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              onClick={() => onModeChange(axisId, nextMode)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                mode === nextMode ? 'bg-accent text-fg-on-accent' : 'text-fg-secondary hover:text-fg',
              )}
            >
              {nextMode === 'auto' ? 'Auto' : 'Manual'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'manual' ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium text-fg-secondary">
            <span>Min</span>
            <input
              aria-label={`${capability.label} minimum`}
              type="number"
              inputMode="decimal"
              step={getAxisInputStep(capability.unit)}
              value={setting?.min ?? ''}
              onChange={(event) => onValueChange(axisId, 'min', parseAxisInputValue(event.target.value))}
              className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-fg-secondary">
            <span>Max</span>
            <input
              aria-label={`${capability.label} maximum`}
              type="number"
              inputMode="decimal"
              step={getAxisInputStep(capability.unit)}
              value={setting?.max ?? ''}
              onChange={(event) => onValueChange(axisId, 'max', parseAxisInputValue(event.target.value))}
              className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          {!hasValidRange ? (
            <p className="text-[11px] text-fg-tertiary sm:col-span-2">
              Manual range applies after both values are valid and max is greater than min.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getAxisInputStep(unit: string | undefined) {
  return unit === '%' || unit === 'mi' ? 1 : 0.1;
}

function parseAxisInputValue(value: string) {
  if (!value.trim()) return undefined;
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
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
    timeFilter: DEFAULT_CHART_TIME_FILTER,
  },
  component: DashboardChartWidget,
});
