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
// The flexible bar column must stay explicitly shrinkable beside the desktop's
// fixed metadata columns; otherwise it can collapse to zero on narrow cards.
const COLS_FULL = 'grid-cols-[4rem_minmax(0,1fr)_7rem_5rem_6rem]';
const COLS_BASIC = 'grid-cols-[4rem_minmax(0,1fr)_7rem]';

export function EfficiencyPillBarChart({
  data,
  height = 280,
  loading = false,
  emptyTitle = 'No efficiency data for this period',
  valueUnit,
  distanceUnit = 'mi',
  speedUnit = 'mph',
}: EfficiencyPillBarChartProps) {
  const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null);
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
    <div className="h-full overflow-y-auto rounded-lg border border-border bg-surface-1 p-3 sm:p-4" style={{ maxHeight: height }}>
      <div className={`mb-2 hidden items-center gap-x-4 text-[10px] font-medium uppercase tracking-wider text-fg-tertiary sm:grid ${cols}`}>
        <div>Category</div>
        <div>Driving efficiency</div>
        <div className="text-right">{valueUnit === 'mi/kWh' ? 'mi/kWh' : 'Wh/mi'}</div>
        {(hasDistance || hasSpeed) && <div className="text-right">Distance</div>}
        {(hasDistance || hasSpeed) && <div className="text-right">Avg speed</div>}
      </div>

      <div className="flex flex-col gap-3 sm:gap-2">
        {rows.map((item) => {
          const ratio = Math.max(0.04, item.value / maxValue);
          const filledCount = Math.round(ratio * SEGMENT_COUNT);
          const meta = [
            item.count != null ? `${item.count} trips` : null,
            item.distance != null ? `${formatSmartNumber(item.distance, item.distance >= 100 ? 0 : 1)} ${distanceUnit}` : null,
            item.speed != null ? `${formatSmartNumber(item.speed, 1)} ${speedUnit}` : null,
          ].filter((value): value is string => Boolean(value));
          const formattedValue = `${formatSmartNumber(item.value, Math.abs(item.value) >= 100 ? 0 : 1)} ${valueUnit}`;

          return (
            <div key={item.label} className="rounded-md border border-border/60 p-2.5 sm:contents sm:border-0 sm:p-0">
              <div className={`hidden items-center gap-x-4 sm:grid ${cols}`}>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-fg" title={item.label}>{item.label}</div>
                  {item.count != null ? <div className="text-[11px] text-fg-tertiary">{item.count} trips</div> : null}
                </div>
                <PillSegments filledCount={filledCount} />
                <div className="whitespace-nowrap text-right font-mono text-xs font-medium tabular-nums text-fg">{formattedValue}</div>
                {(hasDistance || hasSpeed) && (
                  <div className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-fg-secondary">
                    {item.distance != null ? `${formatSmartNumber(item.distance, item.distance >= 100 ? 0 : 1)} ${distanceUnit}` : '-'}
                  </div>
                )}
                {(hasDistance || hasSpeed) && (
                  <div className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-fg-secondary">
                    {item.speed != null ? `${formatSmartNumber(item.speed, 1)} ${speedUnit}` : '-'}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSelectedLabel((current) => current === item.label ? null : item.label)}
                aria-pressed={selectedLabel === item.label}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-sm text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent sm:hidden ${selectedLabel === item.label ? 'bg-accent/10' : ''}`}
                aria-label={`${item.label}, ${formattedValue}${meta.length ? `, ${meta.join(', ')}` : ''}`}
              >
                <span className="min-w-0 truncate text-sm font-medium text-fg">{item.label}</span>
                <span className="whitespace-nowrap text-right font-mono text-sm font-medium tabular-nums text-fg">{formattedValue}</span>
                <span className="col-span-2 mt-2 min-w-0"><PillSegments filledCount={filledCount} /></span>
                {meta.length > 0 ? <span className="col-span-2 mt-1 text-xs text-fg-tertiary">{meta.join(' · ')}</span> : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PillSegments({ filledCount }: { filledCount: number }) {
  return (
    <span className="flex min-w-0 items-center gap-[2px]" data-efficiency-pill-bar="true">
      {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`h-[14px] min-w-0 flex-1 rounded-[3px] ${i < filledCount ? 'bg-accent/85' : 'bg-bg-elevated'}`}
        />
      ))}
    </span>
  );
}
