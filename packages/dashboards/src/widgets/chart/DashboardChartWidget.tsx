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
  DEFAULT_CHART_TIME_FILTER,
  DailyChargeSessionsChart,
  DailyEnergyBarChart,
  EfficiencyPillBarChart,
  formatChartNumber,
  getAdaptiveDecimalPrecision,
  normalizeTimeFilter,
  RichTimeSeriesChart,
  TIME_FILTER_OPTIONS,
  timeFilterLabel,
  type TimeFilterWindow,
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
  const activeCapabilities = activeChartDefinition ? getChartSettingsCapabilities(activeChartDefinition) : EMPTY_CAPABILITIES;
  const activeSettings = resolveChartDisplaySettings(draftChartSettings, activeChartId, options.legacyTimeFilter);
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

function SocHistorySource({ definition, ctx, height, timeFilter, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data: soc = [], isLoading: socLoading } = useSocHistory(ctx.vehicleId, ctx.from, ctx.to);
  const { data: range = [], isLoading: rangeLoading } = useRangeHistory(ctx.vehicleId, ctx.from, ctx.to);
  return renderSocHistoryChart(
    definition,
    height,
    socLoading || rangeLoading,
    soc.map((point) => ({ ts: point.ts, value: point.value })),
    range.map((point) => ({ ts: point.ts, value: point.value })),
    timeFilter,
    sourceAxisRanges(settings).yRange,
    chartInteractionMode(presentation),
  );
}

function ChargingSeriesSource({ definition, ctx, height, settings, sessions }: ActiveDashboardChartSourceProps & { sessions?: boolean }) {
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
        selectedDayLocal={ctx.chargeSessionDayLocal ?? null}
        {...(ctx.setChargeSessionDayLocal ? { onDayClick: ctx.setChargeSessionDayLocal } : {})}
      />
    );
  }
  const { yRange } = sourceAxisRanges(settings);
  return <DailyEnergyChart definition={definition} daily={daily} loading={isLoading} height={height} {...(yRange ? { yRange } : {})} />;
}

function ChargeSessionCurveSource({ definition, ctx, height, timeFilter, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useChargeCurve(ctx.chargeSessionId ?? null, ctx.vehicleId);
  const { yRange, yRightRange } = sourceAxisRanges(settings);
  return (
    <ChargeSessionCurveChart
      definition={definition}
      data={data}
      loading={isLoading}
      height={height}
      timeFilter={timeFilter}
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

function EfficiencyTrendSource({ definition, ctx, height, timeFilter, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useEfficiencyTrend(ctx.vehicleId, ctx.from, ctx.to);
  const { yRange } = sourceAxisRanges(settings);
  return <EfficiencyTrendChart definition={definition} trend={data} loading={isLoading} height={height} timeFilter={timeFilter} interactionMode={chartInteractionMode(presentation)} {...(yRange ? { yRange } : {})} />;
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

function BatteryDegradationSource({ definition, ctx, height, timeFilter, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useDegradation(ctx.vehicleId, ctx.from, ctx.to);
  return renderSingleChart(definition, height, isLoading, data.map((point) => ({ ts: point.ts, value: point.capacity_pct ?? null })), timeFilter, sourceAxisRanges(settings).yRange, chartInteractionMode(presentation));
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

function BatteryMileageSource({ definition, ctx, height, settings, presentation }: ActiveDashboardChartSourceProps) {
  const { data, isLoading } = useBatteryMileage(ctx.vehicleId, ctx.from, ctx.to);
  const { xRange, yRange } = sourceAxisRanges(settings);
  return <BatteryCapacityMileageChart definition={definition} loading={isLoading} height={height} points={mileagePoints(data)} interactionMode={chartInteractionMode(presentation)} {...(xRange ? { xRange } : {})} {...(yRange ? { yRange } : {})} />;
}

function ProjectedRangeMileageSource({ definition, ctx, height, timeFilter, settings, presentation }: ActiveDashboardChartSourceProps) {
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
}) {
  return (
    <DailyChargeSessionsChart
      daily={daily}
      dailySessions={dailySessions}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
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
      xRange={xRange}
      yRange={yRange}
      mode="scatter"
      xValueFormatter={(value) => `${Math.round(value)}%`}
      interactionMode={interactionMode}
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
  yRange,
}: {
  definition: DashboardChartDefinition;
  daily: Array<{ day_local: string; day_start: string; total_energy_kwh: number; session_count: number }>;
  loading: boolean;
  height: number;
  yRange?: [number, number];
}) {
  return (
    <DailyEnergyBarChart
      daily={daily}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yRange={yRange}
    />
  );
}

function EfficiencyTrendChart({
  definition,
  trend,
  loading,
  height,
  timeFilter,
  yRange,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  trend: Array<{ ts: string; trip_efficiency_wh_mi: number | null; rolling_24h_wh_mi: number | null }>;
  loading: boolean;
  height: number;
  timeFilter: TimeFilterWindow;
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
  xRange,
  yRange,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  points: Array<{ x: number | null; y: number | null; degradationPct: number | null }>;
  loading: boolean;
  height: number;
  xRange?: [number, number];
  yRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
}) {
  const rows = points
    .filter((point): point is { x: number; y: number; degradationPct: number | null } => point.x != null && point.y != null)
    .sort((a, b) => a.x - b.x);
  const yValues = rows.map((point) => point.y);
  const yPrecision = getBatteryCapacityMileagePrecision(yValues);

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
      xRange={xRange}
      yRange={yRange ?? definition.yRange}
      mode="scatter"
      xValueFormatter={(value) => formatMiles(value).replace(/\s.*/, '')}
      yValueFormatter={(value, unit) => formatChartNumber(value, unit, yPrecision)}
      interactionMode={interactionMode}
    />
  );
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
  onAxisModeChange,
  onAxisValueChange,
}: ChartSettingsPanelProps) {
  const [isMobile, setIsMobile] = React.useState(isMobileViewport);
  const [position, setPosition] = React.useState({ top: 0, left: 0, visibility: 'hidden' as 'hidden' | 'visible' });
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const timeFilterIndex = Math.max(0, TIME_FILTER_OPTIONS.findIndex((option) => option.value === settings.timeFilter));
  const axisEntries = AXIS_ORDER.flatMap((axisId) =>
    capabilities.axes[axisId] ? [[axisId, capabilities.axes[axisId]] as const] : [],
  );
  const hasControls = capabilities.timeFilter || axisEntries.length > 0;

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
