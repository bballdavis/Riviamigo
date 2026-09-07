import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Maximize2, SlidersHorizontal, X } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import {
  useBatteryMileage,
  useChargeCurve,
  useChargeCurveAnalysis,
  useChargingChartSeries,
  useDegradation,
  useDashboardChartFavorites,
  useChartDatasets,
  useEffectiveCharts,
  useEfficiencyByMode,
  useEfficiencyByTag,
  useEfficiencyTrend,
  useEfficiencyVsTemp,
  usePhantomDrainPeriods,
  useRangeHistory,
  useSocHistory,
  useTirePressureTimeline,
  useTripTags,
  useUpdateDashboardChartFavorite,
  useVehicles,
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
  getChartColor,
  normalizeTimeFilter,
  curveSmoothnessLabel,
  normalizeCurveSmoothness,
  RichTimeSeriesChart,
  TirePressureTripsChart,
  TIME_FILTER_OPTIONS,
  timeFilterLabel,
  type TimeFilterWindow,
  type CurveSmoothness,
  type RichSeries,
} from '@riviamigo/ui/charts';
import { ChartPicker } from '@riviamigo/ui/primitives';
import { useDocumentTheme } from '@riviamigo/ui/hooks';
import { cn } from '@riviamigo/ui/lib/utils';
import { formatDriveMode } from '@riviamigo/ui/lib/driveMode';
import {
  formatMiles,
  formatTemp,
  getEfficiencyDisplay,
  getUnitSystem,
  getUnitPreferences,
  whPerMileToKmPerKwh,
  whPerMileToMiPerKwh,
  whPerMileToWhPerKm,
} from '@riviamigo/ui/lib/utils';
import { DEFAULT_TARGET_TIRE_PRESSURE_PSI } from '@riviamigo/ui/lib/vehicleTires';
import type { ChargeCurveAnalysisPoint, ChargeCurvePoint } from '@riviamigo/types';
import type { ChartDefinitionV1, ChartRecord } from '@riviamigo/types';
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
import { getChartRenderer } from '../../charts/rendererRegistry';
import { normalizeLegacyBundledChartRecord } from '../../charts/legacyBaseline';
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
  /** The widget keeps its layout, but its available charts come from the page catalog. */
  managed?: boolean;
  catalogMode?: 'assigned' | 'fixed' | 'legacy';
  requiredChartSlugs?: string[];
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

type DashboardChartResolvedAxisRanges = Partial<Record<'y' | 'y2', [number, number]>>;

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
  catalogMode: 'assigned' | 'fixed' | 'legacy';
  requiredChartSlugs: string[];
}

const LEGACY_CHART_ID_ALIASES: Record<string, string> = {
  'range-history': 'soc-history',
};

function normalizeChartId(chartId: string) {
  return LEGACY_CHART_ID_ALIASES[chartId] ?? chartId;
}

function chartDefaultStorageKey(ctx: WidgetCtx, instance: WidgetInstance) {
  const slug = ctx.dashboardSlug ?? 'dashboard';
  const dashboardId = ctx.dashboardConfigId;
  return dashboardId ? `${slug}:${dashboardId}:${instance.id}` : `${slug}:${instance.id}`;
}

function readOptions(instance: WidgetInstance): ResolvedDashboardChartOptions {
  const options = (instance.options ?? {}) as DashboardChartOptions;
  const managed = instance.managed === true || options.managed === true;
  const page = isDashboardChartPage(options.page) ? options.page : undefined;
  const catalogMode =
    options.catalogMode ?? (page ? 'assigned' : options.chartIds ? 'fixed' : managed ? 'assigned' : 'legacy');
  const pageDefinitions = getChartDefinitions(page);
  const validIds = new Set(pageDefinitions.map((definition) => definition.id));
  const chartIds = managed
    ? pageDefinitions.map((definition) => definition.id)
    : Array.isArray(options.chartIds)
      ? [
          ...new Set(
            options.chartIds
              .filter((id): id is string => typeof id === 'string')
              .map(normalizeChartId)
              .filter((id) => validIds.has(id))
          ),
        ]
      : [];
  const fallbackIds =
    chartIds.length > 0 ? chartIds : pageDefinitions.map((definition) => definition.id);
  const pageDefaultChartId = page === 'overview' ? 'projected-range-mileage' : undefined;
  const fallbackChartId =
    (pageDefaultChartId && fallbackIds.includes(pageDefaultChartId)
      ? pageDefaultChartId
      : fallbackIds[0]) ??
    getChartDefinitions()[0]?.id ??
    'soc-history';
  const configuredChartId =
    typeof options.chartId === 'string' ? normalizeChartId(options.chartId) : undefined;
  const chartId =
    configuredChartId && validIds.has(configuredChartId) ? configuredChartId : fallbackChartId;

  return {
    chartId,
    chartIds: fallbackIds,
    showPicker: options.showPicker ?? fallbackIds.length > 1,
    legacyTimeFilter: normalizeTimeFilter(
      options.timeFilter,
      legacySmoothingToTimeFilter(options.curveSmoothing)
    ),
    legacySmoothness: normalizeCurveSmoothness(
      options.smoothness,
      normalizeCurveSmoothness(options.curveSmoothing)
    ),
    chartSettings: normalizeChartSettingsMap(options.chartSettings),
    ...(page ? { page } : {}),
    ...(typeof options.headerSubtitle === 'string'
      ? { headerSubtitle: options.headerSubtitle }
      : {}),
    catalogMode,
    requiredChartSlugs: Array.isArray(options.requiredChartSlugs)
      ? options.requiredChartSlugs.filter((slug): slug is string => typeof slug === 'string')
      : [],
  };
}

const AXIS_ORDER: DashboardChartAxisId[] = ['x', 'y', 'y2'];
const EMPTY_CAPABILITIES: DashboardChartSettingsCapabilities = {
  timeFilter: false,
  axes: {},
  xDomainSource: 'dashboard-timeframe',
};

export function DashboardChartWidget({
  instance,
  ctx,
}: {
  instance: WidgetInstance;
  ctx: WidgetCtx;
}) {
  const options = readOptions(instance);
  const assignedPlacement =
    options.page === 'overview' ? 'overview' : options.page ?? ctx.dashboardSlug ?? null;
  const assignedCatalog = useEffectiveCharts(
    options.catalogMode === 'assigned' ? assignedPlacement : null
  );
  const chartOptions = getChartOptions(options.page).filter((option) =>
    options.chartIds.includes(option.value)
  );
  const defaultStorageKey = chartDefaultStorageKey(ctx, instance);
  const { data: favoriteResponse, isSuccess: favoritesLoaded } = useDashboardChartFavorites();
  const updateFavorite = useUpdateDashboardChartFavorite();
  const chartIdsSignature = options.chartIds.join('|');
  const serverFavorite = favoriteResponse?.chart_favorites?.[defaultStorageKey];
  const resolvedFavorite =
    typeof serverFavorite === 'string' && options.chartIds.includes(serverFavorite)
      ? serverFavorite
      : options.chartId;
  const [chartId, setChartId] = React.useState(options.chartId);
  const [defaultChartId, setDefaultChartId] = React.useState(options.chartId);
  const favoriteInitializationRef = React.useRef<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [draftChartSettings, setDraftChartSettings] = React.useState(options.chartSettings);
  const [activeAxisRanges, setActiveAxisRanges] = React.useState<DashboardChartResolvedAxisRanges>(
    {}
  );
  const chartSettingsSignature = JSON.stringify(options.chartSettings);

  React.useEffect(() => {
    if (!favoritesLoaded) return;
    const initializationKey = `${defaultStorageKey}|${chartIdsSignature}|${options.chartId}`;
    setDefaultChartId(resolvedFavorite);
    if (favoriteInitializationRef.current !== initializationKey) {
      setChartId(resolvedFavorite);
      favoriteInitializationRef.current = initializationKey;
    }
  }, [defaultStorageKey, options.chartId, chartIdsSignature, favoritesLoaded, resolvedFavorite]);

  React.useEffect(() => {
    setDraftChartSettings(options.chartSettings);
  }, [chartSettingsSignature]);

  const activeChartId = options.chartIds.includes(chartId) ? chartId : options.chartId;
  const activeChartDefinition = getChartDefinition(activeChartId);
  const activeCapabilities = activeChartDefinition
    ? {
        ...getChartSettingsCapabilities(activeChartDefinition),
        smoothness: supportsDashboardChartSmoothness(activeChartDefinition),
      }
    : EMPTY_CAPABILITIES;
  const activeSettings = resolveChartDisplaySettings(
    draftChartSettings,
    activeChartId,
    options.legacyTimeFilter,
    options.legacySmoothness
  );
  const activeChartTitle = activeChartDefinition?.title ?? instance.title ?? 'Chart';

  React.useEffect(() => {
    setActiveAxisRanges((current) => (Object.keys(current).length === 0 ? current : {}));
  }, [activeChartId]);

  if (options.catalogMode === 'assigned') {
    if (assignedCatalog.isSuccess) {
      return (
        <AssignedChartRuntime
          instance={instance}
          ctx={ctx}
          options={options}
          charts={assignedCatalog.data}
        />
      );
    }
    return (
      <DashboardChartCatalogState
        instance={instance}
        message={
          assignedCatalog.isError ? 'Unable to load assigned charts.' : 'Loading assigned charts…'
        }
        error={assignedCatalog.isError}
      />
    );
  }

  function updateActiveChartSettings(
    updater: (current: DashboardChartDisplaySettings) => DashboardChartDisplaySettings
  ) {
    setDraftChartSettings((current) => {
      const nextEntry = updater(current[activeChartId] ?? {});
      const nextMap = setChartSettingsEntry(current, activeChartId, nextEntry);
      ctx.updateWidgetOptions?.(instance.id, { chartSettings: nextMap });
      return nextMap;
    });
  }

  function setChartAsDefault(nextChartId: string) {
    setDefaultChartId(nextChartId);
    updateFavorite.mutate({ key: defaultStorageKey, chartId: nextChartId });
  }

  return (
    <DashboardChartFrame
      instance={instance}
      options={options}
      chartId={activeChartId}
      chartOptions={chartOptions}
      onChartChange={setChartId}
      search={search}
      onSearchChange={setSearch}
      defaultChartId={defaultChartId}
      onSetDefault={setChartAsDefault}
      chartTitle={activeChartTitle}
      settings={activeSettings}
      capabilities={activeCapabilities}
      activeAxisRanges={activeAxisRanges}
      onUpdateSettings={updateActiveChartSettings}
      persistent={Boolean(ctx.updateWidgetOptions)}
      renderChart={(height, presentation) => (
        <DashboardChartRenderer
          chartId={activeChartId}
          ctx={ctx}
          height={height}
          settings={activeSettings}
          presentation={presentation ?? 'embedded'}
          onResolvedAxisRanges={(ranges) =>
            setActiveAxisRanges((current) =>
              sameResolvedAxisRanges(current, ranges) ? current : ranges
            )
          }
        />
      )}
    />
  );
}

function DashboardChartCatalogState({
  instance,
  message,
  error = false,
}: {
  instance: WidgetInstance;
  message: string;
  error?: boolean;
}) {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {instance.title ? (
        <div className="mb-2 shrink-0">
          <p className="text-sm font-medium uppercase tracking-wider text-fg-secondary">
            {instance.title}
          </p>
        </div>
      ) : null}
      <div
        role={error ? 'alert' : 'status'}
        className="flex min-h-32 flex-1 items-center justify-center rounded-lg border border-dashed border-border p-4 text-sm text-fg-tertiary"
      >
        {message}
      </div>
    </div>
  );
}

interface DashboardChartFrameProps {
  instance: WidgetInstance;
  options: ResolvedDashboardChartOptions;
  chartId: string;
  chartOptions: Array<{ value: string; label: string }>;
  onChartChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  defaultChartId: string;
  onSetDefault: (value: string) => void;
  chartTitle: string;
  settings: ReturnType<typeof resolveChartDisplaySettings>;
  capabilities: DashboardChartSettingsCapabilities;
  activeAxisRanges: DashboardChartResolvedAxisRanges;
  persistent: boolean;
  onUpdateSettings: (
    updater: (current: DashboardChartDisplaySettings) => DashboardChartDisplaySettings
  ) => void;
  renderChart: (height: number, presentation?: 'embedded' | 'mobile-viewer') => React.ReactNode;
}

/** Single visual frame shared by assigned and fixed dashboard chart catalogs. */
function DashboardChartFrame({
  instance,
  options,
  chartId,
  chartOptions,
  onChartChange,
  search,
  onSearchChange,
  defaultChartId,
  onSetDefault,
  chartTitle,
  settings,
  capabilities,
  activeAxisRanges,
  persistent,
  onUpdateSettings,
  renderChart,
}: DashboardChartFrameProps) {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const settingsTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const expandTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const { ref, height } = useMeasuredWidgetHeight(260, 160);
  const controls = (
    <div className="flex items-center gap-2">
      <button
        ref={settingsTriggerRef}
        type="button"
        aria-label="Chart settings"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen((value) => !value)}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-surface text-fg-tertiary transition-colors',
          'hover:border-border-strong hover:text-fg focus:outline-none focus:ring-0 focus-visible:!outline-none focus-visible:!outline-offset-0 focus-visible:ring-0',
          settingsOpen && 'border-accent text-accent'
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      <button
        ref={expandTriggerRef}
        type="button"
        aria-label="Expand chart"
        onClick={() => setViewerOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-surface text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg focus:outline-none focus:ring-0 focus-visible:!outline-none focus-visible:!outline-offset-0 focus-visible:ring-0 sm:hidden"
      >
        <Maximize2 className="h-4 w-4" />
      </button>
    </div>
  );
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {options.showPicker && chartOptions.length > 1 ? (
        <ChartPicker
          value={chartId}
          options={chartOptions}
          onChange={onChartChange}
          searchValue={search}
          onSearchChange={onSearchChange}
          className="shrink-0"
          trailing={controls}
          defaultValue={defaultChartId}
          onSetDefault={onSetDefault}
        />
      ) : instance.title ? (
        <div className="mb-2 flex shrink-0 items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-fg-secondary">
              {instance.title}
            </p>
            {options.headerSubtitle ? (
              <p className="mt-0.5 text-xs text-fg-tertiary">{options.headerSubtitle}</p>
            ) : null}
          </div>
          <div className="shrink-0">{controls}</div>
        </div>
      ) : (
        <div className="absolute right-0 top-0 z-10">{controls}</div>
      )}
      {!viewerOpen ? (
        <div ref={ref} className="min-h-0 flex-1 overflow-hidden">
          {renderChart(height)}
        </div>
      ) : null}
      <ChartSettingsPanel
        open={settingsOpen}
        triggerRef={settingsTriggerRef}
        chartTitle={chartTitle}
        capabilities={capabilities}
        settings={settings}
        suggestedRanges={activeAxisRanges}
        persistent={persistent}
        onClose={() => setSettingsOpen(false)}
        onTimeFilterChange={(next) =>
          onUpdateSettings((current) => ({ ...current, timeFilter: next }))
        }
        onSmoothnessChange={(next) =>
          onUpdateSettings((current) => ({ ...current, smoothness: next }))
        }
        onAxisModeChange={(axisId, mode) =>
          onUpdateSettings((current) => ({
            ...current,
            axes: {
              ...(current.axes ?? {}),
              [axisId]: {
                ...(current.axes?.[axisId] ?? {}),
                mode,
                ...(mode === 'manual' && axisId !== 'x'
                  ? {
                      ...(current.axes?.[axisId]?.min == null && activeAxisRanges[axisId]
                        ? { min: activeAxisRanges[axisId]![0] }
                        : {}),
                      ...(current.axes?.[axisId]?.max == null && activeAxisRanges[axisId]
                        ? { max: activeAxisRanges[axisId]![1] }
                        : {}),
                    }
                  : {}),
              },
            },
          }))
        }
        onAxisValueChange={(axisId, bound, rawValue) =>
          onUpdateSettings((current) => ({
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
          chartId={chartId}
          chartTitle={chartTitle}
          chartOptions={chartOptions}
          onChartChange={onChartChange}
          defaultChartId={defaultChartId}
          onSetDefault={onSetDefault}
          onClose={() => {
            setViewerOpen(false);
            requestAnimationFrame(() => expandTriggerRef.current?.focus());
          }}
        >
          {(viewerHeight) => renderChart(viewerHeight, 'mobile-viewer')}
        </MobileChartViewer>
      ) : null}
    </div>
  );
}

function AssignedChartRuntime({
  instance,
  ctx,
  options,
  charts,
}: {
  instance: WidgetInstance;
  ctx: WidgetCtx;
  options: ResolvedDashboardChartOptions;
  charts: ChartRecord[];
}) {
  const available = charts.filter(
    (chart) => chart.isEnabled || options.requiredChartSlugs.includes(chart.slug)
  );
  const chartIdsSignature = available.map((chart) => chart.slug).join('|');
  const chartOptions = available.map((chart) => ({ value: chart.slug, label: chart.name }));
  const defaultChartId =
    options.chartId && available.some((chart) => chart.slug === options.chartId)
      ? options.chartId
      : (available[0]?.slug ?? '');
  const [chartId, setChartId] = React.useState(defaultChartId);
  const [defaultChartIdState, setDefaultChartId] = React.useState(defaultChartId);
  const [search, setSearch] = React.useState('');
  const [draftChartSettings, setDraftChartSettings] = React.useState(options.chartSettings);
  const [activeAxisRanges, setActiveAxisRanges] = React.useState<DashboardChartResolvedAxisRanges>(
    {}
  );
  const { data: favoriteResponse, isSuccess: favoritesLoaded } = useDashboardChartFavorites();
  const updateFavorite = useUpdateDashboardChartFavorite();
  const storageKey = chartDefaultStorageKey(ctx, instance);
  const favorite = favoriteResponse?.chart_favorites?.[storageKey];
  const resolvedFavorite =
    favoritesLoaded && favorite && available.some((chart) => chart.slug === favorite)
      ? favorite
      : defaultChartId;
  const favoriteInitializationRef = React.useRef<string | null>(null);

  React.useEffect(() => setDraftChartSettings(options.chartSettings), [options.chartSettings]);

  React.useEffect(() => {
    if (!available.length) return;
    const initializationKey = `${storageKey}|${chartIdsSignature}|${defaultChartId}`;
    setDefaultChartId(resolvedFavorite);
    if (favoriteInitializationRef.current !== initializationKey) {
      setChartId(resolvedFavorite);
      favoriteInitializationRef.current = initializationKey;
    }
  }, [chartIdsSignature, defaultChartId, resolvedFavorite, storageKey, available.length]);

  const active = available.find((chart) => chart.slug === chartId) ?? available[0];
  const settings = resolveChartDisplaySettings(
    draftChartSettings,
    active?.slug ?? '',
    options.legacyTimeFilter,
    options.legacySmoothness
  );
  const activeDefinition = active ? getChartDefinition(active.slug) : undefined;
  const activeCapabilities = activeDefinition
    ? {
        ...getChartSettingsCapabilities(activeDefinition),
        smoothness: supportsDashboardChartSmoothness(activeDefinition),
      }
    : active
      ? {
          timeFilter: active.config.x.kind === 'time',
          smoothness: active.config.series.some(
            (item) => item.mark === 'line' || item.mark === 'area' || item.mark === 'step'
          ),
          axes: {
            x: {
              label: active.config.axes.x.label ?? 'X axis',
              ...(active.config.axes.x.unit ? { unit: active.config.axes.x.unit } : {}),
            },
            y: {
              label: active.config.axes.y.label ?? 'Y axis',
              ...(active.config.axes.y.unit ? { unit: active.config.axes.y.unit } : {}),
            },
            ...(active.config.axes.y2
              ? {
                  y2: {
                    label: active.config.axes.y2.label ?? 'Y2 axis',
                    ...(active.config.axes.y2.unit ? { unit: active.config.axes.y2.unit } : {}),
                  },
                }
              : {}),
          },
          xDomainSource:
            active.config.timeframe.mode === 'dashboard'
              ? ('dashboard-timeframe' as const)
              : ('chart-local' as const),
        }
      : EMPTY_CAPABILITIES;

  function setChartAsDefault(next: string) {
    setDefaultChartId(next);
    updateFavorite.mutate({ key: storageKey, chartId: next });
  }

  function updateChartSettings(
    updater: (current: DashboardChartDisplaySettings) => DashboardChartDisplaySettings
  ) {
    if (!active) return;
    setDraftChartSettings((current) => {
      const next = setChartSettingsEntry(current, active.slug, updater(current[active.slug] ?? {}));
      ctx.updateWidgetOptions?.(instance.id, { chartSettings: next });
      return next;
    });
  }

  if (!active) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center rounded-lg border border-dashed border-border p-4 text-sm text-fg-tertiary">
        No enabled charts are assigned to this dashboard.
      </div>
    );
  }

  const renderChart = (height: number, presentation: 'embedded' | 'mobile-viewer' = 'embedded') =>
    active ? (
      <ManagedChartRuntime
        chart={active}
        ctx={ctx}
        height={height}
        settings={settings}
        presentation={presentation}
        onResolvedAxisRanges={(ranges) =>
          setActiveAxisRanges((current) =>
            sameResolvedAxisRanges(current, ranges) ? current : ranges
          )
        }
      />
    ) : null;
  return (
    <DashboardChartFrame
      instance={instance}
      options={options}
      chartId={active.slug}
      chartOptions={chartOptions}
      onChartChange={setChartId}
      search={search}
      onSearchChange={setSearch}
      defaultChartId={defaultChartIdState}
      onSetDefault={setChartAsDefault}
      chartTitle={active.name}
      settings={settings}
      capabilities={activeCapabilities}
      activeAxisRanges={activeAxisRanges}
      persistent={Boolean(ctx.updateWidgetOptions)}
      onUpdateSettings={updateChartSettings}
      renderChart={renderChart}
    />
  );
}

export function usesBundledChartRenderer(chart: ChartRecord) {
  return getChartDefinition(chart.slug) != null;
}

export function ManagedChartRuntime({
  chart,
  ctx,
  height,
  settings,
  presentation = 'embedded',
  onResolvedAxisRanges,
}: {
  chart: ChartRecord;
  ctx: WidgetCtx;
  height: number;
  settings?: DashboardChartDisplaySettings;
  presentation?: 'embedded' | 'mobile-viewer';
  onResolvedAxisRanges?: (ranges: DashboardChartResolvedAxisRanges) => void;
}) {
  const normalizedChart = normalizeLegacyBundledChartRecord(chart);
  if (usesBundledChartRenderer(normalizedChart)) {
    return (
      <DashboardChartRenderer
        chartId={normalizedChart.slug}
        managedDefinition={normalizedChart.config}
        ctx={ctx}
        height={height}
        presentation={presentation}
        {...(settings ? { settings } : {})}
        {...(onResolvedAxisRanges ? { onResolvedAxisRanges } : {})}
      />
    );
  }
  return (
    <ManagedDefinitionRuntime
      chart={normalizedChart}
      ctx={ctx}
      height={height}
      presentation={presentation}
      {...(settings ? { settings } : {})}
    />
  );
}

function ManagedDefinitionRuntime({
  chart,
  ctx,
  height,
  settings,
  presentation,
}: {
  chart: ChartRecord;
  ctx: WidgetCtx;
  height: number;
  settings?: DashboardChartDisplaySettings;
  presentation: 'embedded' | 'mobile-viewer';
}) {
  const draft = {
    ...chart.config,
    display: {
      ...chart.config.display,
      ...(settings?.timeFilter
        ? { timeFilter: settings.timeFilter as ChartDefinitionV1['display']['timeFilter'] }
        : {}),
      ...(settings?.smoothness
        ? {
            curveSmoothness: settings.smoothness as ChartDefinitionV1['display']['curveSmoothness'],
          }
        : {}),
    },
  } satisfies ChartDefinitionV1;
  const datasetState = useChartDatasets(draft, {
    vehicleId: ctx.vehicleId,
    from: ctx.from,
    to: ctx.to,
    lifetime: draft.timeframe.mode === 'lifetime',
    ...(ctx.chargeSessionId !== undefined ? { chargeSessionId: ctx.chargeSessionId } : {}),
    ...(ctx.tripTagFilter ? { tripTagFilter: ctx.tripTagFilter } : {}),
  });
  const renderer = getChartRenderer(draft);
  return (
    <>
      {renderer?.render({
        definition: draft,
        datasets: datasetState.datasets,
        height,
        loading: datasetState.isLoading,
        partial: datasetState.isPartial,
        refreshing: datasetState.isFetching && !datasetState.isLoading,
        error: datasetState.errors.length > 0 && datasetState.datasets.length === 0,
        presentation,
      })}
    </>
  );
}

export function DashboardChartRenderer({
  chartId,
  managedDefinition,
  ctx,
  height,
  timeFilter,
  settings,
  presentation = 'embedded',
  onResolvedAxisRanges,
}: {
  chartId: string;
  managedDefinition?: ChartDefinitionV1;
  ctx: WidgetCtx;
  height: number;
  timeFilter?: TimeFilterWindow;
  settings?: DashboardChartDisplaySettings;
  presentation?: 'embedded' | 'mobile-viewer';
  onResolvedAxisRanges?: (ranges: DashboardChartResolvedAxisRanges) => void;
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
      chartDefinition={managedDefinition ?? definition.config}
      ctx={ctx}
      height={height}
      timeFilter={
        settings?.timeFilter ??
        timeFilter ??
        managedDefinition?.display.timeFilter ??
        definition.config.display.timeFilter ??
        'raw'
      }
      smoothness={
        settings?.smoothness ??
        managedDefinition?.display.curveSmoothness ??
        definition.config.display.curveSmoothness ??
        DEFAULT_CURVE_SMOOTHNESS
      }
      presentation={presentation}
      {...(onResolvedAxisRanges ? { onResolvedAxisRanges } : {})}
      {...(settings ? { settings } : {})}
    />
  );
}

const CHARGE_SESSION_DETAIL_CONFIG = {
  schemaVersion: 1,
  placements: [],
  timeframe: { mode: 'dashboard' },
  sources: [
    {
      id: 'main',
      sourceId: 'charging.charge-curve',
      params: {},
      filters: [],
      inherit: { vehicle: true, timeframe: true },
    },
  ],
  x: {
    field: { sourceBindingId: 'main', field: 'elapsed_minutes' },
    kind: 'number',
  },
  series: [
    {
      id: 'energy_kwh',
      label: 'Energy Added',
      y: { sourceBindingId: 'main', field: 'energy_kwh' },
      mark: 'line',
      fill: true,
      yAxis: 'y2',
      color: { mode: 'token', token: 'emerald' },
      transforms: [],
      visibleInLegend: true,
    },
    {
      id: 'power_kw',
      label: 'Charge Rate',
      y: { sourceBindingId: 'main', field: 'power_kw' },
      mark: 'line',
      fill: false,
      yAxis: 'y',
      color: { mode: 'token', token: 'accent' },
      transforms: [],
      visibleInLegend: true,
    },
  ],
  axes: {
    x: { scale: 'linear', domain: { mode: 'auto' } },
    y: { scale: 'linear', unit: 'kW', domain: { mode: 'auto' } },
    y2: { scale: 'linear', unit: 'kWh', domain: { mode: 'auto' } },
  },
  display: {
    legend: 'auto',
    grid: true,
    tooltip: true,
    timeFilter: 'raw',
    curveSmoothness: 'gentle',
    emptyTitle: 'No charging curve is available for this session',
  },
  interaction: { panZoom: true, touchExplore: true, connectGaps: false },
} satisfies ChartDefinitionV1;

const CHARGE_SESSION_DETAIL_DEFINITION: DashboardChartDefinition = {
  id: 'charge-session-detail',
  title: 'Session charging trace',
  description: 'Charge rate and cumulative energy for the selected session.',
  pages: [],
  source: 'charge_session_curve',
  config: CHARGE_SESSION_DETAIL_CONFIG,
  mode: 'line',
  yUnit: 'kW',
  emptyTitle: CHARGE_SESSION_DETAIL_CONFIG.display.emptyTitle,
};

/** Route-only selected-session visualization; intentionally absent from the managed chart catalog. */
export function ChargeSessionCurveDetail({
  ctx,
  height,
  presentation = 'embedded',
}: {
  ctx: WidgetCtx;
  height: number;
  presentation?: 'embedded' | 'mobile-viewer';
}) {
  return (
    <ChargeSessionCurveSource
      definition={CHARGE_SESSION_DETAIL_DEFINITION}
      chartDefinition={CHARGE_SESSION_DETAIL_CONFIG}
      ctx={ctx}
      height={height}
      timeFilter="raw"
      smoothness="gentle"
      presentation={presentation}
    />
  );
}

type ActiveDashboardChartSourceProps = {
  definition: DashboardChartDefinition;
  chartDefinition: ChartDefinitionV1;
  ctx: WidgetCtx;
  height: number;
  timeFilter: TimeFilterWindow;
  smoothness: CurveSmoothness;
  settings?: DashboardChartDisplaySettings;
  presentation: 'embedded' | 'mobile-viewer';
  onResolvedAxisRanges?: (ranges: DashboardChartResolvedAxisRanges) => void;
};

function ActiveDashboardChartSource(props: ActiveDashboardChartSourceProps) {
  switch (props.definition.source) {
    case 'soc_history':
      return <SocHistorySource {...props} />;
    case 'charging_sessions_energy':
      return <ChargingSeriesSource {...props} sessions />;
    case 'charging_weekly_energy':
      return <ChargingSeriesSource {...props} />;
    case 'charge_session_curve':
      return <ChargeSessionCurveSource {...props} />;
    case 'charging_curve_analysis':
      return <ChargingCurveAnalysisSource {...props} />;
    case 'efficiency_trend':
      return <EfficiencyTrendSource {...props} />;
    case 'efficiency_temperature':
      return <EfficiencyTemperatureSource {...props} />;
    case 'efficiency_mode':
      return <EfficiencyModeSource {...props} />;
    case 'efficiency_tags':
      return <EfficiencyTagsSource {...props} />;
    case 'phantom_drain':
      return <PhantomDrainSource {...props} />;
    case 'battery_degradation':
      return <BatteryDegradationSource {...props} />;
    case 'battery_capacity_mileage':
      return <BatteryMileageSource {...props} />;
    case 'projected_range_mileage':
      return <ProjectedRangeMileageSource {...props} />;
    case 'tire_pressure_trips':
      return <TirePressureTripsSource {...props} />;
  }
}

function chartInteractionMode(presentation: ActiveDashboardChartSourceProps['presentation']) {
  return presentation === 'mobile-viewer' ? ('touch-explore' as const) : ('standard' as const);
}

function sourceAxisRanges(settings?: DashboardChartDisplaySettings) {
  return {
    xRange: getManualAxisRange(settings?.axes?.x),
    yRange: getManualAxisRange(settings?.axes?.y),
    yRightRange: getManualAxisRange(settings?.axes?.y2),
  };
}

function SocHistorySource({
  definition,
  chartDefinition,
  ctx,
  height,
  timeFilter,
  smoothness,
  settings,
  presentation,
}: ActiveDashboardChartSourceProps) {
  const isDark = useDocumentTheme();
  const { data: soc = [], isLoading: socLoading } = useSocHistory(ctx.vehicleId, ctx.from, ctx.to);
  const { data: range = [], isLoading: rangeLoading } = useRangeHistory(
    ctx.vehicleId,
    ctx.from,
    ctx.to
  );
  return renderSocHistoryChart(
    definition,
    chartDefinition,
    height,
    socLoading || rangeLoading,
    soc.map((point) => ({ ts: point.ts, value: point.value })),
    range.map((point) => ({ ts: point.ts, value: point.value })),
    timeFilter,
    smoothness,
    sourceAxisRanges(settings).yRange,
    chartInteractionMode(presentation),
    isDark
  );
}

function ChargingSeriesSource({
  definition,
  chartDefinition,
  ctx,
  height,
  settings,
  presentation,
  sessions,
}: ActiveDashboardChartSourceProps & { sessions?: boolean }) {
  const isDark = useDocumentTheme();
  const { data, isLoading } = useChargingChartSeries(ctx.vehicleId, ctx.from, ctx.to);
  const daily = data?.daily ?? [];
  const seriesColor = editedSeriesColor(chartDefinition, 'accent', isDark);
  const configuredYRange =
    sourceAxisRanges(settings).yRange ?? fixedDefinitionRange(chartDefinition.axes.y);
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
        {...(seriesColor ? { seriesColor } : {})}
        {...(configuredYRange ? { yRange: configuredYRange } : {})}
      />
    );
  }
  return (
    <DailyEnergyChart
      definition={definition}
      daily={daily}
      loading={isLoading}
      height={height}
      interactionMode={chartInteractionMode(presentation)}
      {...(configuredYRange ? { yRange: configuredYRange } : {})}
      {...(seriesColor ? { seriesColor } : {})}
    />
  );
}

function ChargeSessionCurveSource({
  definition,
  chartDefinition,
  ctx,
  height,
  timeFilter,
  smoothness,
  settings,
  presentation,
}: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useChargeCurve(
    ctx.chargeSessionId ?? null,
    ctx.vehicleId,
    ctx.chargeSessionActive === true,
  );
  const { yRange, yRightRange } = sourceAxisRanges(settings);
  return (
    <ChargeSessionCurveChart
      definition={definition}
      chartDefinition={chartDefinition}
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

function ChargingCurveAnalysisSource({
  definition,
  chartDefinition,
  ctx,
  height,
  settings,
  presentation,
}: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useChargeCurveAnalysis(ctx.vehicleId, ctx.from, ctx.to);
  const { xRange, yRange } = sourceAxisRanges(settings);
  return (
    <ChargingCurveAnalysisChart
      definition={definition}
      chartDefinition={chartDefinition}
      data={data}
      loading={isLoading}
      height={height}
      interactionMode={chartInteractionMode(presentation)}
      {...(xRange ? { xRange } : {})}
      {...(yRange ? { yRange } : {})}
    />
  );
}

function EfficiencyTrendSource({
  definition,
  chartDefinition,
  ctx,
  height,
  timeFilter,
  smoothness,
  settings,
  presentation,
}: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useEfficiencyTrend(
    ctx.vehicleId,
    ctx.from,
    ctx.to,
    ctx.tripTagFilter
  );
  const { yRange } = sourceAxisRanges(settings);
  return (
    <EfficiencyTrendChart
      definition={definition}
      chartDefinition={chartDefinition}
      trend={data}
      loading={isLoading}
      height={height}
      timeFilter={timeFilter}
      smoothness={smoothness}
      interactionMode={chartInteractionMode(presentation)}
      {...(yRange ? { yRange } : {})}
    />
  );
}

function EfficiencyTemperatureSource({
  definition,
  chartDefinition,
  ctx,
  height,
}: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useEfficiencyVsTemp(
    ctx.vehicleId,
    ctx.from,
    ctx.to,
    ctx.tripTagFilter
  );
  return (
    <EfficiencyTemperatureChart
      definition={definition}
      chartDefinition={chartDefinition}
      data={data}
      loading={isLoading}
      height={height}
    />
  );
}

function EfficiencyModeSource({
  definition,
  chartDefinition,
  ctx,
  height,
}: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useEfficiencyByMode(
    ctx.vehicleId,
    ctx.from,
    ctx.to,
    ctx.tripTagFilter
  );
  return (
    <EfficiencyModeChart
      definition={definition}
      chartDefinition={chartDefinition}
      data={data}
      loading={isLoading}
      height={height}
    />
  );
}

function EfficiencyTagsSource({ chartDefinition, ctx, height }: ActiveDashboardChartSourceProps) {
  const { data = [], isLoading } = useEfficiencyByTag(
    ctx.vehicleId,
    ctx.from,
    ctx.to,
    ctx.tripTagFilter
  );
  const tags = useTripTags(ctx.vehicleId);
  if (tags.isError) {
    return <EfficiencyTagsCatalogError height={height} onRetry={() => void tags.refetch()} />;
  }
  if (!tags.isLoading && (tags.data ?? []).length === 0) {
    return <EfficiencyTagsOnboarding height={height} canManage={Boolean(ctx.canManageTripTags)} />;
  }
  const hasTagFilter = Boolean(ctx.tripTagFilter?.tagIds.length || ctx.tripTagFilter?.untagged);
  return (
    <EfficiencyTagsChart
      data={data}
      loading={isLoading || tags.isLoading}
      height={height}
      hasTagFilter={hasTagFilter}
      chartDefinition={chartDefinition}
    />
  );
}

function EfficiencyTagsCatalogError({ height, onRetry }: { height: number; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-status-danger/30 bg-status-danger/10 px-4 text-center text-sm text-status-danger"
      style={{ height }}
    >
      <p>Couldn’t load shared tags. Retry to compare tagged trips.</p>
      <button
        type="button"
        className="min-h-11 rounded-lg border border-status-danger/40 px-3 text-sm font-medium transition-colors hover:bg-status-danger/10"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

function EfficiencyTagsOnboarding({ height, canManage }: { height: number; canManage: boolean }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-fg-tertiary"
      style={{ height }}
    >
      {canManage
        ? 'No shared tags yet. Create one with the Tags filter above to compare setups.'
        : 'No shared tags yet. A vehicle manager can create tags from Trips.'}
    </div>
  );
}

function PhantomDrainSource({
  definition,
  chartDefinition,
  ctx,
  height,
  settings,
  presentation,
}: ActiveDashboardChartSourceProps) {
  const isDark = useDocumentTheme();
  const { data, isLoading } = usePhantomDrainPeriods(ctx.vehicleId, ctx.from, ctx.to, 500, 6);
  const seriesColor = editedSeriesColor(chartDefinition, 'accent', isDark);
  return (
    <PhantomDrainChart
      periods={data?.periods ?? []}
      loading={isLoading}
      height={height}
      emptyTitle={definition.emptyTitle}
      yUnit={chartDefinition.axes.y.unit ?? definition.yUnit}
      yRange={
        sourceAxisRanges(settings).yRange ??
        fixedDefinitionRange(chartDefinition.axes.y) ??
        definition.yRange
      }
      interactionMode={chartInteractionMode(presentation)}
      {...(seriesColor ? { seriesColor } : {})}
    />
  );
}

function BatteryDegradationSource({
  definition,
  chartDefinition,
  ctx,
  height,
  timeFilter,
  smoothness,
  settings,
  presentation,
}: ActiveDashboardChartSourceProps) {
  const isDark = useDocumentTheme();
  const { data = [], isLoading } = useDegradation(ctx.vehicleId, ctx.from, ctx.to);
  return renderSingleChart(
    definition,
    chartDefinition,
    height,
    isLoading,
    data.map((point) => ({ ts: point.ts, value: point.capacity_pct ?? null })),
    timeFilter,
    sourceAxisRanges(settings).yRange,
    chartInteractionMode(presentation),
    smoothness,
    isDark
  );
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

function BatteryMileageSource({
  definition,
  chartDefinition,
  ctx,
  height,
  timeFilter,
  smoothness,
  settings,
  presentation,
  onResolvedAxisRanges,
}: ActiveDashboardChartSourceProps) {
  const { data, isLoading } = useBatteryMileage(ctx.vehicleId, ctx.from, ctx.to);
  const { xRange, yRange, yRightRange } = sourceAxisRanges(settings);
  return (
    <BatteryCapacityMileageChart
      definition={definition}
      chartDefinition={chartDefinition}
      loading={isLoading}
      height={height}
      points={mileagePoints(data)}
      timeFilter={timeFilter}
      smoothness={smoothness}
      interactionMode={chartInteractionMode(presentation)}
      {...(xRange ? { xRange } : {})}
      {...(yRange ? { yRange } : {})}
      {...(yRightRange ? { yRightRange } : {})}
      {...(onResolvedAxisRanges ? { onResolvedAxisRanges } : {})}
    />
  );
}

function ProjectedRangeMileageSource({
  definition,
  chartDefinition,
  ctx,
  height,
  timeFilter,
  smoothness,
  settings,
  presentation,
  onResolvedAxisRanges,
}: ActiveDashboardChartSourceProps) {
  const { data, isLoading } = useBatteryMileage(ctx.vehicleId, ctx.from, ctx.to);
  const { xRange, yRange, yRightRange } = sourceAxisRanges(settings);
  return (
    <ProjectedRangeMileageChart
      definition={definition}
      chartDefinition={chartDefinition}
      loading={isLoading}
      height={height}
      points={mileagePoints(data)}
      timeFilter={timeFilter}
      smoothness={smoothness}
      interactionMode={chartInteractionMode(presentation)}
      {...(xRange ? { xRange } : {})}
      {...(yRange ? { yRange } : {})}
      {...(yRightRange ? { yRightRange } : {})}
      {...(onResolvedAxisRanges ? { onResolvedAxisRanges } : {})}
    />
  );
}

function TirePressureTripsSource({
  definition,
  chartDefinition,
  ctx,
  height,
  settings,
  presentation,
}: ActiveDashboardChartSourceProps) {
  const isDark = useDocumentTheme();
  const { data, isLoading } = useTirePressureTimeline(
    ctx.vehicleId,
    ctx.from,
    ctx.to,
    ctx.tripTagFilter
  );
  const { data: vehicles } = useVehicles();
  const navigate = useNavigate();
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === ctx.vehicleId);
  const unitPreferences = getUnitPreferences();
  const pressureFactor = unitPreferences.pressure_unit === 'kpa' ? 6.89476 : 1;
  const pressureUnit = unitPreferences.pressure_unit === 'kpa' ? 'kPa' : 'psi';
  const tireFields = {
    front_left_psi: { field: 'tire_fl_psi' as const, color: CHART_COLORS.accent, token: 'accent' },
    front_right_psi: { field: 'tire_fr_psi' as const, color: CHART_COLORS.sky, token: 'sky' },
    rear_left_psi: { field: 'tire_rl_psi' as const, color: CHART_COLORS.emerald, token: 'emerald' },
    rear_right_psi: { field: 'tire_rr_psi' as const, color: CHART_COLORS.amber, token: 'amber' },
  };
  const seriesStyles = chartDefinition.series.flatMap((series) => {
    const established = tireFields[series.y.field as keyof typeof tireFields];
    if (!established) return [];
    return [
      {
        field: established.field,
        key: series.id,
        label: series.label,
        color: resolveSeriesColor(series.color, established.token, established.color, isDark),
        mode: chartSeriesMode(series),
        ...(series.mark === 'step' ? { interpolation: 'step' as const } : {}),
        ...(series.visibleInLegend !== undefined ? { showInLegend: series.visibleInLegend } : {}),
        ...(series.pointSize !== undefined ? { pointSize: series.pointSize } : {}),
        ...(series.strokeWidth !== undefined ? { strokeWidth: series.strokeWidth } : {}),
      },
    ];
  });
  const configuredYRange =
    sourceAxisRanges(settings).yRange ?? fixedDefinitionRange(chartDefinition.axes.y);

  return (
    <TirePressureTripsChart
      samples={data?.samples ?? []}
      trips={data?.trips ?? []}
      targetPressure={activeVehicle?.target_tire_pressure_psi ?? DEFAULT_TARGET_TIRE_PRESSURE_PSI}
      pressureFactor={pressureFactor}
      pressureUnit={pressureUnit}
      loading={isLoading}
      height={height}
      {...(definition.emptyTitle ? { emptyTitle: definition.emptyTitle } : {})}
      interactionMode={chartInteractionMode(presentation)}
      seriesStyles={seriesStyles}
      {...(configuredYRange ? { yRange: configuredYRange } : {})}
      showLegend={chartDefinition.display.legend !== 'hide'}
      showGrid={chartDefinition.display.grid}
      showTooltip={chartDefinition.display.tooltip}
      showPoints={chartDefinition.display.showPoints ?? false}
      {...(chartDefinition.axes.y.label ? { yAxisLabel: chartDefinition.axes.y.label } : {})}
      onTripClick={(tripId) => void navigate({ to: '/trips/$tripId', params: { tripId } })}
    />
  );
}

function renderSocHistoryChart(
  definition: DashboardChartDefinition,
  chartDefinition: ChartDefinitionV1,
  height: number,
  loading: boolean,
  soc: Array<{ ts: string; value: number | null }>,
  range: Array<{ ts: string; value: number | null }>,
  timeFilter: TimeFilterWindow = 'raw',
  smoothness: CurveSmoothness = DEFAULT_CURVE_SMOOTHNESS,
  manualYRange?: [number, number],
  interactionMode: 'standard' | 'touch-explore' = 'standard',
  isDark = false
) {
  const rangeByTimestamp = new Map(range.map((point) => [point.ts, point.value]));
  const configured = configuredRichSeries(
    chartDefinition,
    {
      battery_level: {
        defaultColorToken: 'accent',
        series: {
          key: definition.id,
          label: definition.title,
          color: CHART_COLORS.accent,
          values: soc.map((point) => point.value),
          mode: definition.mode ?? 'line',
        },
      },
    },
    isDark
  );

  return (
    <RichTimeSeriesChart
      points={soc.map((point) => ({ ts: point.ts }))}
      series={[
        ...configured,
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
      yUnit={chartDefinition.axes.y.unit ?? definition.yUnit}
      yRange={manualYRange ?? fixedDefinitionRange(chartDefinition.axes.y) ?? definition.yRange}
      mode={definition.mode}
      timeFilter={timeFilter}
      smoothness={smoothness}
      xAxisLabel={chartDefinition.axes.x.label}
      yAxisLabel={chartDefinition.axes.y.label}
      showLegend={chartDefinition.display.legend !== 'hide'}
      showGrid={chartDefinition.display.grid}
      showTooltip={chartDefinition.display.tooltip}
      showPoints={chartDefinition.display.showPoints ?? false}
      connectGaps={chartDefinition.interaction.connectGaps}
      interactionMode={interactionMode}
    />
  );
}

function renderSingleChart(
  definition: DashboardChartDefinition,
  chartDefinition: ChartDefinitionV1,
  height: number,
  loading: boolean,
  data: Array<{ ts: string; value: number | null }>,
  timeFilter: TimeFilterWindow = 'raw',
  manualYRange?: [number, number],
  interactionMode: 'standard' | 'touch-explore' = 'standard',
  smoothness: CurveSmoothness = DEFAULT_CURVE_SMOOTHNESS,
  isDark = false
) {
  const configured = configuredRichSeries(
    chartDefinition,
    {
      capacity_pct: {
        defaultColorToken: 'accent',
        series: {
          key: definition.id,
          label: definition.title,
          color: CHART_COLORS.accent,
          values: data.map((point) => point.value),
          mode: definition.mode ?? 'line',
        },
      },
    },
    isDark
  );
  return (
    <RichTimeSeriesChart
      points={data.map((point) => ({ ts: point.ts }))}
      series={configured}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={chartDefinition.axes.y.unit ?? definition.yUnit}
      yRange={manualYRange ?? fixedDefinitionRange(chartDefinition.axes.y) ?? definition.yRange}
      mode={definition.mode}
      timeFilter={timeFilter}
      smoothness={smoothness}
      xAxisLabel={chartDefinition.axes.x.label}
      yAxisLabel={chartDefinition.axes.y.label}
      showLegend={chartDefinition.display.legend !== 'hide'}
      showGrid={chartDefinition.display.grid}
      showTooltip={chartDefinition.display.tooltip}
      showPoints={chartDefinition.display.showPoints ?? false}
      connectGaps={chartDefinition.interaction.connectGaps}
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
  seriesColor,
  yRange,
}: {
  definition: DashboardChartDefinition;
  daily: Array<{
    day_local: string;
    day_start: string;
    total_energy_kwh: number;
    session_count: number;
  }>;
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
  seriesColor?: string;
  yRange?: [number, number];
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
      {...(seriesColor ? { seriesColor } : {})}
      {...(yRange ? { yRange } : {})}
    />
  );
}

function ChargeSessionCurveChart({
  definition,
  chartDefinition,
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
  chartDefinition: ChartDefinitionV1;
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
  const isDark = useDocumentTheme();
  const allRows = data.filter(
    (point) => Number.isFinite(point.soc_pct) && Number.isFinite(point.power_kw)
  );

  // Build time-based points when minutes_elapsed is available. This produces a
  // single chart with charge rate (left Y, kW) and cumulative energy (right Y, kWh)
  // on the same time axis — much easier to read than a SOC-on-X layout.
  const { points, rateValues, energyValues, useTime } = React.useMemo(() => {
    const startMs = startedAt ? new Date(startedAt).getTime() : null;
    const timed = startMs != null && allRows.some((p) => p.minutes_elapsed != null);

    // Drop trailing zero-power points: when ended_at is later than when charging
    // actually stopped, we accumulate a long flat zero tail. Keep only one point
    // past the last active reading so the dropoff is still visible.
    const lastActiveIdx = allRows.reduce((last, p, i) => ((p.power_kw ?? 0) > 0.1 ? i : last), -1);
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
    const targetEnergy =
      typeof sessionEnergyKwh === 'number' && Number.isFinite(sessionEnergyKwh)
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

  const configured = configuredRichSeries(
    chartDefinition,
    {
      energy_kwh: {
        defaultColorToken: 'emerald',
        series: {
          key: 'energy',
          label: 'Energy Added',
          color: CHART_COLORS.emerald,
          values: energyValues,
          mode: 'area',
          yScale: 'y2',
          filterable: false,
        },
      },
      power_kw: {
        defaultColorToken: 'accent',
        series: {
          key: 'rate',
          label: 'Charge Rate',
          color: CHART_COLORS.accent,
          values: rateValues,
          yScale: 'y',
        },
      },
    },
    isDark
  );

  return (
    <RichTimeSeriesChart
      points={points}
      series={configured}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      xTime={useTime}
      xUnit={useTime ? undefined : '%'}
      yUnit={chartDefinition.axes.y.unit ?? 'kW'}
      yRightUnit={chartDefinition.axes.y2?.unit ?? 'kWh'}
      yRange={yRange ?? fixedDefinitionRange(chartDefinition.axes.y)}
      yRightRange={yRightRange ?? fixedDefinitionRange(chartDefinition.axes.y2)}
      mode="line"
      xAxisLabel={chartDefinition.axes.x.label}
      yAxisLabel={chartDefinition.axes.y.label}
      yRightAxisLabel={chartDefinition.axes.y2?.label}
      xValueFormatter={useTime ? undefined : (value) => `${Math.round(value)}%`}
      xSplits={xSplits}
      timeFilter={timeFilter}
      smoothness={smoothness}
      showLegend={chartDefinition.display.legend !== 'hide'}
      showGrid={chartDefinition.display.grid}
      showTooltip={chartDefinition.display.tooltip}
      showPoints={chartDefinition.display.showPoints ?? false}
      connectGaps={chartDefinition.interaction.connectGaps}
      interactionMode={interactionMode}
    />
  );
}

function ChargingCurveAnalysisChart({
  definition,
  chartDefinition,
  data,
  loading,
  height,
  xRange,
  yRange,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  chartDefinition: ChartDefinitionV1;
  data: ChargeCurveAnalysisPoint[];
  loading: boolean;
  height: number;
  xRange?: [number, number];
  yRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
}) {
  const isDark = useDocumentTheme();
  const [mode, setMode] = React.useState<ChargeCurveMode>('observed');
  const [isMobile, setIsMobile] = React.useState(isMobileViewport);
  const plot = React.useMemo(() => buildChargeCurvePlot(data, mode), [data, mode]);

  React.useEffect(() => {
    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
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
  const primarySeries = chartDefinition.series[0];
  const observedColor = primarySeries
    ? resolveSeriesColor(primarySeries.color, 'accent', CHART_COLORS.accent, isDark)
    : CHART_COLORS.accent;

  return (
    <div className="relative h-full min-h-0">
      <RichTimeSeriesChart
        points={plot.rows.map((row) => ({ ts: row.plotSoc }))}
        series={[
          ...buildChargeCurveScatterSeries(
            plot.rows,
            observedColor,
            primarySeries?.label ?? 'Verified DC sessions'
          ),
          ...(plot.hasEstimatedHistory
            ? [
                {
                  key: 'dc-estimated-history',
                  label: 'Estimated history',
                  color: CHART_COLORS.amber,
                  mode: 'scatter' as const,
                  values: plot.rows.map((row) => row.estimatedKw),
                  tooltipDetails: plot.rows.map((row) => row.estimatedDetail),
                  pointSize: 6,
                },
              ]
            : []),
          ...(mode === 'off'
            ? []
            : ([
                {
                  key: 'dc-summary',
                  label: mode === 'observed' ? 'Observed trend' : 'Best observed trend (P75)',
                  color: CHART_COLORS.orange,
                  mode: 'line' as const,
                  values: plot.rows.map((row) => row.summaryKw),
                  tooltipDetails: plot.rows.map((row) => row.summaryDetail),
                },
              ] as const)),
        ]}
        loading={loading}
        emptyTitle={definition.emptyTitle}
        height={height}
        xTime={false}
        xUnit="%"
        yUnit="kW"
        xRange={xRange ?? fixedDefinitionRange(chartDefinition.axes.x) ?? [0, 100]}
        yRange={yRange ?? fixedDefinitionRange(chartDefinition.axes.y)}
        mode="scatter"
        connectGaps
        xSplits={isMobile ? [0, 20, 40, 60, 80, 100] : [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
        xValueFormatter={(value) => `${Math.round(value)}%`}
        interactionMode={interactionMode}
        xAxisLabel={chartDefinition.axes.x.label}
        yAxisLabel={chartDefinition.axes.y.label}
        showLegend={chartDefinition.display.legend !== 'hide'}
        showGrid={chartDefinition.display.grid}
        showTooltip={chartDefinition.display.tooltip}
        showPoints={chartDefinition.display.showPoints ?? true}
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
    .filter(
      (point): point is CurvePoint =>
        Number.isFinite(point.soc_pct) &&
        Number.isFinite(point.charge_rate_kw) &&
        point.charge_rate_kw > 0 &&
        normalizeChargeCurveType(point.charger_type) === 'dc'
    )
    .map((point) => ({
      ...point,
      sample_source: normalizeSampleSource(point.sample_source),
      power_method:
        point.power_method === 'recorded' ? ('recorded' as const) : ('soc_delta' as const),
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
        return {
          x: point.soc_pct,
          y: point.charge_rate_kw,
          weight: (1 - normalizedDistance ** 3) ** 3,
        };
      })
      .filter((point) => point.weight > 0);
    if (nearby.length < 3) continue;

    const regressionPoints =
      mode === 'best-observed'
        ? nearby.filter((point) => point.y >= weightedPercentile(nearby, 0.75))
        : nearby;
    const powerKw = weightedLinearPrediction(regressionPoints, socPct);
    if (powerKw == null) continue;
    trend.push({ socPct, powerKw, sampleCount: regressionPoints.length });
  }

  return trend;
}

function weightedLinearPrediction(
  points: Array<{ x: number; y: number; weight: number }>,
  atX: number
) {
  if (points.length === 0) return null;
  const sums = points.reduce<{ weight: number; x: number; y: number; xx: number; xy: number }>(
    (total, point) => ({
      weight: total.weight + point.weight,
      x: total.x + point.weight * point.x,
      y: total.y + point.weight * point.y,
      xx: total.xx + point.weight * point.x * point.x,
      xy: total.xy + point.weight * point.x * point.y,
    }),
    { weight: 0, x: 0, y: 0, xx: 0, xy: 0 }
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

function buildChargeCurveScatterSeries(
  rows: ChargeCurvePlotRow[],
  startColor: string = CHART_COLORS.accent,
  label = 'Verified DC sessions'
) {
  const values = rows
    .map((row) => row.observedKw)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const low = Math.min(...values);
  const high = Math.max(...values);

  return Array.from({ length: CHARGE_CURVE_SCATTER_BUCKETS }, (_, bucket) => ({
    key: `dc-observed-samples-${bucket}`,
    label,
    color: interpolateHexColor(
      startColor,
      CHART_COLORS.emerald,
      bucket / (CHARGE_CURVE_SCATTER_BUCKETS - 1)
    ),
    mode: 'scatter' as const,
    showInLegend: false,
    pointSize: 6,
    values: rows.map((row) =>
      chargeCurvePowerBucket(row.observedKw, low, high) === bucket ? row.observedKw : null
    ),
    tooltipDetails: rows.map((row) =>
      chargeCurvePowerBucket(row.observedKw, low, high) === bucket ? row.observedDetail : null
    ),
  }));
}

function chargeCurvePowerBucket(value: number | null, low: number, high: number) {
  if (value == null || !Number.isFinite(value)) return -1;
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low)
    return CHARGE_CURVE_SCATTER_BUCKETS - 1;
  return Math.min(
    CHARGE_CURVE_SCATTER_BUCKETS - 1,
    Math.floor(((value - low) / (high - low)) * CHARGE_CURVE_SCATTER_BUCKETS)
  );
}

function interpolateHexColor(start: string, end: string, ratio: number) {
  const parse = (color: string) =>
    [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const [startRed, startGreen, startBlue] = parse(start);
  const [endRed, endGreen, endBlue] = parse(end);
  const channel = (from: number, to: number) =>
    Math.round(from + (to - from) * ratio)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(startRed!, endRed!)}${channel(startGreen!, endGreen!)}${channel(startBlue!, endBlue!)}`;
}

function powerMethodLabel(points: CurvePoint[]) {
  const methods = new Set(points.map((point) => point.power_method));
  if (methods.size === 1 && methods.has('recorded')) return 'Recorded kW';
  if (methods.size === 1) return 'SoC/time estimate';
  return 'Recorded and SoC/time estimates';
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
  seriesColor,
}: {
  definition: DashboardChartDefinition;
  daily: Array<{
    day_local: string;
    day_start: string;
    total_energy_kwh: number;
    session_count: number;
  }>;
  loading: boolean;
  height: number;
  yRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
  seriesColor?: string;
}) {
  return (
    <DailyEnergyBarChart
      daily={daily}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yRange={yRange}
      interactionMode={interactionMode}
      {...(seriesColor ? { seriesColor } : {})}
    />
  );
}

function EfficiencyTrendChart({
  definition,
  chartDefinition,
  trend,
  loading,
  height,
  timeFilter,
  smoothness,
  yRange,
  interactionMode,
}: {
  definition: DashboardChartDefinition;
  chartDefinition: ChartDefinitionV1;
  trend: Array<{
    ts: string;
    trip_efficiency_wh_mi: number | null;
    rolling_24h_wh_mi: number | null;
  }>;
  loading: boolean;
  height: number;
  timeFilter: TimeFilterWindow;
  smoothness: CurveSmoothness;
  yRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
}) {
  const isDark = useDocumentTheme();
  const unit = getEfficiencyUnit();
  const configured = configuredRichSeries(
    chartDefinition,
    {
      trip_efficiency_wh_mi: {
        defaultColorToken: 'accent',
        series: {
          key: 'trip',
          label: 'Trip efficiency',
          color: CHART_COLORS.accent,
          values: trend.map((point) => convertEfficiency(point.trip_efficiency_wh_mi)),
        },
      },
      rolling_24h_wh_mi: {
        defaultColorToken: 'emerald',
        series: {
          key: 'rolling',
          label: '24-hour avg',
          color: CHART_COLORS.emerald,
          values: trend.map((point) => convertEfficiency(point.rolling_24h_wh_mi)),
        },
      },
    },
    isDark
  );
  return (
    <RichTimeSeriesChart
      points={trend.map((point) => ({ ts: point.ts }))}
      series={configured}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={unit}
      yRange={yRange}
      mode={definition.mode}
      timeFilter={timeFilter}
      smoothness={smoothness}
      xAxisLabel={chartDefinition.axes.x.label}
      yAxisLabel={chartDefinition.axes.y.label}
      showLegend={chartDefinition.display.legend !== 'hide'}
      showGrid={chartDefinition.display.grid}
      showTooltip={chartDefinition.display.tooltip}
      showPoints={chartDefinition.display.showPoints ?? false}
      connectGaps={chartDefinition.interaction.connectGaps}
      interactionMode={interactionMode}
    />
  );
}

function EfficiencyTemperatureChart({
  definition,
  chartDefinition,
  data,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  chartDefinition: ChartDefinitionV1;
  data: Array<{
    temp_c_low: number;
    temp_c_high: number;
    avg_efficiency_wh_mi: number | null;
    total_miles?: number | null;
    avg_speed_mph?: number | null;
  }>;
  loading: boolean;
  height: number;
}) {
  const isDark = useDocumentTheme();
  const seriesColor = editedSeriesColor(chartDefinition, 'accent', isDark);
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
      data={points.filter(
        (point): point is (typeof points)[number] & { value: number } => point.value != null
      )}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      valueUnit={getEfficiencyUnit()}
      {...(seriesColor ? { seriesColor } : {})}
    />
  );
}

function EfficiencyModeChart({
  definition,
  chartDefinition,
  data,
  loading,
  height,
}: {
  definition: DashboardChartDefinition;
  chartDefinition: ChartDefinitionV1;
  data: Array<{ drive_mode: string; avg_efficiency: number | null; trip_count?: number | null }>;
  loading: boolean;
  height: number;
}) {
  const isDark = useDocumentTheme();
  const seriesColor = editedSeriesColor(chartDefinition, 'accent', isDark);
  const rows = data
    .filter((point) => point.avg_efficiency != null)
    .map((point) => ({
      label: formatDriveModeLabel(point.drive_mode),
      value: convertEfficiency(point.avg_efficiency),
      count: typeof point.trip_count === 'number' ? point.trip_count : null,
    }))
    .filter(
      (point): point is { label: string; value: number; count: number | null } =>
        point.value != null
    );

  return (
    <EfficiencyPillBarChart
      data={rows}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      valueUnit={getEfficiencyUnit()}
      {...(seriesColor ? { seriesColor } : {})}
    />
  );
}

function EfficiencyTagsChart({
  chartDefinition,
  data,
  loading,
  height,
  hasTagFilter,
}: {
  chartDefinition: ChartDefinitionV1;
  data: Array<{
    tag_id: string | null;
    tag_name: string;
    trip_count: number;
    total_miles: number;
    efficiency_miles: number;
    avg_efficiency_wh_mi: number | null;
    coverage: number;
  }>;
  loading: boolean;
  height: number;
  hasTagFilter: boolean;
}) {
  const isDark = useDocumentTheme();
  const seriesColor = editedSeriesColor(chartDefinition, 'accent', isDark);
  const rows = data
    .filter((point) => point.avg_efficiency_wh_mi != null)
    .map((point) => ({
      label: point.tag_name,
      value: convertEfficiency(point.avg_efficiency_wh_mi),
      count: point.trip_count,
      distance: point.total_miles,
      coverage: point.coverage,
      tone: point.tag_id == null ? ('neutral' as const) : ('accent' as const),
    }))
    .filter(
      (
        point
      ): point is {
        label: string;
        value: number;
        count: number;
        distance: number;
        coverage: number;
        tone: 'accent' | 'neutral';
      } => point.value != null
    );
  const emptyTitle = hasTagFilter
    ? 'No trips match these tag filters. Clear filters above or choose another range.'
    : data.length > 0
      ? 'Trips in this range do not have efficiency readings yet.'
      : 'No trips in this period.';

  return (
    <EfficiencyPillBarChart
      data={rows}
      loading={loading}
      emptyTitle={emptyTitle}
      height={height}
      valueUnit={getEfficiencyUnit()}
      wideLabels
      {...(seriesColor ? { seriesColor } : {})}
    />
  );
}

function formatDriveModeLabel(value: string) {
  return formatDriveMode(value);
}

type EstablishedRichSeries = { series: RichSeries; defaultColorToken?: string };

function editedSeriesColor(
  definition: ChartDefinitionV1,
  defaultColorToken: string,
  isDark: boolean
) {
  const color = definition.series[0]?.color;
  if (!color || (color.mode === 'token' && color.token === defaultColorToken)) return undefined;
  return color.mode === 'token' ? getChartColor(color.token) : isDark ? color.dark : color.light;
}

function resolveSeriesColor(
  color: ChartDefinitionV1['series'][number]['color'],
  defaultColorToken: string,
  establishedColor: string,
  isDark: boolean
) {
  if (color.mode === 'token')
    return color.token === defaultColorToken ? establishedColor : getChartColor(color.token);
  return isDark ? color.dark : color.light;
}

function configuredRichSeries(
  definition: ChartDefinitionV1,
  establishedByField: Record<string, EstablishedRichSeries>,
  isDark: boolean
) {
  return definition.series.flatMap((item) => {
    const established = establishedByField[item.y.field];
    if (!established) return [];
    const color = resolveSeriesColor(
      item.color,
      established.defaultColorToken ?? '',
      established.series.color ?? getChartColor('accent'),
      isDark
    );
    return [
      {
        ...established.series,
        key: established.series.key || item.id,
        label: item.label,
        color,
        mode: chartSeriesMode(item),
        ...(item.mark === 'step' ? { interpolation: 'step' as const } : {}),
        yScale: item.yAxis,
        ...(item.visibleInLegend !== undefined ? { showInLegend: item.visibleInLegend } : {}),
        ...(item.pointSize !== undefined ? { pointSize: item.pointSize } : {}),
        ...(item.strokeWidth !== undefined ? { strokeWidth: item.strokeWidth } : {}),
        ...(item.stackId !== undefined ? { stackId: item.stackId } : {}),
      } satisfies RichSeries,
    ];
  });
}

function chartSeriesMode(
  series: ChartDefinitionV1['series'][number]
): NonNullable<RichSeries['mode']> {
  if (series.mark === 'bar' || series.mark === 'histogram') return 'bar';
  if (series.mark === 'scatter') return 'scatter';
  if (series.mark === 'area' || ((series.mark === 'line' || series.mark === 'step') && series.fill))
    return 'area';
  return 'line';
}

function fixedDefinitionRange(
  axis: ChartDefinitionV1['axes']['y'] | ChartDefinitionV1['axes']['x'] | undefined
) {
  return axis?.domain.mode === 'fixed'
    ? ([axis.domain.min, axis.domain.max] as [number, number])
    : undefined;
}

function batteryMileageDomainValue(
  point: {
    ts: string;
    x: number | null;
    y?: number | null;
    rangeMi: number | null;
    projectedMaxRangeMi: number | null;
    degradationPct?: number | null;
  },
  chartDefinition: ChartDefinitionV1
) {
  if (chartDefinition.x.kind === 'time') {
    return chartDefinition.x.field.field === 'timestamp'
      ? new Date(point.ts).getTime() / 1000
      : Number.NaN;
  }

  const value = (() => {
    switch (chartDefinition.x.field.field) {
      case 'odometer_miles':
        return point.x;
      case 'usable_kwh':
        return point.y;
      case 'range_mi':
        return point.rangeMi;
      case 'projected_max_range_mi':
        return point.projectedMaxRangeMi;
      case 'degradation_pct':
        return point.degradationPct;
      default:
        return null;
    }
  })();
  return value == null ? Number.NaN : Number(value);
}

function BatteryCapacityMileageChart({
  definition,
  chartDefinition,
  points,
  loading,
  height,
  timeFilter,
  smoothness,
  xRange,
  yRange,
  yRightRange,
  interactionMode,
  onResolvedAxisRanges,
}: {
  definition: DashboardChartDefinition;
  chartDefinition: ChartDefinitionV1;
  points: Array<{
    ts: string;
    x: number | null;
    y: number | null;
    rangeMi: number | null;
    projectedMaxRangeMi: number | null;
    degradationPct: number | null;
  }>;
  loading: boolean;
  height: number;
  timeFilter: TimeFilterWindow;
  smoothness: CurveSmoothness;
  xRange?: [number, number];
  yRange?: [number, number];
  yRightRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
  onResolvedAxisRanges?: (ranges: DashboardChartResolvedAxisRanges) => void;
}) {
  const isDark = useDocumentTheme();
  const useTime = chartDefinition.x.kind === 'time';
  const rows = points
    .filter((point) => point.x != null || point.y != null)
    .map((point) => ({
      ...point,
      domain: batteryMileageDomainValue(point, chartDefinition),
    }))
    .filter((point) => Number.isFinite(point.domain))
    .sort((a, b) => a.domain - b.domain);
  const series = configuredRichSeries(
    chartDefinition,
    {
      usable_kwh: {
        defaultColorToken: 'accent',
        series: {
          key: 'usable-capacity',
          label: 'Usable Capacity',
          color: CHART_COLORS.accent,
          mode: 'area',
          values: rows.map((point) => point.y),
          yScale: 'y',
        },
      },
      odometer_miles: {
        defaultColorToken: 'emerald',
        series: {
          key: 'odometer-mi',
          label: 'Mileage',
          color: CHART_COLORS.emerald,
          mode: 'line',
          values: rows.map((point) => point.x),
          yScale: 'y2',
          filterable: false,
        },
      },
      range_mi: {
        series: { key: 'range-mi', label: 'Range', values: rows.map((point) => point.rangeMi) },
      },
      projected_max_range_mi: {
        series: {
          key: 'projected-range-mi',
          label: 'Projected Range',
          values: rows.map((point) => point.projectedMaxRangeMi),
        },
      },
      degradation_pct: {
        series: {
          key: 'degradation-pct',
          label: 'Degradation',
          values: rows.map((point) => point.degradationPct),
        },
      },
    },
    isDark
  );
  const yValues = (series.find((item) => item.yScale === 'y')?.values ?? []).filter(
    (value): value is number => value != null && Number.isFinite(value)
  );
  const yPrecision = getBatteryCapacityMileagePrecision(yValues);
  const autoYRange = getBatteryCapacityMileageYRange(yValues);
  const primaryUsesCapacity = chartDefinition.series.some(
    (item) => item.yAxis === 'y' && item.y.field === 'usable_kwh'
  );

  return (
    <RichTimeSeriesChart
      points={rows.map((point) => ({ ts: useTime ? point.ts : point.domain }))}
      series={series}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={chartDefinition.axes.y.unit ?? definition.yUnit}
      yRange={
        yRange ??
        fixedDefinitionRange(chartDefinition.axes.y) ??
        (primaryUsesCapacity ? autoYRange : undefined) ??
        definition.yRange
      }
      yRightUnit={chartDefinition.axes.y2?.unit ?? 'mi'}
      yRightRange={yRightRange ?? fixedDefinitionRange(chartDefinition.axes.y2)}
      mode={definition.mode}
      xTime={useTime}
      xUnit={chartDefinition.axes.x.unit}
      xRange={xRange ?? fixedDefinitionRange(chartDefinition.axes.x)}
      xAxisLabel={chartDefinition.axes.x.label}
      yAxisLabel={chartDefinition.axes.y.label}
      yRightAxisLabel={chartDefinition.axes.y2?.label}
      timeFilter={timeFilter}
      smoothness={smoothness}
      showLegend={chartDefinition.display.legend !== 'hide'}
      showGrid={chartDefinition.display.grid}
      showTooltip={chartDefinition.display.tooltip}
      showPoints={chartDefinition.display.showPoints ?? false}
      connectGaps={chartDefinition.interaction.connectGaps}
      yAxisValueFormatter={(value, unit) => formatChartNumber(value, unit, 0)}
      yRightAxisValueFormatter={(value, unit) => formatChartNumber(value, unit, 0)}
      yValueFormatter={(value, unit) => formatChartNumber(value, unit, yPrecision)}
      interactionMode={interactionMode}
      onResolvedAxisRanges={onResolvedAxisRanges}
    />
  );
}

export function getBatteryCapacityMileageYRange(values: Array<number | null | undefined>) {
  const populated = values.filter(
    (value): value is number => value != null && Number.isFinite(value)
  );
  if (populated.length === 0) return undefined;

  const max = Math.max(...populated);
  return [0, max > 0 ? Math.ceil(max * 1.1) : 1] as [number, number];
}

function ProjectedRangeMileageChart({
  definition,
  chartDefinition,
  points,
  loading,
  height,
  timeFilter,
  smoothness,
  xRange,
  yRange: manualYRange,
  yRightRange,
  interactionMode,
  onResolvedAxisRanges,
}: {
  definition: DashboardChartDefinition;
  chartDefinition: ChartDefinitionV1;
  points: Array<{
    ts: string;
    rangeMi: number | null;
    projectedMaxRangeMi: number | null;
    x: number | null;
  }>;
  loading: boolean;
  height: number;
  timeFilter: TimeFilterWindow;
  smoothness: CurveSmoothness;
  xRange?: [number, number];
  yRange?: [number, number];
  yRightRange?: [number, number];
  interactionMode: 'standard' | 'touch-explore';
  onResolvedAxisRanges?: (ranges: DashboardChartResolvedAxisRanges) => void;
}) {
  const isDark = useDocumentTheme();
  const useTime = chartDefinition.x.kind === 'time';
  const rows = points
    .filter((point) => point.x != null)
    .map((point) => ({
      ts: point.ts,
      projectedRangeMi: point.projectedMaxRangeMi ?? point.rangeMi,
      odometerMi: point.x,
      domain: batteryMileageDomainValue(point, chartDefinition),
    }))
    .filter((point) => Number.isFinite(point.domain))
    .sort((a, b) => a.domain - b.domain);
  const series = configuredRichSeries(
    chartDefinition,
    {
      projected_max_range_mi: {
        defaultColorToken: 'amber',
        series: {
          key: definition.id,
          label: 'Projected Max Range',
          values: rows.map((point) => point.projectedRangeMi),
          color: CHART_COLORS.amber,
          mode: 'area',
        },
      },
      odometer_miles: {
        defaultColorToken: 'emerald',
        series: {
          key: 'odometer-mi',
          label: 'Mileage',
          values: rows.map((point) => point.odometerMi),
          color: CHART_COLORS.emerald,
          mode: 'line',
          yScale: 'y2',
        },
      },
    },
    isDark
  );
  const yRange =
    manualYRange ??
    fixedDefinitionRange(chartDefinition.axes.y) ??
    getProjectedRangeMileageYRange(series.find((item) => item.yScale !== 'y2')?.values ?? []);

  return (
    <RichTimeSeriesChart
      points={rows.map((point) => ({ ts: useTime ? point.ts : point.domain }))}
      series={series}
      loading={loading}
      emptyTitle={definition.emptyTitle}
      height={height}
      yUnit={chartDefinition.axes.y.unit ?? definition.yUnit}
      yRange={yRange ?? fixedDefinitionRange(chartDefinition.axes.y)}
      yRightUnit={chartDefinition.axes.y2?.unit ?? 'mi'}
      yRightRange={yRightRange ?? fixedDefinitionRange(chartDefinition.axes.y2)}
      mode={definition.mode}
      xTime={useTime}
      xUnit={chartDefinition.axes.x.unit}
      xRange={xRange ?? fixedDefinitionRange(chartDefinition.axes.x)}
      xAxisLabel={chartDefinition.axes.x.label}
      yAxisLabel={chartDefinition.axes.y.label}
      yRightAxisLabel={chartDefinition.axes.y2?.label}
      timeFilter={timeFilter}
      smoothness={smoothness}
      showLegend={chartDefinition.display.legend !== 'hide'}
      showGrid={chartDefinition.display.grid}
      showTooltip={chartDefinition.display.tooltip}
      showPoints={chartDefinition.display.showPoints ?? false}
      connectGaps={chartDefinition.interaction.connectGaps}
      interactionMode={interactionMode}
      onResolvedAxisRanges={onResolvedAxisRanges}
    />
  );
}

export function getProjectedRangeMileageYRange(values: Array<number | null | undefined>) {
  const populated = values.filter(
    (value): value is number => value != null && Number.isFinite(value)
  );
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
    ? isMetric
      ? 'Wh/km'
      : 'Wh/mi'
    : isMetric
      ? 'km/kWh'
      : 'mi/kWh';
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
  return (
    value === 'overview' ||
    value === 'battery' ||
    value === 'charging' ||
    value === 'efficiency' ||
    value === 'trips'
  );
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

function normalizeChartAxisSettingsMap(
  value: unknown
): Partial<Record<DashboardChartAxisId, DashboardChartAxisRangeSetting>> {
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
  const mode =
    settings.mode === 'manual' ? 'manual' : settings.mode === 'auto' ? 'auto' : undefined;
  const min =
    typeof settings.min === 'number' && Number.isFinite(settings.min) ? settings.min : undefined;
  const max =
    typeof settings.max === 'number' && Number.isFinite(settings.max) ? settings.max : undefined;

  if (!mode && min == null && max == null) return null;
  return {
    ...(mode ? { mode } : {}),
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
  };
}

function resolveChartDisplaySettings(
  allSettings: Record<string, DashboardChartDisplaySettings>,
  chartId: string,
  legacyTimeFilter: TimeFilterWindow,
  legacySmoothness: CurveSmoothness
) {
  const chartSettings = allSettings[chartId] ?? {};
  const axes = chartSettings.axes ?? {};
  return {
    timeFilter:
      chartSettings.timeFilter ??
      (chartSettings.smoothing == null
        ? legacyTimeFilter
        : legacySmoothingToTimeFilter(chartSettings.smoothing)),
    axes,
    smoothness:
      chartSettings.smoothness ??
      normalizeCurveSmoothness(chartSettings.smoothing, legacySmoothness),
  };
}

function setChartSettingsEntry(
  current: Record<string, DashboardChartDisplaySettings>,
  chartId: string,
  chartSettings: DashboardChartDisplaySettings
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

function sameResolvedAxisRanges(
  left: DashboardChartResolvedAxisRanges,
  right: DashboardChartResolvedAxisRanges
) {
  return (
    left.y?.[0] === right.y?.[0] &&
    left.y?.[1] === right.y?.[1] &&
    left.y2?.[0] === right.y2?.[0] &&
    left.y2?.[1] === right.y2?.[1]
  );
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
  settings: DashboardChartDisplaySettings & {
    timeFilter: TimeFilterWindow;
    axes: Partial<Record<DashboardChartAxisId, DashboardChartAxisRangeSetting>>;
  };
  suggestedRanges: DashboardChartResolvedAxisRanges;
  persistent: boolean;
  onClose: () => void;
  onTimeFilterChange: (next: TimeFilterWindow) => void;
  onSmoothnessChange: (next: CurveSmoothness) => void;
  onAxisModeChange: (axisId: DashboardChartAxisId, mode: DashboardChartAxisMode) => void;
  onAxisValueChange: (
    axisId: DashboardChartAxisId,
    bound: 'min' | 'max',
    value: number | undefined
  ) => void;
}

function ChartSettingsPanel({
  open,
  triggerRef,
  chartTitle,
  capabilities,
  settings,
  suggestedRanges,
  persistent,
  onClose,
  onTimeFilterChange,
  onSmoothnessChange,
  onAxisModeChange,
  onAxisValueChange,
}: ChartSettingsPanelProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const timeFilterIndex = Math.max(
    0,
    TIME_FILTER_OPTIONS.findIndex((option) => option.value === settings.timeFilter)
  );
  const smoothnessIndex = Math.max(
    0,
    CURVE_SMOOTHNESS_OPTIONS.findIndex(
      (option) => option.value === (settings.smoothness ?? DEFAULT_CURVE_SMOOTHNESS)
    )
  );
  const axisEntries = AXIS_ORDER.flatMap((axisId) =>
    capabilities.axes[axisId] ? [[axisId, capabilities.axes[axisId]] as const] : []
  );
  const hasControls =
    capabilities.timeFilter || capabilities.smoothness === true || axisEntries.length > 0;

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

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-bg-page/70 p-3 backdrop-blur-sm"
        onMouseDown={onClose}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Chart settings"
          className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-bg-surface shadow-xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                Chart settings
              </p>
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
          <div className="grid gap-3 p-4">
            {capabilities.timeFilter || capabilities.smoothness ? (
              <details
                open
                className="group overflow-hidden rounded-xl border border-border bg-bg-elevated/50"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-fg marker:hidden">
                  <span>
                    <span className="block text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                      Display
                    </span>
                    <span>Filter &amp; curve</span>
                  </span>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-fg-tertiary transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="grid gap-3 border-t border-border p-3">
                  {capabilities.timeFilter ? (
                    <section className="grid gap-2 rounded-lg border border-border bg-bg-surface/70 p-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                          Display filter
                        </p>
                        <p className="text-sm text-fg">Time window</p>
                      </div>
                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-xs text-fg-tertiary">
                          <span>All compatible curves keep their recorded timestamps.</span>
                          <span>{timeFilterLabel(settings.timeFilter)}</span>
                        </div>
                        <input
                          aria-label="Display filter"
                          type="range"
                          min={0}
                          max={TIME_FILTER_OPTIONS.length - 1}
                          step={1}
                          value={timeFilterIndex}
                          onChange={(event) =>
                            onTimeFilterChange(
                              TIME_FILTER_OPTIONS[Number(event.target.value)]!.value
                            )
                          }
                          className="rm-accent-range w-full"
                        />
                      </div>
                    </section>
                  ) : null}
                  {capabilities.smoothness ? (
                    <section className="grid gap-2 rounded-lg border border-border bg-bg-surface/70 p-3">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                          Curve smoothness
                        </p>
                        <p className="text-sm text-fg">Path between recorded points</p>
                      </div>
                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-xs text-fg-tertiary">
                          <span>Values and timestamps stay unchanged.</span>
                          <span>
                            {curveSmoothnessLabel(settings.smoothness ?? DEFAULT_CURVE_SMOOTHNESS)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={CURVE_SMOOTHNESS_OPTIONS.length - 1}
                          step={1}
                          value={smoothnessIndex}
                          onChange={(event) =>
                            onSmoothnessChange(
                              CURVE_SMOOTHNESS_OPTIONS[Number(event.target.value)]!.value
                            )
                          }
                          className="rm-accent-range w-full"
                          aria-label="Curve smoothness"
                        />
                      </div>
                    </section>
                  ) : null}
                </div>
              </details>
            ) : null}
            {axisEntries.length > 0 ? (
              <details
                open
                className="group overflow-hidden rounded-xl border border-border bg-bg-elevated/50"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-fg marker:hidden">
                  <span>
                    <span className="block text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">
                      Scale controls
                    </span>
                    <span>Axes</span>
                  </span>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-fg-tertiary transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="grid gap-2 border-t border-border p-3">
                  <p className="text-xs text-fg-tertiary">
                    Auto or manual range for each supported axis.
                  </p>
                  {axisEntries.map(([axisId, capability]) => (
                    <ChartAxisRangeField
                      key={axisId}
                      axisId={axisId}
                      capability={capability}
                      setting={settings.axes[axisId]}
                      {...(axisId !== 'x' && suggestedRanges[axisId]
                        ? { suggestedRange: suggestedRanges[axisId] }
                        : {})}
                      onModeChange={onAxisModeChange}
                      onValueChange={onAxisValueChange}
                    />
                  ))}
                </div>
              </details>
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
      </div>
    </>,
    document.body
  );
}

function ChartAxisRangeField({
  axisId,
  capability,
  setting,
  suggestedRange,
  onModeChange,
  onValueChange,
}: {
  axisId: DashboardChartAxisId;
  capability: DashboardChartAxisCapability;
  setting: DashboardChartAxisRangeSetting | undefined;
  suggestedRange?: [number, number];
  onModeChange: (axisId: DashboardChartAxisId, mode: DashboardChartAxisMode) => void;
  onValueChange: (
    axisId: DashboardChartAxisId,
    bound: 'min' | 'max',
    value: number | undefined
  ) => void;
}) {
  const mode = setting?.mode === 'manual' ? 'manual' : 'auto';
  const hasValidRange = Boolean(getManualAxisRange(setting));

  return (
    <div className="rounded-lg border border-border bg-bg-surface/70 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg">
          {capability.label}
          {capability.unit ? (
            <span className="ml-1 text-fg-tertiary">({capability.unit})</span>
          ) : null}
        </p>
        <div className="inline-flex rounded-lg border border-border bg-bg-elevated p-0.5">
          {(['auto', 'manual'] as const).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              onClick={() => onModeChange(axisId, nextMode)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                mode === nextMode
                  ? 'bg-accent text-fg-on-accent'
                  : 'text-fg-secondary hover:text-fg'
              )}
            >
              {nextMode === 'auto' ? 'Auto' : 'Manual'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'manual' ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="grid min-w-0 gap-1 text-xs font-medium text-fg-secondary">
            <span>Min</span>
            <input
              aria-label={`${capability.label} minimum`}
              type="number"
              inputMode="decimal"
              step={getAxisInputStep(capability.unit)}
              value={setting?.min ?? suggestedRange?.[0] ?? ''}
              onChange={(event) =>
                onValueChange(axisId, 'min', parseAxisInputValue(event.target.value))
              }
              className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-medium text-fg-secondary">
            <span>Max</span>
            <input
              aria-label={`${capability.label} maximum`}
              type="number"
              inputMode="decimal"
              step={getAxisInputStep(capability.unit)}
              value={setting?.max ?? suggestedRange?.[1] ?? ''}
              onChange={(event) =>
                onValueChange(axisId, 'max', parseAxisInputValue(event.target.value))
              }
              className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          {!hasValidRange ? (
            <p className="col-span-2 text-[11px] text-fg-tertiary">
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
    chartId: 'projected-range-mileage',
    showPicker: true,
    timeFilter: DEFAULT_CHART_TIME_FILTER,
  },
  component: DashboardChartWidget,
});
