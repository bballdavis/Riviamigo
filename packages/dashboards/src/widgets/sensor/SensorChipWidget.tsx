import React from 'react';
import { Icon } from '@iconify/react';
import { useMetricSeries, useMetricValue } from '@riviamigo/hooks';
import {
  getChartColor,
  MiniSparkline,
  type ChartColorKey,
  type MiniSparklineType,
} from '@riviamigo/ui/charts';
import { Card } from '@riviamigo/ui/primitives';
import {
  cn,
  formatCurrency,
  formatDuration,
  formatEfficiency,
  formatKwh,
  formatMiles,
} from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';
import { resolveIconId } from '../../editor/iconMigration';
import { seriesToDailyDeltas } from '../../editor/dailyDelta';
import {
  getSensorDefinition,
  SENSOR_DEFINITIONS,
  type SensorChartType,
  type SensorIconKey,
} from './sensorDefinitions';

interface SensorChipOptions {
  metric?: string;
  icon?: SensorIconKey;
  chartType?: SensorChartType | 'none';
  showSprite?: boolean;
  showSubtitle?: boolean;
  subtitle?: string;
  accentBorder?: boolean;
  valueSize?: 'sm' | 'md' | 'lg';
  valueMode?: 'latest' | 'sum' | 'avg' | 'count';
  curveSmoothing?: number | boolean;
  curveColor?: ChartColorKey;
  windowDays?: number;
}

const DEFAULT_CURVE_SMOOTHING = 0.45;
const DEFAULT_WINDOW_DAYS = 30;

function readOptions(instance: WidgetInstance): Required<SensorChipOptions> {
  const definition = getSensorDefinition(instance.definitionId) ?? SENSOR_DEFINITIONS[0]!;
  const options = (instance.options ?? {}) as SensorChipOptions;

  return {
    metric: options.metric ?? definition.metric,
    icon: options.icon ?? definition.icon,
    chartType: options.chartType ?? definition.chartType,
    showSprite: options.showSprite ?? true,
    showSubtitle: options.showSubtitle ?? false,
    subtitle: options.subtitle ?? '',
    accentBorder: options.accentBorder ?? definition.accent ?? false,
    valueSize: options.valueSize ?? 'md',
    valueMode: options.valueMode ?? definition.valueMode,
    curveColor: options.curveColor ?? 'accent',
    curveSmoothing: normalizeCurveSmoothing(
      options.curveSmoothing,
      defaultCurveSmoothing(definition.chartType)
    ),
    windowDays:
      typeof options.windowDays === 'number' && Number.isFinite(options.windowDays)
        ? Math.max(1, Math.min(365, Math.round(options.windowDays)))
        : DEFAULT_WINDOW_DAYS,
  };
}

export function SensorChipWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const definition = getSensorDefinition(instance.definitionId);
  const options = readOptions(instance);
  const { data: value } = useMetricValue(ctx.vehicleId, options.metric);
  const { data: series = [] } = useMetricSeries(ctx.vehicleId, options.metric, ctx.from, ctx.to);
  const title = instance.title ?? definition?.title ?? value?.label ?? options.metric;
  const iconId = resolveIconId(options.icon);
  const metricValue = deriveMetricValue(options.valueMode, value?.value, series);
  const displayValue = formatMetricValue(metricValue, value?.unit);

  const isDailyDelta = options.chartType === 'daily_delta';
  const sparklineType: MiniSparklineType = isDailyDelta
    ? 'bar'
    : (options.chartType as MiniSparklineType);
  const spriteData = isDailyDelta
    ? seriesToDailyDeltas(series, options.windowDays)
    : deriveSpriteData(series, metricValue, value?.ts ?? ctx.to);
  const showSprite = options.showSprite && options.chartType !== 'none';

  return (
    <Card
      padding="none"
      className={cn(
        'relative flex h-full min-h-[72px] flex-col overflow-hidden border p-3',
        options.accentBorder
          ? 'border-orange-400/60 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.22)]'
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
            curveSmoothing={options.curveSmoothing}
          />
          <div className="absolute inset-x-0 bottom-[2px] h-px bg-accent/35" aria-hidden="true" />
        </div>
      ) : null}

      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-fg-tertiary">
            {title}
          </p>
          {options.showSubtitle && options.subtitle ? (
            <p className="mt-1 truncate text-xs text-fg-tertiary">{options.subtitle}</p>
          ) : null}
        </div>
        <Icon icon={iconId} className="h-4 w-4 shrink-0 text-accent" />
      </div>

      <div className="relative z-10 mt-1.5 flex items-baseline gap-1">
        <span
          className={cn(
            'font-mono font-semibold tabular-nums tracking-tight text-accent',
            options.valueSize === 'sm'
              ? 'text-xl'
              : options.valueSize === 'lg'
                ? 'text-3xl'
                : 'text-2xl'
          )}
        >
          {displayValue}
        </span>
      </div>
    </Card>
  );
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

function deriveMetricValue(
  mode: Required<SensorChipOptions>['valueMode'],
  latest: number | null | undefined,
  series: Array<{ value: number | null | undefined }>
) {
  if (mode === 'latest') return latest;

  const values = series
    .map((point) => point.value)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (mode === 'count') return values.length;
  if (values.length === 0) return null;
  if (mode === 'sum') return values.reduce((sum, value) => sum + value, 0);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMetricValue(value: number | null | undefined, unit: string | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  if (unit === 'mi') return formatMiles(value);
  if (unit === 'kWh') return formatKwh(value);
  if (unit === 'USD') return formatCurrency(value);
  if (unit === 'Wh/mi') return formatEfficiency(value);
  if (unit === 'min') return formatDuration(value);
  if (unit === '%') return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  if (unit === 'psi') return `${value.toFixed(1)} psi`;
  if (unit === 'mph') return `${value.toFixed(0)} mph`;
  if (unit === 'kW') return `${value.toFixed(1)} kW`;
  if (unit === 'C') return `${value.toFixed(1)} C`;
  if (!unit && Number.isInteger(value)) return value.toFixed(0);
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function defaultCurveSmoothing(chartType: SensorChartType | 'none') {
  return chartType === 'line' || chartType === 'area' ? DEFAULT_CURVE_SMOOTHING : 0;
}

function normalizeCurveSmoothing(value: number | boolean | undefined, fallback: number) {
  if (typeof value === 'boolean') return value ? fallback : 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return fallback;
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
      metric: definition.metric,
      icon: definition.icon,
      chartType: definition.chartType,
      valueMode: definition.valueMode,
      showSprite: true,
      curveColor: 'accent',
      curveSmoothing: defaultCurveSmoothing(definition.chartType),
      showSubtitle: false,
      accentBorder: definition.accent ?? false,
      valueSize: 'md',
      ...(cumulative ? { windowDays: DEFAULT_WINDOW_DAYS } : {}),
    },
    component: SensorChipWidget,
  });
}
