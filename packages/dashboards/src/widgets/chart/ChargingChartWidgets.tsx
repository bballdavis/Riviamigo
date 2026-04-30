import React from 'react';
import { useChargeSessions } from '@riviamigo/hooks';
import { EnergyBarChart } from '@riviamigo/ui/charts';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

function EnergyBarWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useChargeSessions(ctx.vehicleId, ctx.from, ctx.to, 1);
  const energyData = [...(data?.items ?? [])].reverse().map((s) => ({
    ts: s.started_at,
    energy_added_kwh: s.energy_added_kwh ?? 0,
  }));
  return <EnergyBarChart data={energyData} loading={isLoading} height={260} showBrush />;
}

registerWidget({
  id: 'chart.energy_bar',
  category: 'chart',
  title: 'Energy per Session',
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  component: EnergyBarWidget,
});
