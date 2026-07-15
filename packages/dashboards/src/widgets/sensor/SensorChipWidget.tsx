import React from 'react';
import { Icon } from '@iconify/react';
import { CircleHelp } from 'lucide-react';
import {
  useBatteryHealth,
  useChargingSummary,
  useCurrentVehicleStatus,
  useEfficiencySummary,
  useMetricSeries,
  useMetricValue,
} from '@riviamigo/hooks';
import {
  DEFAULT_SPRITE_TIME_FILTER,
  getChartColor,
  MiniSparkline,
  normalizeTimeFilter,
  type ChartColorKey,
  type MiniSparklineType,
  type TimeFilterWindow,
} from '@riviamigo/ui/charts';
import { Badge, Card, Tooltip } from '@riviamigo/ui/primitives';
import {
  cn,
  formatCurrency,
  formatDuration,
  formatEfficiency,
  formatKwh,
  formatMiles,
  formatMph,
  formatPressure,
  formatTemp,
} from '@riviamigo/ui/lib/utils';
import { presentVehicleStatusDefinition, type StatusTone } from '@riviamigo/ui/lib/vehicleStatus';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';
import {
  useDashboardDataAvailable,
  useDashboardDataSelector,
  useDashboardMetric,
  type DashboardDataRequirements,
} from '../../dashboardData';
import { resolveIconId } from '../../editor/iconMigration';
import { seriesToDailyDeltas } from '../../editor/dailyDelta';
import type { TripRow } from '@riviamigo/ui/tables';
import { useTripSelection } from '../table/tripSelectionStore';
import {
  computeTripStat,
  formatTripSelectionLabel,
  formatTripStat,
  getTripStatKind,
} from '../table/tripStatMetrics';
import {
  getSensorDefinition,
  SENSOR_DEFINITIONS,
  type SensorChartType,
  type SensorDataSource,
  type SensorIconKey,
  type SensorValueColor,
} from './sensorDefinitions';

interface SensorChipOptions {
  metric?: string;
  icon?: SensorIconKey;
  chartType?: SensorChartType;
  dataSource?: SensorDataSource;
  valuePath?: string;
  fallbackValuePath?: string;
  valueFormula?: string;
  unit?: string | null;
  inlineSecondaryPath?: string;
  inlineSecondaryFormula?: string;
  inlineSecondaryTemplate?: string;
  inlineSecondaryUnit?: string | null;
  inlineSecondaryPrefix?: string;
  secondaryTemplate?: string;
  helpText?: string;
  labelSuffix?: string;
  showSprite?: boolean;
  showSubtitle?: boolean;
  subtitle?: string;
  accentBorder?: boolean;
  valueSize?: 'sm' | 'md' | 'lg';
  valueColor?: SensorValueColor;
  valueMode?: 'latest' | 'sum' | 'avg' | 'count';
  timeFilter?: TimeFilterWindow;
  curveSmoothing?: number | boolean;
  curveColor?: ChartColorKey;
  windowDays?: number;
  timeframeScope?: 'range' | 'current' | 'lifetime';
  tripSelectionAware?: boolean;
}

const DEFAULT_WINDOW_DAYS = 30;

function readOptions(instance: WidgetInstance): Required<SensorChipOptions> {
  const definition = getSensorDefinition(instance.definitionId) ?? SENSOR_DEFINITIONS[0]!;
  const options = (instance.options ?? {}) as SensorChipOptions;
  const chartType = options.chartType ?? definition.chartType;

  return {
    metric: options.metric ?? definition.metric ?? '',
    icon: options.icon ?? definition.icon,
    chartType,
    dataSource: options.dataSource ?? definition.dataSource ?? 'metric',
    valuePath: options.valuePath ?? definition.valuePath ?? '',
    fallbackValuePath: options.fallbackValuePath ?? definition.fallbackValuePath ?? '',
    valueFormula: options.valueFormula ?? definition.valueFormula ?? '',
    unit: options.unit ?? definition.unit ?? null,
    inlineSecondaryPath: options.inlineSecondaryPath ?? definition.inlineSecondaryPath ?? '',
    inlineSecondaryFormula:
      options.inlineSecondaryFormula ?? definition.inlineSecondaryFormula ?? '',
    inlineSecondaryTemplate:
      options.inlineSecondaryTemplate ?? definition.inlineSecondaryTemplate ?? '',
    inlineSecondaryUnit: options.inlineSecondaryUnit ?? definition.inlineSecondaryUnit ?? null,
    inlineSecondaryPrefix: options.inlineSecondaryPrefix ?? definition.inlineSecondaryPrefix ?? '',
    secondaryTemplate: options.secondaryTemplate ?? definition.secondaryTemplate ?? '',
    helpText: options.helpText ?? definition.helpText ?? '',
    labelSuffix: options.labelSuffix ?? definition.labelSuffix ?? '',
    showSprite: options.showSprite ?? true,
    showSubtitle: options.showSubtitle ?? false,
    subtitle: options.subtitle ?? '',
    accentBorder: options.accentBorder ?? definition.accent ?? false,
    valueSize: options.valueSize ?? 'md',
    valueColor: options.valueColor ?? definition.valueColor ?? 'accent',
    valueMode: options.valueMode ?? definition.valueMode,
    curveColor: options.curveColor ?? 'accent',
    timeframeScope: options.timeframeScope ?? definition.timeframeScope ?? 'range',
    tripSelectionAware: options.tripSelectionAware ?? false,
    curveSmoothing: options.curveSmoothing ?? 0,
    timeFilter: normalizeTimeFilter(options.timeFilter, legacySmoothingToTimeFilter(options.curveSmoothing, chartType)),
    windowDays:
      typeof options.windowDays === 'number' && Number.isFinite(options.windowDays)
        ? Math.max(1, Math.min(365, Math.round(options.windowDays)))
        : DEFAULT_WINDOW_DAYS,
  };
}

export function SensorChipWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const definition = getSensorDefinition(instance.definitionId);
  const options = readOptions(instance);
  const metric = options.dataSource === 'metric' ? options.metric : null;
  const { selectedIds, tripRegistry } = useTripSelection();
  const needsHealth = options.dataSource === 'batteryHealth';
  const needsCharging = options.dataSource === 'chargingSummary';
  const needsEfficiency = metric === 'avg_efficiency' || options.dataSource === 'efficiencySummary';
  const needsStatus = options.dataSource === 'vehicleStatus' || usesStatus(options);
  const tripSelectionStat = (ctx.dashboardSlug === 'trips' || options.tripSelectionAware)
    ? getTripStatKind(metric)
    : null;
  const selectedTrips = tripSelectionStat
    ? selectedIds.map((id) => tripRegistry[id]).filter((trip): trip is TripRow => Boolean(trip))
    : [];
  const activeTripSelectionStat = tripSelectionStat != null && selectedTrips.length > 0 ? tripSelectionStat : null;
  const selectionLabel = activeTripSelectionStat ? formatTripSelectionLabel(selectedTrips.length) : null;
  const selectionValue = activeTripSelectionStat ? computeTripStat(activeTripSelectionStat, selectedTrips) : null;
  const dashboardDataAvailable = useDashboardDataAvailable();
  const dashboardMetric = useDashboardMetric(metric);
  const dashboardStatus = useDashboardDataSelector((snapshot) => snapshot.status);
  const dashboardHealth = useDashboardDataSelector((snapshot) => snapshot.batteryHealth);
  const dashboardCharging = useDashboardDataSelector((snapshot) => snapshot.chargingSummary);
  const dashboardEfficiency = useDashboardDataSelector((snapshot) => snapshot.efficiencySummary);
  const dashboardRefreshing = useDashboardDataSelector((snapshot) => snapshot.isRefreshing) ?? false;
  const { data: fetchedValue } = useMetricValue(
    dashboardDataAvailable ? null : ctx.vehicleId,
    dashboardDataAvailable ? null : metric,
    ctx.from,
    ctx.to,
  );
  const { data: fetchedSeries = [] } = useMetricSeries(
    dashboardDataAvailable ? null : ctx.vehicleId,
    dashboardDataAvailable ? null : metric,
    ctx.from,
    ctx.to,
  );
  const { data: fetchedEfficiencySummary } = useEfficiencySummary(
    !dashboardDataAvailable && needsEfficiency ? ctx.vehicleId : null,
    ctx.from,
    ctx.to
  );
  const { data: fetchedHealth, isLoading: healthLoading } = useBatteryHealth(
    !dashboardDataAvailable && needsHealth ? ctx.vehicleId : null
  );
  const { data: fetchedChargingSummary, isLoading: chargingLoading } = useChargingSummary(
    !dashboardDataAvailable && needsCharging ? ctx.vehicleId : null,
    ctx.from,
    ctx.to
  );
  const { data: fetchedStatus, isLoading: statusLoading } = useCurrentVehicleStatus(
    !dashboardDataAvailable && needsStatus ? ctx.vehicleId : null
  );
  const value = dashboardDataAvailable ? dashboardMetric?.value : fetchedValue;
  const series = dashboardDataAvailable ? dashboardMetric?.series ?? [] : fetchedSeries;
  const efficiencySummary = dashboardDataAvailable ? dashboardEfficiency : fetchedEfficiencySummary;
  const health = dashboardDataAvailable ? dashboardHealth : fetchedHealth;
  const chargingSummary = dashboardDataAvailable ? dashboardCharging : fetchedChargingSummary;
  const status = dashboardDataAvailable ? dashboardStatus : fetchedStatus;
  const title = instance.title ?? definition?.title ?? value?.label ?? options.metric;
  const iconId = resolveIconId(options.icon);
  const sourceValues = buildSourceValues(options.dataSource, health, chargingSummary, efficiencySummary, status);
  const timeframeScope = options.timeframeScope;
  const isLifetimeTimeframe = ctx.timeframe?.kind === 'lifetime';
  const allowLatestFallback = timeframeScope !== 'range' || isLifetimeTimeframe;
  const isLoading =
    options.dataSource === 'batteryHealth'
      ? dashboardDataAvailable ? dashboardRefreshing : healthLoading || (needsStatus && statusLoading)
      : options.dataSource === 'chargingSummary'
        ? dashboardDataAvailable ? dashboardRefreshing : chargingLoading
        : options.dataSource === 'vehicleStatus'
          ? dashboardDataAvailable ? dashboardRefreshing : statusLoading
          : false;
  const hasFiniteSeriesPoint = series.some(
    (point) => typeof point.value === 'number' && Number.isFinite(point.value)
  );
  const resolvedMetricValue = allowLatestFallback || hasFiniteSeriesPoint ? (value?.value ?? null) : null;
  const resolvedValue =
    options.dataSource === 'metric'
      ? metric === 'avg_efficiency'
        ? (efficiencySummary?.avg ?? (allowLatestFallback ? (value?.value ?? null) : null))
        : resolvedMetricValue
      : resolveConfiguredValue(options, sourceValues);
  const statusPresentation =
    options.dataSource === 'vehicleStatus'
      ? presentVehicleStatusDefinition(instance.definitionId, status)
      : null;
  const unit = options.dataSource === 'metric' ? value?.unit : options.unit;
  const displayValue = statusPresentation
    ? statusPresentation.label
    : isLoading
      ? '...'
      : activeTripSelectionStat
        ? formatTripStat(activeTripSelectionStat, selectionValue)
        : formatMetricValue(resolvedValue, unit);
  const inlineSecondary = statusPresentation
    ? ''
    : isLoading
      ? ''
      : activeTripSelectionStat
        ? ''
        : resolveInlineSecondary(options, sourceValues);
  const secondary = statusPresentation
    ? (statusPresentation.secondaryText ?? '')
    : isLoading
      ? ''
      : activeTripSelectionStat
        ? ''
        : resolveTemplate(options.secondaryTemplate, sourceValues);
  const lastUpdatedLabel = activeTripSelectionStat ? null : statusPresentation?.lastUpdatedLabel ?? null;
  const valueToneClass = statusPresentation
    ? statusToneClass(statusPresentation.variant)
    : options.valueColor === 'accent'
      ? 'text-accent'
      : 'text-fg';
  const helpContent = getHelpContent(options.helpText, metric, efficiencySummary);

  const isDailyDelta = options.chartType === 'daily_delta';
  const sparklineType: MiniSparklineType = isDailyDelta
    ? 'bar'
    : (options.chartType as MiniSparklineType);
  const spriteData = isDailyDelta
    ? seriesToDailyDeltas(series, options.windowDays)
    : deriveSpriteData(
        series,
        allowLatestFallback ? resolvedValue : null,
        value?.ts ?? ctx.to ?? new Date().toISOString()
      );
  const showSprite = options.showSprite && options.chartType !== 'none' && !activeTripSelectionStat;

  return (
    <Card
      padding="none"
      className={cn(
        'relative flex h-full min-h-[72px] flex-col overflow-hidden border p-3',
        options.accentBorder
          ? 'border-accent/60 shadow-[inset_0_0_0_1px_var(--rm-border-accent)]'
          : 'border-border'
      )}
      data-testid="sensor-chip"
    >
      {showSprite ? (
        <div
          className="pointer-events-none absolute h-9"
          style={{ left: 0, right: 0, bottom: 0, zIndex: 0, opacity: 0.82 }}
          data-testid="sensor-sprite-layer"
        >
          <MiniSparkline
            data={spriteData}
            type={sparklineType}
            height={36}
            color={getChartColor(options.curveColor)}
            showFallback
            timeFilter={options.timeFilter}
          />
          <div className="absolute inset-x-0 bottom-[2px] h-px bg-accent/35" aria-hidden="true" />
        </div>
      ) : null}

      <div className={cn('relative z-10 flex flex-col', !activeTripSelectionStat && !showSprite && 'flex-1 justify-center')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="min-w-0 truncate text-xs font-medium uppercase tracking-wider text-fg-tertiary">
                {title}
                {options.labelSuffix ? (
                  <span className="ml-1 text-[10px] font-normal normal-case tracking-normal">
                    ({options.labelSuffix})
                  </span>
                ) : null}
              </p>
              {helpContent ? (
                <Tooltip content={helpContent} align="start">
                  <button
                    type="button"
                    aria-label={`${title} help`}
                    className="inline-flex shrink-0 rounded text-fg-tertiary transition-colors hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  >
                    <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </Tooltip>
              ) : null}
              {timeframeScope === 'lifetime' ? (
                <Badge
                  size="sm"
                  variant="default"
                  className="shrink-0 rounded-md px-1.5 py-0.5 font-semibold"
                >
                  Lifetime
                </Badge>
              ) : null}
            </div>
            {options.showSubtitle && options.subtitle ? (
              <p className="mt-1 truncate text-xs text-fg-tertiary">{options.subtitle}</p>
            ) : null}
          </div>
          <Icon icon={iconId} className="h-4 w-4 shrink-0 text-accent" />
        </div>

        <div className="mt-1.5 flex items-baseline gap-1">
          {renderStatusValue({
            presentation: statusPresentation,
            displayValue,
            valueToneClass,
            valueSize: options.valueSize,
          })}
          {inlineSecondary ? (
            <span className="font-mono text-sm tabular-nums text-fg-tertiary">
              {inlineSecondary}
            </span>
          ) : null}
        </div>
        {selectionLabel ? (
          <p className="mt-0.5 text-[10px] text-fg-tertiary">{selectionLabel}</p>
        ) : lastUpdatedLabel ? (
          <p className="mt-0.5 truncate text-[11px] text-fg-tertiary">{lastUpdatedLabel}</p>
        ) : null}
        {secondary ? <p className="mt-0.5 truncate text-xs text-fg-tertiary">{secondary}</p> : null}
      </div>
    </Card>
  );
}

function buildSourceValues(
  dataSource: SensorDataSource,
  health: unknown,
  chargingSummary: unknown,
  efficiencySummary: unknown,
  status: unknown
) {
  const charging = objectValues(chargingSummary);
  const primary =
    dataSource === 'batteryHealth'
      ? health
      : dataSource === 'chargingSummary'
        ? chargingSummary
        : dataSource === 'efficiencySummary'
          ? efficiencySummary
        : dataSource === 'vehicleStatus'
          ? status
          : {};

  return {
    ...objectValues(primary),
    ...(dataSource === 'chargingSummary'
      ? {
          away_kwh_including_unknown:
            (typeof charging.away_kwh === 'number' && Number.isFinite(charging.away_kwh)
              ? charging.away_kwh
              : 0) +
            (typeof charging.unknown_location_kwh === 'number' &&
            Number.isFinite(charging.unknown_location_kwh)
              ? charging.unknown_location_kwh
              : 0),
        }
      : {}),
    health,
    battery: health,
    charging: chargingSummary,
    efficiency: efficiencySummary,
    status,
  } as Record<string, unknown>;
}

function getHelpContent(
  helpText: string,
  metric: string | null,
  efficiencySummary: { efficiency_miles: number; total_miles: number } | null | undefined,
) {
  if (!helpText) return null;
  if (metric !== 'avg_efficiency' || !efficiencySummary || efficiencySummary.total_miles <= 0) {
    return helpText;
  }
  return `${helpText} Based on ${formatMiles(efficiencySummary.efficiency_miles)} of ${formatMiles(efficiencySummary.total_miles)} driven.`;
}

function objectValues(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function resolveConfiguredValue(
  options: Required<SensorChipOptions>,
  values: Record<string, unknown>
) {
  if (options.valueFormula) return resolveFormula(options.valueFormula, values);
  const value = resolveNumberPath(values, options.valuePath);
  if (value != null) return value;
  return resolveNumberPath(values, options.fallbackValuePath);
}

function resolveInlineSecondary(
  options: Required<SensorChipOptions>,
  values: Record<string, unknown>
) {
  if (options.inlineSecondaryTemplate) {
    return resolveTemplate(options.inlineSecondaryTemplate, values);
  }

  const value = options.inlineSecondaryFormula
    ? resolveFormula(options.inlineSecondaryFormula, values)
    : resolveNumberPath(values, options.inlineSecondaryPath);

  if (value == null) return '';
  return `${options.inlineSecondaryPrefix}${formatMetricValue(value, options.inlineSecondaryUnit)}`;
}

function resolveTemplate(template: string, values: Record<string, unknown>) {
  if (!template) return '';
  let missingValue = false;
  const resolved = template.replace(
    /\[([^\]:]+)(?::([^\]]+))?\]/g,
    (_match, rawPath: string, rawFormat: string | undefined) => {
      const value = resolveNumberPath(values, rawPath.trim());
      if (value == null) {
        missingValue = true;
        return '';
      }
      return formatTemplateValue(value, rawFormat);
    }
  );
  return missingValue ? '' : resolved;
}

function formatTemplateValue(value: number, format: string | undefined) {
  if (!format) return formatMetricValue(value, undefined);
  if (format === 'int' || format === 'integer') return value.toFixed(0);
  return formatMetricValue(value, format);
}

function resolveNumberPath(values: Record<string, unknown>, path: string) {
  if (!path) return null;
  const value = resolvePath(values, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolvePath(values: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(values, path)) return values[path];
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, values);
}

function resolveFormula(formula: string, values: Record<string, unknown>) {
  let missingValue = false;
  const expression = formula.replace(/\[([^\]]+)\]/g, (_match, rawPath: string) => {
    const value = resolveNumberPath(values, rawPath.trim());
    if (value == null) {
      missingValue = true;
      return '0';
    }
    return String(value);
  });
  if (missingValue) return null;
  const parsed = parseMathExpression(expression);
  return parsed != null && Number.isFinite(parsed) ? parsed : null;
}

function parseMathExpression(expression: string) {
  let index = 0;

  function skipSpace() {
    while (/\s/.test(expression[index] ?? '')) index += 1;
  }

  function parseNumber() {
    skipSpace();
    const match = expression.slice(index).match(/^\d+(?:\.\d+)?/);
    if (!match) return null;
    index += match[0].length;
    return Number(match[0]);
  }

  function parseFactor(): number | null {
    skipSpace();
    const char = expression[index];
    if (char === '+' || char === '-') {
      index += 1;
      const value = parseFactor();
      return value == null ? null : char === '-' ? -value : value;
    }
    if (char === '(') {
      index += 1;
      const value = parseExpression();
      skipSpace();
      if (expression[index] !== ')') return null;
      index += 1;
      return value;
    }
    return parseNumber();
  }

  function parseTerm(): number | null {
    let value = parseFactor();
    if (value == null) return null;

    while (true) {
      skipSpace();
      const op = expression[index];
      if (op !== '*' && op !== '/') return value;
      index += 1;
      const right = parseFactor();
      if (right == null || (op === '/' && right === 0)) return null;
      value = op === '*' ? value * right : value / right;
    }
  }

  function parseExpression(): number | null {
    let value = parseTerm();
    if (value == null) return null;

    while (true) {
      skipSpace();
      const op = expression[index];
      if (op !== '+' && op !== '-') return value;
      index += 1;
      const right = parseTerm();
      if (right == null) return null;
      value = op === '+' ? value + right : value - right;
    }
  }

  const result = parseExpression();
  skipSpace();
  return index === expression.length ? result : null;
}

function usesStatus(options: Required<SensorChipOptions>) {
  return [
    options.valuePath,
    options.fallbackValuePath,
    options.valueFormula,
    options.inlineSecondaryPath,
    options.inlineSecondaryFormula,
    options.inlineSecondaryTemplate,
    options.secondaryTemplate,
  ].some((value) => value.includes('status.'));
}

function deriveSpriteData(
  series: Array<{ ts?: string; value: number | null | undefined }>,
  currentValue: number | null | undefined,
  currentTs: string
) {
  const finiteSeries = series.filter(
    (point) => typeof point.value === 'number' && Number.isFinite(point.value)
  );
  if (finiteSeries.length > 0) return finiteSeries;
  if (typeof currentValue === 'number' && Number.isFinite(currentValue)) {
    return [{ ts: currentTs, value: currentValue }];
  }
  return [];
}

function formatMetricValue(value: number | null | undefined, unit: string | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  if (unit === 'mi') return formatMiles(value);
  if (unit === 'kWh') return formatKwh(value);
  if (unit === 'USD') return formatCurrency(value);
  if (unit === 'Wh/mi') return formatEfficiency(value);
  if (unit === 'min') return formatDuration(value);
  if (unit === '%') return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  if (unit === 'psi') return formatPressure(value);
  if (unit === 'mph') return formatMph(value);
  if (unit === 'kW') return `${value.toFixed(1)} kW`;
  if (unit === 'C') return formatTemp(value);
  if (!unit && Number.isInteger(value)) return value.toFixed(0);
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function renderStatusValue({
  presentation,
  displayValue,
  valueToneClass,
  valueSize,
}: {
  presentation: ReturnType<typeof presentVehicleStatusDefinition> | null;
  displayValue: string;
  valueToneClass: string;
  valueSize: Required<SensorChipOptions>['valueSize'];
}) {
  if (presentation?.renderUnavailableChip) {
    const badge = (
      <Badge
        variant="info"
        className="rounded-full font-semibold"
        data-testid="sensor-unavailable-chip"
      >
        {displayValue}
      </Badge>
    );
    return presentation.tooltip ? <Tooltip content={presentation.tooltip}>{badge}</Tooltip> : badge;
  }

  const valueNode = (
    <span
      className={cn(
        'font-mono font-semibold tabular-nums tracking-tight',
        valueToneClass,
        valueSize === 'sm' ? 'text-xl' : valueSize === 'lg' ? 'text-3xl' : 'text-2xl'
      )}
      style={{ textShadow: 'var(--rm-value-halo)' }}
    >
      {displayValue}
    </span>
  );

  return presentation?.tooltip ? (
    <Tooltip content={presentation.tooltip}>{valueNode}</Tooltip>
  ) : (
    valueNode
  );
}

function statusToneClass(tone: StatusTone) {
  if (tone === 'success') return 'text-status-positive';
  if (tone === 'warning') return 'text-status-warning';
  if (tone === 'danger') return 'text-status-danger';
  if (tone === 'info') return 'text-status-info';
  return 'text-fg';
}

function legacySmoothingToTimeFilter(value: unknown, chartType: SensorChartType | 'none'): TimeFilterWindow {
  if (chartType !== 'line' && chartType !== 'area') return 'raw';
  return value === false || value === 0 ? 'raw' : DEFAULT_SPRITE_TIME_FILTER;
}

function sensorDataRequirements(instance: WidgetInstance): DashboardDataRequirements {
  const options = readOptions(instance);
  const metric = options.dataSource === 'metric' && options.metric ? options.metric : null;
  return {
    ...(metric ? {
      metrics: [{
        metric,
        include_latest: true,
        include_series: options.chartType !== 'none',
      }],
    } : {}),
    ...(options.dataSource === 'batteryHealth' ? { batteryHealth: true } : {}),
    ...(options.dataSource === 'chargingSummary' ? { chargingSummary: true } : {}),
    ...(metric === 'avg_efficiency' || options.dataSource === 'efficiencySummary' ? { efficiencySummary: true } : {}),
    ...(options.dataSource === 'vehicleStatus' || usesStatus(options) ? { status: true } : {}),
  };
}

for (const definition of SENSOR_DEFINITIONS) {
  const cumulative = definition.cumulative === true;
  registerWidget({
    componentType: 'sensor',
    definitionId: definition.id,
    title: definition.title,
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    defaultOptions: {
      metric: definition.metric ?? '',
      icon: definition.icon,
      chartType: definition.chartType,
      dataSource: definition.dataSource ?? 'metric',
      valuePath: definition.valuePath ?? '',
      fallbackValuePath: definition.fallbackValuePath ?? '',
      valueFormula: definition.valueFormula ?? '',
      unit: definition.unit ?? null,
      inlineSecondaryPath: definition.inlineSecondaryPath ?? '',
      inlineSecondaryFormula: definition.inlineSecondaryFormula ?? '',
      inlineSecondaryTemplate: definition.inlineSecondaryTemplate ?? '',
      inlineSecondaryUnit: definition.inlineSecondaryUnit ?? null,
      inlineSecondaryPrefix: definition.inlineSecondaryPrefix ?? '',
      secondaryTemplate: definition.secondaryTemplate ?? '',
      helpText: definition.helpText ?? '',
      labelSuffix: definition.labelSuffix ?? '',
      valueMode: definition.valueMode,
      valueColor: definition.valueColor ?? 'accent',
      showSprite: definition.chartType !== 'none',
      curveColor: 'accent',
      timeFilter: definition.chartType === 'line' || definition.chartType === 'area'
        ? DEFAULT_SPRITE_TIME_FILTER
        : 'raw',
      showSubtitle: false,
      accentBorder: definition.accent ?? false,
      valueSize: 'md',
      ...(cumulative ? { windowDays: DEFAULT_WINDOW_DAYS } : {}),
    },
    editor: {
      category: 'Sensors',
      description:
        definition.dataSource === 'metric'
          ? 'Resizable sensor chip backed by the metric catalog.'
          : 'Resizable sensor chip backed by dashboard summary data.',
    },
    dataRequirements: sensorDataRequirements,
    component: SensorChipWidget,
  });
}
