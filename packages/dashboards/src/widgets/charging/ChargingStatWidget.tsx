import React from 'react';
import { Icon } from '@iconify/react';
import { useChargingSummary } from '@riviamigo/hooks';
import { Card } from '@riviamigo/ui/primitives';
import { cn, formatCurrency, formatKwh, formatNumber, formatPercent } from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';

interface ChargingSummarySnapshot {
  session_count: number;
  total_energy_kwh: number | null;
  total_cost_usd: number | null;
  home_kwh: number | null;
  away_kwh: number | null;
  unknown_location_kwh: number | null;
  ac_kwh: number | null;
  dc_kwh: number | null;
  charging_cycles: number | null;
  charging_efficiency_pct: number | null;
  max_charge_rate_kw: number | null;
  max_charge_limit_pct: number | null;
}

interface ChargingStatDefinition {
  id: string;
  title: string;
  icon: string;
  accentBorder?: boolean;
  getValue: (summary: ChargingSummarySnapshot) => string;
  getSecondary?: (summary: ChargingSummarySnapshot) => string | undefined;
}

function fmt(value: number | null | undefined, fn: (v: number) => string): string {
  return value == null ? '—' : fn(value);
}

function fmtKw(value: number | null | undefined): string {
  return value == null ? '—' : `${formatNumber(value, 1)} kW`;
}

const CHARGING_STAT_DEFINITIONS: ChargingStatDefinition[] = [
  {
    id: 'sessions',
    title: 'Sessions',
    icon: 'lucide:calendar-days',
    getValue: (s) => formatNumber(s.session_count, 0),
  },
  {
    id: 'total_energy',
    title: 'Total Energy',
    icon: 'lucide:bolt',
    accentBorder: true,
    getValue: (s) => fmt(s.total_energy_kwh, formatKwh),
  },
  {
    id: 'total_cost',
    title: 'Total Cost',
    icon: 'lucide:dollar-sign',
    getValue: (s) => fmt(s.total_cost_usd, formatCurrency),
  },
  {
    id: 'avg_session',
    title: 'Avg / Session',
    icon: 'lucide:zap',
    getValue: (s) => {
      if (!s.session_count || s.total_energy_kwh == null) return '—';
      return formatKwh(s.total_energy_kwh / s.session_count);
    },
  },
  {
    id: 'charging_cycles',
    title: 'Charging Cycles',
    icon: 'lucide:refresh-ccw',
    getValue: (s) => fmt(s.charging_cycles, (v) => formatNumber(v, 0)),
  },
  {
    id: 'charge_efficiency',
    title: 'Charge Efficiency',
    icon: 'lucide:activity',
    getValue: (s) => fmt(s.charging_efficiency_pct, (v) => formatPercent(v, 1)),
  },
  {
    id: 'max_charge_rate',
    title: 'Max Charge Rate',
    icon: 'lucide:gauge',
    getValue: (s) => fmtKw(s.max_charge_rate_kw),
  },
  {
    id: 'max_charge_limit',
    title: 'Max Charge Limit',
    icon: 'lucide:battery',
    getValue: (s) => fmt(s.max_charge_limit_pct, (v) => formatPercent(v, 0)),
  },
  {
    id: 'home_share',
    title: 'Home Charging',
    icon: 'lucide:home',
    getValue: (s) => {
      const knownEnergy = (s.home_kwh ?? 0) + (s.away_kwh ?? 0);
      if (!knownEnergy) return '—';
      return formatPercent(((s.home_kwh ?? 0) / knownEnergy) * 100, 0);
    },
    getSecondary: (s) =>
      `Home ${fmt(s.home_kwh, formatKwh)} / Away ${fmt(s.away_kwh, formatKwh)}`,
  },
  {
    id: 'dc_share',
    title: 'DC Fast Charging',
    icon: 'lucide:plug-zap',
    getValue: (s) => {
      const total = s.total_energy_kwh;
      if (!total) return '—';
      return formatPercent(((s.dc_kwh ?? 0) / total) * 100, 0);
    },
    getSecondary: (s) =>
      `AC ${fmt(s.ac_kwh, formatKwh)} / DC ${fmt(s.dc_kwh, formatKwh)}`,
  },
];

const definitionById = new Map(CHARGING_STAT_DEFINITIONS.map((d) => [d.id, d]));

export function ChargingStatWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const definition = definitionById.get(instance.definitionId);
  const { data: summary, isLoading } = useChargingSummary(ctx.vehicleId, ctx.from, ctx.to);
  const title = instance.title ?? definition?.title ?? instance.definitionId;
  const accentBorder = definition?.accentBorder ?? false;

  if (!definition) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary">
        Unknown stat: {instance.definitionId}
      </div>
    );
  }

  const snap = summary as ChargingSummarySnapshot | undefined;
  const value = isLoading ? '…' : (snap ? definition.getValue(snap) : '—');
  const secondary = !isLoading && snap ? definition.getSecondary?.(snap) : undefined;

  return (
    <Card
      padding="none"
      className={cn(
        'relative flex h-full min-h-[72px] flex-col overflow-hidden border p-3',
        accentBorder
          ? 'border-accent/60 shadow-[inset_0_0_0_1px_var(--rm-border-accent)]'
          : 'border-border',
      )}
      data-testid="charging-stat-chip"
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

for (const definition of CHARGING_STAT_DEFINITIONS) {
  registerWidget({
    componentType: 'charging',
    definitionId: definition.id,
    title: definition.title,
    defaultSize: { w: 3, h: 2 },
    minSize: { w: 2, h: 2 },
    component: ChargingStatWidget,
  });
}
