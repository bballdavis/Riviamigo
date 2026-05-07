import React from 'react';
import { Activity } from 'lucide-react';
import { useMetricSeries, useMetricValue } from '@riviamigo/hooks';
import { MiniSparkline, type MiniSparklineType } from '@riviamigo/ui/charts';
import { Card } from '@riviamigo/ui/primitives';
import { cn, formatDuration, formatEfficiency, formatKwh, formatMiles } from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

interface MetricStatOptions {
  metric?: string;
  subtitle?: string;
  chartType?: MiniSparklineType;
  valueSize?: 'sm' | 'md' | 'lg';
  valueMode?: 'latest' | 'sum' | 'avg' | 'count';
}

function readOptions(instance: WidgetInstance): Required<MetricStatOptions> {
  const options = (instance.options ?? {}) as MetricStatOptions;
  return {
    metric: options.metric ?? 'total_miles',
    subtitle: options.subtitle ?? '',
    chartType: options.chartType ?? 'line',
    valueSize: options.valueSize ?? 'md',
    valueMode: options.valueMode ?? 'latest',
  };
}

function formatMetricValue(value: number | null | undefined, unit: string | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  if (unit === 'mi') return formatMiles(value);
  if (unit === 'kWh') return formatKwh(value);
  if (unit === 'Wh/mi') return formatEfficiency(value);
  if (unit === 'min') return formatDuration(value);
  if (unit === '%') return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  if (unit === 'psi') return `${value.toFixed(1)} psi`;
  if (unit === 'mph') return `${value.toFixed(0)} mph`;
  if (unit === 'C') return `${value.toFixed(1)} C`;
  if (!unit && Number.isInteger(value)) return value.toFixed(0);
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

export function MetricStatWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const options = readOptions(instance);
  const { data: value } = useMetricValue(ctx.vehicleId, options.metric);
  const { data: series = [] } = useMetricSeries(ctx.vehicleId, options.metric, ctx.from, ctx.to);
  const title = instance.title ?? value?.label ?? options.metric;
  const metricValue = deriveMetricValue(options.valueMode, value?.value, series);
  const displayValue = formatMetricValue(metricValue, value?.unit);

  return (
    <Card padding="none" className="relative flex h-full min-h-0 flex-col overflow-hidden border-accent/20 p-4">
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-fg-tertiary">{title}</p>
          {options.subtitle ? <p className="mt-1 truncate text-xs text-fg-tertiary">{options.subtitle}</p> : null}
        </div>
        <Activity className="h-4 w-4 shrink-0 text-accent" />
      </div>

      <div className="relative z-10 mt-2 flex items-baseline gap-1">
        <span
          className={cn(
            'font-mono font-semibold tabular-nums tracking-tight text-accent',
            options.valueSize === 'sm' ? 'text-xl' : options.valueSize === 'lg' ? 'text-3xl' : 'text-2xl',
          )}
        >
          {displayValue}
        </span>
      </div>

      {options.chartType !== 'none' ? (
        <div className="mt-auto pt-2 opacity-90">
          <MiniSparkline data={series} type={options.chartType} height={44} />
        </div>
      ) : null}
    </Card>
  );
}

function deriveMetricValue(
  mode: Required<MetricStatOptions>['valueMode'],
  latest: number | null | undefined,
  series: Array<{ value: number | null | undefined }>,
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

registerWidget({
  id: 'metric.stat',
  category: 'stat',
  title: 'Sensor Reading',
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 2, h: 2 },
  defaultOptions: {
    metric: 'total_miles',
    subtitle: 'Daily activity',
    chartType: 'line',
    valueSize: 'md',
  },
  editMode: 'metric',
  component: MetricStatWidget,
});
