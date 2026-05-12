import React from 'react';
import { Icon } from '@iconify/react';
import { useBatteryHealth, useCurrentVehicleStatus } from '@riviamigo/hooks';
import { Card } from '@riviamigo/ui/primitives';
import { cn, formatKwh, formatNumber, formatPercent } from '@riviamigo/ui/lib/utils';
import type { BatteryHealthSummary } from '@riviamigo/types';
import type { VehicleStatus } from '@riviamigo/types';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';

type StatCtx = { health: BatteryHealthSummary; status: VehicleStatus | null | undefined };

interface BatteryStatDefinition {
  id: string;
  title: string;
  icon: string;
  accentBorder?: boolean;
  labelSuffix?: string;
  getValue: (ctx: StatCtx) => string;
  getInlineSecondary?: (ctx: StatCtx) => string | undefined;
  getSecondary?: (ctx: StatCtx) => string | undefined;
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
    getValue: ({ health }) => fmt(health.battery_health_pct, (v) => formatPercent(v, 1)),
  },
  {
    id: 'estimated_degradation_pct',
    title: 'Estimated Degradation',
    icon: 'lucide:trending-down',
    getValue: ({ health }) => fmt(health.estimated_degradation_pct, (v) => formatPercent(v, 1)),
  },
  {
    id: 'usable_capacity',
    title: 'Capacity',
    icon: 'lucide:battery',
    labelSuffix: 'now/new',
    getValue: ({ health }) => fmt(health.usable_now_kwh, formatKwh),
    getInlineSecondary: ({ health }) =>
      health.usable_new_kwh != null ? `/${formatKwh(health.usable_new_kwh)}` : undefined,
  },
  {
    id: 'max_range',
    title: 'Max Range',
    icon: 'lucide:route',
    labelSuffix: 'now/new',
    getValue: ({ health, status }) => {
      const range = status?.range_miles ?? null;
      const level = status?.battery_level ?? null;
      if (range == null || level == null || level <= 0) return '—';
      return `${formatNumber(range / level * 100, 0)} mi`;
    },
    getInlineSecondary: ({ health, status }) => {
      const range = status?.range_miles ?? null;
      const level = status?.battery_level ?? null;
      if (range == null || level == null || level <= 0) return undefined;
      const maxNow = range / level * 100;
      const healthPct = health.battery_health_pct;
      if (healthPct == null || healthPct <= 0) return undefined;
      return `/${formatNumber(maxNow / healthPct * 100, 0)} mi`;
    },
  },
  {
    id: 'charge_count',
    title: 'Charges',
    icon: 'lucide:refresh-cw',
    getValue: ({ health }) => formatNumber(health.charge_count, 0),
    getSecondary: ({ health }) =>
      health.charging_cycles != null
        ? `${formatNumber(health.charging_cycles, 0)} cycles`
        : undefined,
  },
  {
    id: 'charging_cycles',
    title: 'Charging Cycles',
    icon: 'lucide:refresh-ccw',
    getValue: ({ health }) => {
      const cycles = health.charging_cycles || health.charge_count;
      return formatNumber(cycles, 0);
    },
  },
  {
    id: 'energy_added',
    title: 'Energy Added',
    icon: 'lucide:bolt',
    getValue: ({ health }) => fmt(health.total_energy_added_kwh, formatKwh),
  },
  {
    id: 'charge_efficiency',
    title: 'Charge Efficiency',
    icon: 'lucide:zap',
    getValue: ({ health }) => fmt(health.charging_efficiency_pct, (v) => formatPercent(v, 1)),
  },
];

const definitionById = new Map(BATTERY_STAT_DEFINITIONS.map((d) => [d.id, d]));

export function BatteryStatWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const definition = definitionById.get(instance.definitionId);
  const { data: health, isLoading: healthLoading } = useBatteryHealth(ctx.vehicleId);
  const { data: status, isLoading: statusLoading } = useCurrentVehicleStatus(ctx.vehicleId);
  const isLoading = healthLoading || (definition?.id === 'max_range' && statusLoading);
  const title = instance.title ?? definition?.title ?? instance.definitionId;
  const accentBorder = definition?.accentBorder ?? false;

  if (!definition) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary">
        Unknown stat: {instance.definitionId}
      </div>
    );
  }

  const statCtx: StatCtx = { health: health ?? {} as BatteryHealthSummary, status };
  const value = isLoading ? '…' : (health ? definition.getValue(statCtx) : '—');
  const inlineSecondary = !isLoading && health ? definition.getInlineSecondary?.(statCtx) : undefined;
  const secondary = !isLoading && health ? definition.getSecondary?.(statCtx) : undefined;

  return (
    <Card
      padding="none"
      className={cn(
        'relative flex h-full min-h-[72px] flex-col overflow-hidden border p-3',
        accentBorder
          ? 'border-accent/60 shadow-[inset_0_0_0_1px_var(--rm-border-accent)]'
          : 'border-border',
      )}
      data-testid="battery-stat-chip"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="truncate text-xs font-medium uppercase tracking-wider text-fg-tertiary">
          {title}
          {definition.labelSuffix ? (
            <span className="ml-1 text-[10px] font-normal normal-case tracking-normal">
              ({definition.labelSuffix})
            </span>
          ) : null}
        </p>
        <Icon icon={definition.icon} className="h-4 w-4 shrink-0 text-accent" />
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-mono text-2xl font-semibold tabular-nums tracking-tight',
            accentBorder ? 'text-accent' : 'text-fg',
          )}
        >
          {value}
        </span>
        {inlineSecondary ? (
          <span className="font-mono text-sm tabular-nums text-fg-tertiary">
            {inlineSecondary}
          </span>
        ) : null}
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
