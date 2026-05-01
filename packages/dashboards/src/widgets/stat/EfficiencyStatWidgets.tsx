import React from 'react';
import { Gauge } from 'lucide-react';
import { useEfficiencySummary } from '@riviamigo/hooks';
import { StatCard } from '@riviamigo/ui/primitives';
import { formatEnergyPerDistance, whPerMileToMiPerKwh } from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

function formatWholeNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(0) : '-';
}

function formatMiPerKwh(value: number | null | undefined) {
  const converted = whPerMileToMiPerKwh(value);
  return converted === null ? '-' : converted.toFixed(1);
}

function AvgEfficiencyStatWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useEfficiencySummary(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <StatCard
      label={`Avg Efficiency (${formatEnergyPerDistance(data?.avg)})`}
      value={formatMiPerKwh(data?.avg)}
      unit="mi/kWh"
      accent
      icon={<Gauge className="h-4 w-4" />}
    />
  );
}

function BestEfficiencyWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useEfficiencySummary(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <StatCard
      label={`Best 10% (${formatEnergyPerDistance(data?.p10)})`}
      value={formatMiPerKwh(data?.p10)}
      unit="mi/kWh"
    />
  );
}

function WorstEfficiencyWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useEfficiencySummary(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <StatCard
      label={`Worst 10% (${formatEnergyPerDistance(data?.p90)})`}
      value={formatMiPerKwh(data?.p90)}
      unit="mi/kWh"
    />
  );
}

function EfficiencyMilesWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useEfficiencySummary(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <StatCard
      label="Total Miles"
      value={formatWholeNumber(data?.total_miles)}
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
