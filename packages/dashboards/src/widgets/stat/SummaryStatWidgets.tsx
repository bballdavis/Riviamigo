import React from 'react';
import { Battery, Activity, Zap, TrendingUp } from 'lucide-react';
import { useSummaryStats } from '@riviamigo/hooks';
import { StatCard } from '@riviamigo/ui/primitives';
import { formatMiles, formatKwh } from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

function TotalMilesWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data: stats } = useSummaryStats(ctx.vehicleId);
  return (
    <StatCard
      label="Total Miles"
      value={formatMiles(stats?.total_miles ?? 0)}
      accent
      icon={<Activity className="h-4 w-4" />}
    />
  );
}

function TotalTripsWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data: stats } = useSummaryStats(ctx.vehicleId);
  return <StatCard label="Total Trips" value={stats?.total_trips ?? '—'} />;
}

function EnergyChargedWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data: stats } = useSummaryStats(ctx.vehicleId);
  return (
    <StatCard
      label="Energy Charged"
      value={formatKwh(stats?.total_energy_kwh ?? 0)}
      icon={<Zap className="h-4 w-4" />}
    />
  );
}

function AvgEfficiencyWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data: stats } = useSummaryStats(ctx.vehicleId);
  return (
    <StatCard
      label="Avg Efficiency"
      value={stats?.avg_efficiency_wh_mi?.toFixed(0) ?? '—'}
      unit="Wh/mi"
      icon={<TrendingUp className="h-4 w-4" />}
    />
  );
}

registerWidget({
  id: 'stat.total_miles',
  category: 'stat',
  title: 'Total Miles',
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 2, h: 2 },
  component: TotalMilesWidget,
});

registerWidget({
  id: 'stat.total_trips',
  category: 'stat',
  title: 'Total Trips',
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 2, h: 2 },
  component: TotalTripsWidget,
});

registerWidget({
  id: 'stat.energy_charged',
  category: 'stat',
  title: 'Energy Charged',
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 2, h: 2 },
  component: EnergyChargedWidget,
});

registerWidget({
  id: 'stat.avg_efficiency',
  category: 'stat',
  title: 'Avg Efficiency',
  defaultSize: { w: 3, h: 2 },
  minSize: { w: 2, h: 2 },
  component: AvgEfficiencyWidget,
});
