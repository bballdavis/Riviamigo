import React from 'react';
import { useChargeSessions } from '@riviamigo/hooks';
import { RichTimeSeriesChart } from '@riviamigo/ui/charts';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

function EnergyBarWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useChargeSessions(ctx.vehicleId, ctx.from, ctx.to, 1);
  const sessions = [...(data?.items ?? [])].reverse();
  return (
    <RichTimeSeriesChart
      points={sessions.map((s) => ({ ts: s.started_at }))}
      series={[{ key: 'energy', label: 'Energy Added', values: sessions.map((s) => s.energy_added_kwh ?? null) }]}
      loading={isLoading}
      height={260}
      yUnit="kWh"
      mode="bar"
    />
  );
}

function ChargeLevelWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useChargeSessions(ctx.vehicleId, ctx.from, ctx.to, 1, 200);
  const points = [...(data?.items ?? [])]
    .reverse()
    .flatMap((session) => [
      ...(session.soc_start != null ? [{ ts: session.started_at, value: session.soc_start }] : []),
      ...(session.soc_end != null ? [{ ts: session.ended_at ?? session.started_at, value: session.soc_end }] : []),
    ]);
  return (
    <RichTimeSeriesChart
      points={points.map((point) => ({ ts: point.ts }))}
      series={[{ key: 'soc', label: 'Charge Level', values: points.map((point) => point.value) }]}
      loading={isLoading}
      height={260}
      yUnit="%"
      mode="line"
    />
  );
}

registerWidget({
  id: 'chart.energy_bar',
  category: 'chart',
  title: 'Energy per Session',
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  component: EnergyBarWidget,
});

registerWidget({
  id: 'chart.charge_level',
  category: 'chart',
  title: 'Charge Level',
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  component: ChargeLevelWidget,
});
