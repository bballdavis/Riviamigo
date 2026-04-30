import React from 'react';
import { useSocHistory, useRangeHistory, usePhantomDrain, useDegradation } from '@riviamigo/hooks';
import { SocAreaChart, RangeAreaChart, PhantomDrainChart, DegradationChart } from '@riviamigo/ui/charts';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

const BRUSHED_CHART_HEIGHT = 260;

function SocChartWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useSocHistory(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <SocAreaChart
      data={(data ?? []).map((p: { ts: string; value?: number | null }) => ({ ts: p.ts, soc: p.value ?? 0 }))}
      loading={isLoading}
      height={BRUSHED_CHART_HEIGHT}
      showBrush
    />
  );
}

function RangeChartWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useRangeHistory(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <RangeAreaChart
      data={(data ?? []).map((p: { ts: string; value?: number | null }) => ({ ts: p.ts, range_mi: p.value ?? 0 }))}
      loading={isLoading}
      height={BRUSHED_CHART_HEIGHT}
      showBrush
    />
  );
}

function PhantomDrainChartWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = usePhantomDrain(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <PhantomDrainChart
      data={(data ?? []).map((p: { date: string; drain_pct: number }) => ({ date: p.date, drain_pct: p.drain_pct }))}
      loading={isLoading}
      height={BRUSHED_CHART_HEIGHT}
      showBrush
    />
  );
}

function DegradationChartWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useDegradation(ctx.vehicleId);
  return <DegradationChart data={data ?? []} loading={isLoading} height={BRUSHED_CHART_HEIGHT} showBrush />;
}

registerWidget({
  id: 'chart.soc',
  category: 'chart',
  title: 'State of Charge',
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  component: SocChartWidget,
});

registerWidget({
  id: 'chart.range',
  category: 'chart',
  title: 'Range History',
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  component: RangeChartWidget,
});

registerWidget({
  id: 'chart.phantom_drain',
  category: 'chart',
  title: 'Phantom Drain',
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  component: PhantomDrainChartWidget,
});

registerWidget({
  id: 'chart.degradation',
  category: 'chart',
  title: 'Battery Degradation',
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  component: DegradationChartWidget,
});
