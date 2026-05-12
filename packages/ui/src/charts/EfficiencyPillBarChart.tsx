import * as React from 'react';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatSmartNumber } from '../lib/utils';

export interface EfficiencyPillBarDatum {
  label: string;
  value: number;
  count?: number | null;
}

export interface EfficiencyPillBarChartProps {
  data: EfficiencyPillBarDatum[];
  height?: number;
  loading?: boolean;
  emptyTitle?: string | undefined;
  valueUnit: string;
}

export function EfficiencyPillBarChart({
  data,
  height = 280,
  loading = false,
  emptyTitle = 'No efficiency data for this period',
  valueUnit,
}: EfficiencyPillBarChartProps) {
  if (loading) return <ChartSkeleton height={height} />;

  const rows = data.filter((item) => Number.isFinite(item.value));
  if (rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary"
        style={{ height }}
      >
        {emptyTitle}
      </div>
    );
  }

  const maxValue = Math.max(1, ...rows.map((item) => item.value));

  return (
    <div
      className="flex flex-col justify-center gap-3 rounded-lg border border-border bg-surface-1 p-4"
      style={{ minHeight: height }}
    >
      {rows.map((item) => {
        const ratio = Math.max(0.08, item.value / maxValue);
        return (
          <div key={item.label} className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-fg" title={item.label}>{item.label}</div>
              {item.count != null ? <div className="text-[11px] text-fg-tertiary">{item.count} trips</div> : null}
            </div>
            <div className="relative h-7 overflow-hidden rounded-full border border-border bg-bg-elevated">
              <div
                className="absolute inset-y-1 left-1 rounded-full bg-accent/90"
                style={{ width: `calc(${ratio * 100}% - 0.5rem)` }}
              />
            </div>
            <div className="whitespace-nowrap font-mono text-xs font-medium tabular-nums text-fg">
              {formatSmartNumber(item.value, Math.abs(item.value) >= 100 ? 0 : 1)} {valueUnit}
            </div>
          </div>
        );
      })}
    </div>
  );
}
