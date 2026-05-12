import React from 'react';
import { Icon } from '@iconify/react';
import { useMetricValue, useMetricSeries } from '@riviamigo/hooks';
import { getChartColor, MiniSparkline } from '@riviamigo/ui/charts';
import { Card } from '@riviamigo/ui/primitives';
import { cn, formatMiles, formatDuration, formatEfficiency } from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';
import { resolveIconId } from '../../editor/iconMigration';
import type { SensorIconKey } from '../sensor/sensorDefinitions';
import type { TripRow } from '@riviamigo/ui/tables';
import { useTripSelection, resetTripSelection } from './tripSelectionStore';

type TripStat = 'miles' | 'count' | 'efficiency' | 'duration';

interface TripStatOptions {
  stat: TripStat;
  metric: string;
  icon: SensorIconKey;
  accentBorder: boolean;
}

function readOptions(instance: WidgetInstance): TripStatOptions {
  const opts = (instance.options ?? {}) as Partial<TripStatOptions>;
  return {
    stat: opts.stat ?? 'count',
    metric: opts.metric ?? 'total_trips',
    icon: opts.icon ?? 'calendar',
    accentBorder: opts.accentBorder ?? false,
  };
}

function computeTripStat(stat: TripStat, trips: TripRow[]): number | null {
  if (trips.length === 0) return null;
  if (stat === 'count') return trips.length;
  if (stat === 'miles') return trips.reduce((sum, t) => sum + t.distance_mi, 0);
  if (stat === 'duration') return trips.reduce((sum, t) => sum + t.duration_min, 0) / trips.length;
  const vals = trips.map((t) => t.efficiency_wh_mi).filter((v): v is number => v !== null);
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

function formatTripStat(stat: TripStat, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  if (stat === 'miles') return formatMiles(value);
  if (stat === 'duration') return formatDuration(value);
  if (stat === 'efficiency') return formatEfficiency(value);
  return value.toFixed(0);
}

function formatApiValue(value: number | null | undefined, unit: string | null | undefined): string {
  const v = value ?? null;
  if (v === null || !Number.isFinite(v)) return '-';
  if (unit === 'mi') return formatMiles(v);
  if (unit === 'min') return formatDuration(v);
  if (unit === 'Wh/mi') return formatEfficiency(v);
  if (!unit && Number.isInteger(v)) return v.toFixed(0);
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

export function TripStatWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const options = readOptions(instance);
  const { selectedIds, tripRegistry } = useTripSelection();
  const { data: value } = useMetricValue(ctx.vehicleId, options.metric);
  const { data: series = [] } = useMetricSeries(ctx.vehicleId, options.metric, ctx.from, ctx.to);

  React.useEffect(() => {
    resetTripSelection(`${ctx.vehicleId}::${ctx.from}::${ctx.to}`);
  }, [ctx.vehicleId, ctx.from, ctx.to]);

  const title = instance.title ?? options.metric;
  const iconId = resolveIconId(options.icon);
  const selectedTrips = selectedIds.map((id) => tripRegistry[id]).filter((t): t is TripRow => Boolean(t));
  const hasSelection = selectedTrips.length > 0;

  const displayValue = hasSelection
    ? formatTripStat(options.stat, computeTripStat(options.stat, selectedTrips))
    : formatApiValue(value?.value, value?.unit);

  const spriteData = series.filter(
    (p): p is { ts: string; value: number } =>
      typeof p.ts === 'string' && typeof p.value === 'number' && Number.isFinite(p.value),
  );

  return (
    <Card
      padding="none"
      className={cn(
        'relative flex h-full min-h-[72px] flex-col overflow-hidden border p-3',
        options.accentBorder
          ? 'border-orange-400/60 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.22)]'
          : 'border-border',
      )}
      data-testid="sensor-chip"
    >
      {!hasSelection && spriteData.length > 0 ? (
        <div
          className="pointer-events-none absolute h-9"
          style={{ left: 0, right: 0, bottom: 0, zIndex: 0, opacity: 0.82 }}
          data-testid="sensor-sprite-layer"
        >
          <MiniSparkline
            data={spriteData}
            type="line"
            height={36}
            color={getChartColor('accent')}
            showFallback
            curveSmoothing={0.45}
          />
          <div className="absolute inset-x-0 bottom-[2px] h-px bg-accent/35" aria-hidden="true" />
        </div>
      ) : null}

      <div className={cn('relative z-10 flex flex-col', !hasSelection && spriteData.length === 0 && 'flex-1 justify-center')}>
        <div className="flex items-start justify-between gap-3">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-fg-tertiary">
            {title}
          </p>
          <Icon icon={iconId} className="h-4 w-4 shrink-0 text-accent" />
        </div>
        <div className="mt-1.5 flex items-baseline gap-1">
          <span
            className="text-2xl font-mono font-semibold tabular-nums tracking-tight text-accent"
            style={{ textShadow: 'var(--rm-value-halo)' }}
          >
            {displayValue}
          </span>
        </div>
        {hasSelection ? (
          <p className="mt-0.5 text-[10px] text-fg-tertiary">
            {selectedTrips.length} trip{selectedTrips.length === 1 ? '' : 's'} selected
          </p>
        ) : null}
      </div>
    </Card>
  );
}

registerWidget({
  componentType: 'custom',
  definitionId: 'trips.stat',
  title: 'Trip Stat',
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 2, h: 2 },
  defaultOptions: {},
  component: TripStatWidget,
});
