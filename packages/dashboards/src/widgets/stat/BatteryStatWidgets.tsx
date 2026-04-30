import React from 'react';
import { Battery, Activity, Moon, TrendingDown } from 'lucide-react';
import { useCurrentVehicleStatus, usePhantomDrain, useDegradation } from '@riviamigo/hooks';
import { StatCard } from '@riviamigo/ui/primitives';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

function CurrentSocWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useCurrentVehicleStatus(ctx.vehicleId);
  const latest = data?.battery_level;
  return (
    <StatCard
      label="Current SoC"
      value={latest !== undefined && latest !== null ? `${Math.round(latest)}%` : '-'}
      accent
      icon={<Battery className="h-4 w-4" />}
    />
  );
}

function EstRangeWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useCurrentVehicleStatus(ctx.vehicleId);
  const latest = data?.range_miles;
  return (
    <StatCard
      label="Est. Range"
      value={latest !== undefined && latest !== null ? `${Math.round(latest)} mi` : '-'}
      icon={<Activity className="h-4 w-4" />}
    />
  );
}

function PhantomDrainAvgWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = usePhantomDrain(ctx.vehicleId, ctx.from, ctx.to);
  const avg = data?.length
    ? data.reduce((s: number, d: { drain_pct: number }) => s + (d.drain_pct ?? 0), 0) / data.length
    : undefined;
  return (
    <StatCard
      label="Phantom Drain"
      value={avg !== undefined ? `${avg.toFixed(1)}%` : '-'}
      unit="/ hr avg"
      icon={<Moon className="h-4 w-4" />}
    />
  );
}

function CapacityHealthWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useDegradation(ctx.vehicleId);
  const latest = data?.[data.length - 1]?.capacity_pct;
  const { data: status } = useCurrentVehicleStatus(ctx.vehicleId);
  const capacity = status?.battery_capacity_kwh;
  const hasCapacity = capacity !== undefined && capacity !== null;

  const fallbackUnit = latest !== undefined && latest !== null
    ? undefined
    : hasCapacity
    ? 'kWh usable'
    : undefined;

  return (
    <StatCard
      label="Capacity Health"
      value={latest !== undefined && latest !== null ? `${latest.toFixed(1)}%` : hasCapacity ? `${capacity.toFixed(1)}` : '-'}
      {...(fallbackUnit ? { unit: fallbackUnit } : {})}
      icon={<TrendingDown className="h-4 w-4" />}
    />
  );
}

registerWidget({
  id: 'stat.current_soc',
  category: 'stat',
  title: 'Current SoC',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: CurrentSocWidget,
});

registerWidget({
  id: 'stat.est_range',
  category: 'stat',
  title: 'Est. Range',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: EstRangeWidget,
});

registerWidget({
  id: 'stat.phantom_drain_avg',
  category: 'stat',
  title: 'Phantom Drain Avg',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: PhantomDrainAvgWidget,
});

registerWidget({
  id: 'stat.capacity_health',
  category: 'stat',
  title: 'Capacity Health',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: CapacityHealthWidget,
});
