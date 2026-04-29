import React from 'react';
import { Gauge } from 'lucide-react';
import { useEfficiencySummary } from '@riviamigo/hooks';
import { StatCard } from '@riviamigo/ui/primitives';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

function AvgEfficiencyStatWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useEfficiencySummary(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <StatCard
      label="Avg Efficiency"
      value={data ? `${data.avg_wh_per_mi.toFixed(0)}` : '—'}
      unit="Wh/mi"
      accent
      icon={<Gauge className="h-4 w-4" />}
    />
  );
}

function BestEfficiencyWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useEfficiencySummary(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <StatCard
      label="Best 10%"
      value={data ? `${(data.p10_wh_per_mi ?? 0).toFixed(0)}` : '—'}
      unit="Wh/mi"
    />
  );
}

function WorstEfficiencyWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useEfficiencySummary(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <StatCard
      label="Worst 10%"
      value={data ? `${(data.p90_wh_per_mi ?? 0).toFixed(0)}` : '—'}
      unit="Wh/mi"
    />
  );
}

function EfficiencyMilesWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useEfficiencySummary(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <StatCard
      label="Total Miles"
      value={data ? `${(data.total_miles ?? 0).toFixed(0)}` : '—'}
      unit="mi"
    />
  );
}

registerWidget({
  id: 'stat.avg_efficiency_period',
  category: 'stat',
  title: 'Avg Efficiency (Period)',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: AvgEfficiencyStatWidget,
});

registerWidget({
  id: 'stat.best_efficiency',
  category: 'stat',
  title: 'Best Efficiency',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: BestEfficiencyWidget,
});

registerWidget({
  id: 'stat.worst_efficiency',
  category: 'stat',
  title: 'Worst Efficiency',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: WorstEfficiencyWidget,
});

registerWidget({
  id: 'stat.efficiency_miles',
  category: 'stat',
  title: 'Miles Driven (Period)',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: EfficiencyMilesWidget,
});
