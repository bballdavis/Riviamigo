import React from 'react';
import { useChargingSummary } from '@riviamigo/hooks';
import { StatCard } from '@riviamigo/ui/primitives';
import { formatKwh, formatCurrency } from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

function TotalEnergyWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useChargingSummary(ctx.vehicleId, ctx.from, ctx.to);
  return <StatCard label="Total Energy" value={formatKwh(data?.total_energy_kwh ?? 0)} accent />;
}

function ChargingSessionsWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useChargingSummary(ctx.vehicleId, ctx.from, ctx.to);
  return <StatCard label="Sessions" value={data?.session_count ?? 0} />;
}

function TotalCostWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useChargingSummary(ctx.vehicleId, ctx.from, ctx.to);
  return <StatCard label="Total Cost" value={formatCurrency(data?.total_cost_usd ?? 0)} />;
}

function AvgSessionWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data } = useChargingSummary(ctx.vehicleId, ctx.from, ctx.to);
  const avg =
    data && data.session_count > 0 ? data.total_energy_kwh / data.session_count : 0;
  return <StatCard label="Avg Session" value={formatKwh(avg)} />;
}

registerWidget({
  id: 'stat.total_energy',
  category: 'stat',
  title: 'Total Energy',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: TotalEnergyWidget,
});

registerWidget({
  id: 'stat.charging_sessions',
  category: 'stat',
  title: 'Charging Sessions',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: ChargingSessionsWidget,
});

registerWidget({
  id: 'stat.total_cost',
  category: 'stat',
  title: 'Total Cost',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: TotalCostWidget,
});

registerWidget({
  id: 'stat.avg_session',
  category: 'stat',
  title: 'Avg Session Energy',
  defaultSize: { w: 3, h: 1 },
  minSize: { w: 2, h: 1 },
  component: AvgSessionWidget,
});
