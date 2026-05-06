import React from 'react';
import { useEfficiencyTrend, useEfficiencyVsTemp, useEfficiencyByMode } from '@riviamigo/hooks';
import { RichTimeSeriesChart, EfficiencyVsTempChart, EfficiencyChart } from '@riviamigo/ui/charts';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

function EfficiencyTrendWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useEfficiencyTrend(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <RichTimeSeriesChart
      points={(data ?? []).map((p) => ({ ts: p.day }))}
      series={[
        { key: 'daily', label: 'Daily', values: (data ?? []).map((p) => p.day_avg_wh_mi ?? null) },
        { key: 'rolling', label: '7 Day', values: (data ?? []).map((p) => p.rolling_7d_wh_mi ?? null) },
      ]}
      loading={isLoading}
      height={260}
      yUnit="Wh/mi"
      mode="line"
    />
  );
}

function EfficiencyVsTempWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useEfficiencyVsTemp(ctx.vehicleId, ctx.from, ctx.to);
  return <EfficiencyVsTempChart data={data ?? []} loading={isLoading} height={300} />;
}

function EfficiencyByModeWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useEfficiencyByMode(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <EfficiencyChart
      data={data ?? []}
      loading={isLoading}
      height={300}
    />
  );
}

registerWidget({
  id: 'chart.efficiency_trend',
  category: 'chart',
  title: 'Efficiency Trend',
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  component: EfficiencyTrendWidget,
});

registerWidget({
  id: 'chart.efficiency_vs_temp',
  category: 'chart',
  title: 'Efficiency vs Temperature',
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
  component: EfficiencyVsTempWidget,
});

registerWidget({
  id: 'chart.efficiency_by_mode',
  category: 'chart',
  title: 'Efficiency by Drive Mode',
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
  component: EfficiencyByModeWidget,
});
