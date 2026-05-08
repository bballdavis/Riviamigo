import React from 'react';
import { Icon } from '@iconify/react';
import { useBatteryHealth } from '@riviamigo/hooks';
import { Card } from '@riviamigo/ui/primitives';
import { cn, formatKwh, formatNumber, formatPercent } from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';
import type { BatteryHealthSummary } from '@riviamigo/types';

interface BatteryStatDefinition {
  id: string;
  title: string;
  icon: string;
  accentBorder?: boolean;
  getValue: (health: BatteryHealthSummary) => string;
  getSecondaryValue?: (health: BatteryHealthSummary) => string | undefined;
}

function fmt(value: number | null | undefined, fn: (v: number) => string): string {
  return value == null ? '—' : fn(value);
}

const BATTERY_STAT_DEFINITIONS: BatteryStatDefinition[] = [
  {
    id: 'health_pct',
    title: 'Battery Health',
    icon: 'lucide:shield-check',
    accentBorder: true,
    getValue: (h) => fmt(h.battery_health_pct, (v) => formatPercent(v, 1)),
    getSecondaryValue: (h) =>
      h.estimated_degradation_pct != null
        ? `${formatPercent(h.estimated_degradation_pct, 1)} degradation`
        : undefined,
  },
  {
    id: 'usable_capacity',
    title: 'Usable Capacity',
    icon: 'lucide:battery',
    getValue: (h) => fmt(h.usable_now_kwh, formatKwh),
    getSecondaryValue: (h) =>
      h.usable_new_kwh != null ? `/ ${formatKwh(h.usable_new_kwh)} new` : undefined,
  },
  {
    id: 'charge_efficiency',
    title: 'Charge Efficiency',
    icon: 'lucide:zap',
    getValue: (h) => fmt(h.charging_efficiency_pct, (v) => formatPercent(v, 1)),
  },
  {
    id: 'charge_count',
    title: 'Charge Sessions',
    icon: 'lucide:refresh-cw',
    getValue: (h) => formatNumber(h.charge_count, 0),
    getSecondaryValue: (h) =>
      h.charging_cycles != null
        ? `${formatNumber(h.charging_cycles, 0)} cycles`
        : undefined,
  },
  {
    id: 'energy_added',
    title: 'Energy Added',
    icon: 'lucide:bolt',
    getValue: (h) => fmt(h.total_energy_added_kwh, formatKwh),
  },
];

const definitionById = new Map(BATTERY_STAT_DEFINITIONS.map((d) => [d.id, d]));

export function BatteryStatWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const definition = definitionById.get(instance.definitionId);
  const { data: health, isLoading } = useBatteryHealth(ctx.vehicleId);
  const title = instance.title ?? definition?.title ?? instance.definitionId;
  const accentBorder = definition?.accentBorder ?? false;

  const value = isLoading ? '…' : (health && definition ? definition.getValue(health) : '—');
  const secondary =
    !isLoading && health && definition?.getSecondaryValue
      ? definition.getSecondaryValue(health)
      : undefined;

  if (!definition) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary">
        Unknown stat: {instance.definitionId}
      </div>
    );
  }

  return (
    <Card
      padding="none"
      className={cn(
        'relative flex h-full min-h-[72px] flex-col overflow-hidden border p-3',
        accentBorder
          ? 'border-orange-400/60 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.22)]'
          : 'border-border',
      )}
      data-testid="battery-stat-chip"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="truncate text-xs font-medium uppercase tracking-wider text-fg-tertiary">
          {title}
        </p>
        <Icon icon={definition.icon} className="h-4 w-4 shrink-0 text-accent" />
      </div>

      <div className="mt-1.5 flex items-baseline gap-1">
        <span
          className={cn(
            'font-mono text-2xl font-semibold tabular-nums tracking-tight',
            accentBorder ? 'text-accent' : 'text-fg',
          )}
        >
          {value}
        </span>
      </div>

      {secondary ? (
        <p className="mt-0.5 truncate text-xs text-fg-tertiary">{secondary}</p>
      ) : null}
    </Card>
  );
}

for (const definition of BATTERY_STAT_DEFINITIONS) {
  registerWidget({
    componentType: 'battery',
    definitionId: definition.id,
    title: definition.title,
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    component: BatteryStatWidget,
  });
}
