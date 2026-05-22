import * as React from 'react';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatSmartNumber } from '../lib/utils';

export interface EfficiencyPillBarDatum {
  label: string;
  value: number;
  count?: number | null;
  distance?: number | null;
  speed?: number | null;
}

export interface EfficiencyPillBarChartProps {
  data: EfficiencyPillBarDatum[];
  height?: number;
  loading?: boolean;
  emptyTitle?: string | undefined;
  valueUnit: string;
  distanceUnit?: string;
  speedUnit?: string;
}

const SEGMENT_COUNT = 28;

// Column templates — keep in sync between header and data rows
const COLS_FULL = 'grid-cols-[4rem_1fr_7rem_5rem_6rem]';
const COLS_BASIC = 'grid-cols-[4rem_1fr_7rem]';

export function EfficiencyPillBarChart({
  data,
  height = 280,
  loading = false,
  emptyTitle = 'No efficiency data for this period',
  valueUnit,
  distanceUnit = 'mi',
  speedUnit = 'mph',
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
  const hasDistance = rows.some((item) => item.distance != null);
  const hasSpeed = rows.some((item) => item.speed != null);
  const cols = hasDistance || hasSpeed ? COLS_FULL : COLS_BASIC;

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      {/* Header */}
      <div className={`mb-2 grid items-center gap-x-4 gap-y-0 text-[10px] font-medium uppercase tracking-wider text-fg-tertiary ${cols}`}>
        <div>Temp</div>
        <div>Driving Efficiency</div>
        <div className="text-right">{valueUnit === 'mi/kWh' ? 'mi/kWh' : 'Wh/mi'}</div>
        {(hasDistance || hasSpeed) && <div className="text-right">Distance</div>}
        {(hasDistance || hasSpeed) && <div className="text-right">Avg Speed</div>}
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((item) => {
          const ratio = Math.max(0.04, item.value / maxValue);
          const filledCount = Math.round(ratio * SEGMENT_COUNT);

          return (
            <div key={item.label} className={`grid items-center gap-x-4 gap-y-0 ${cols}`}>
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-fg" title={item.label}>
                  {item.label}
                </div>
                {item.count != null ? (
                  <div className="text-[11px] text-fg-tertiary">{item.count} trips</div>
                ) : null}
              </div>

              {/* Segmented pill bar */}
              <div className="flex items-center gap-[2px]">
                {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
                  <div
                    key={i}
                    className={`h-[14px] flex-1 rounded-[3px] ${i < filledCount ? 'bg-accent/85' : 'bg-bg-elevated'}`}
                  />
                ))}
              </div>

              <div className="whitespace-nowrap text-right font-mono text-xs font-medium tabular-nums text-fg">
                {formatSmartNumber(item.value, Math.abs(item.value) >= 100 ? 0 : 1)} {valueUnit}
              </div>

              {(hasDistance || hasSpeed) && (
                <div className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-fg-secondary">
                  {item.distance != null
                    ? `${formatSmartNumber(item.distance, item.distance >= 100 ? 0 : 1)} ${distanceUnit}`
                    : '-'}
                </div>
              )}

              {(hasDistance || hasSpeed) && (
                <div className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-fg-secondary">
                  {item.speed != null
                    ? `${formatSmartNumber(item.speed, 1)} ${speedUnit}`
                    : '-'}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
