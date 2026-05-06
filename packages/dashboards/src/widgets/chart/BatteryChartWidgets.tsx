import React from 'react';
import { useSocHistory, useRangeHistory, usePhantomDrain, useDegradation, useBatteryMileage } from '@riviamigo/hooks';
import { RichTimeSeriesChart } from '@riviamigo/ui/charts';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

const BRUSHED_CHART_HEIGHT = 260;

function SocChartWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useSocHistory(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <RichTimeSeriesChart
      points={(data ?? []).map((p: { ts: string }) => ({ ts: p.ts }))}
      series={[{ key: 'soc', label: 'SoC', values: (data ?? []).map((p: { soc?: number | null; value?: number | null }) => p.value ?? p.soc ?? null) }]}
      loading={isLoading}
      height={BRUSHED_CHART_HEIGHT}
      yUnit="%"
      mode="area"
    />
  );
}

function RangeChartWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useRangeHistory(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <RichTimeSeriesChart
      points={(data ?? []).map((p: { ts: string }) => ({ ts: p.ts }))}
      series={[{ key: 'range', label: 'Range', values: (data ?? []).map((p: { range_mi?: number | null; value?: number | null }) => p.value ?? p.range_mi ?? null) }]}
      loading={isLoading}
      height={BRUSHED_CHART_HEIGHT}
      yUnit="mi"
      mode="area"
    />
  );
}

function PhantomDrainChartWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = usePhantomDrain(ctx.vehicleId, ctx.from, ctx.to);
  return (
    <RichTimeSeriesChart
      points={(data ?? []).map((p: { day?: string; date?: string }) => ({ ts: p.day ?? p.date ?? '' }))}
      series={[{ key: 'drain', label: 'Drain', values: (data ?? []).map((p: { total_soc_lost?: number | null; drain_pct?: number | null }) => p.total_soc_lost ?? p.drain_pct ?? null) }]}
      loading={isLoading}
      height={BRUSHED_CHART_HEIGHT}
      yUnit="%"
      mode="bar"
    />
  );
}

function DegradationChartWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useDegradation(ctx.vehicleId);
  return (
    <RichTimeSeriesChart
      points={(data ?? []).map((p) => ({ ts: p.ts }))}
      series={[{ key: 'capacity', label: 'Capacity', values: (data ?? []).map((p) => p.capacity_pct ?? null) }]}
      loading={isLoading}
      height={BRUSHED_CHART_HEIGHT}
      yUnit="%"
      mode="line"
    />
  );
}

function BatteryCapacityMileageWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useBatteryMileage(ctx.vehicleId);
  return (
    <RichTimeSeriesChart
      points={(data ?? []).map((p) => ({ ts: p.ts }))}
      series={[{ key: 'usable', label: 'Usable Capacity', values: (data ?? []).map((p) => p.usable_kwh ?? null) }]}
      loading={isLoading}
      height={BRUSHED_CHART_HEIGHT}
      yUnit="kWh"
      mode="line"
    />
  );
}

function ProjectedRangeMileageWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useBatteryMileage(ctx.vehicleId);
  return (
    <RichTimeSeriesChart
      points={(data ?? []).map((p) => ({ ts: p.ts }))}
      series={[{ key: 'range', label: 'Projected Range', values: (data ?? []).map((p) => p.range_mi ?? null) }]}
      loading={isLoading}
      height={BRUSHED_CHART_HEIGHT}
      yUnit="mi"
      mode="line"
    />
  );
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

registerWidget({
  id: 'chart.battery_capacity_mileage',
  category: 'chart',
  title: 'Battery Capacity by Mileage',
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
  component: BatteryCapacityMileageWidget,
});

registerWidget({
  id: 'chart.projected_range_mileage',
  category: 'chart',
  title: 'Projected Range by Mileage',
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
  component: ProjectedRangeMileageWidget,
});
