import React from 'react';
import { Activity } from 'lucide-react';
import { useMetricSeries, useMetricValue } from '@riviamigo/hooks';
import { MiniSparkline, type MiniSparklineType } from '@riviamigo/ui/charts';
import { Card } from '@riviamigo/ui/primitives';
import { cn, formatKwh, formatMiles } from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

interface MetricStatOptions {
  metric?: string;
  subtitle?: string;
  chartType?: MiniSparklineType;
  valueSize?: 'sm' | 'md' | 'lg';
}

function readOptions(instance: WidgetInstance): Required<MetricStatOptions> {
  const options = (instance.options ?? {}) as MetricStatOptions;
  return {
    metric: options.metric ?? 'total_miles',
    subtitle: options.subtitle ?? '',
    chartType: options.chartType ?? 'line',
    valueSize: options.valueSize ?? 'md',
  };
}

function formatMetricValue(value: number | null | undefined, unit: string | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  if (unit === 'mi') return formatMiles(value);
  if (unit === 'kWh') return formatKwh(value);
  if (unit === '%') return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  if (unit === 'psi') return `${value.toFixed(1)} psi`;
  if (unit === 'mph') return `${value.toFixed(0)} mph`;
  if (unit === 'C') return `${value.toFixed(1)} C`;
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

export function MetricStatWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const options = readOptions(instance);
  const { data: value } = useMetricValue(ctx.vehicleId, options.metric);
  const { data: series = [] } = useMetricSeries(ctx.vehicleId, options.metric, ctx.from, ctx.to);
  const title = instance.title ?? value?.label ?? options.metric;
  const displayValue = formatMetricValue(value?.value, value?.unit);

  return (
    <Card padding="none" className="relative flex h-full min-h-0 flex-col overflow-hidden border-accent/20 p-3">
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-fg-tertiary">{title}</p>
          {options.subtitle ? <p className="mt-0.5 truncate text-[11px] text-fg-tertiary">{options.subtitle}</p> : null}
        </div>
        <Activity className="h-4 w-4 shrink-0 text-accent" />
      </div>

      <div className="relative z-10 mt-1.5 flex items-baseline gap-1">
        <span
          className={cn(
            'font-mono font-semibold tabular-nums tracking-tight text-accent',
            options.valueSize === 'sm' ? 'text-lg' : options.valueSize === 'lg' ? 'text-2xl' : 'text-xl',
          )}
        >
          {displayValue}
        </span>
      </div>

      {options.chartType !== 'none' ? (
        <div className="mt-auto pt-1 opacity-90">
          <MiniSparkline data={series} type={options.chartType} height={26} />
        </div>
      ) : null}
    </Card>
  );
}

registerWidget({
  id: 'metric.stat',
  category: 'stat',
  title: 'Sensor Reading',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  defaultOptions: {
    metric: 'total_miles',
    subtitle: 'Daily activity',
    chartType: 'line',
    valueSize: 'md',
  },
  editMode: 'metric',
  component: MetricStatWidget,
});
