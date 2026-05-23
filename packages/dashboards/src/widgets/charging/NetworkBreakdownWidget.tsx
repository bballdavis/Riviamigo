/**
 * NetworkBreakdownWidget — shows a per-network breakdown of charging energy, cost,
 * session count, and free session count.  Data comes from the charging summary
 * `network_breakdown` array, which is populated after the Rivian API backfill runs.
 */
import React from 'react';
import { Icon } from '@iconify/react';
import { useChargingSummary } from '@riviamigo/hooks';
import { formatKwh, formatCurrency, formatNumber } from '@riviamigo/ui/lib/utils';
import { registerWidget } from '../../registry';
import type { WidgetInstance, WidgetCtx } from '../../registry';

interface NetworkBreakdownEntry {
  network_vendor: string | null;
  session_count: number;
  energy_kwh: number | null;
  cost_usd: number | null;
  free_sessions: number;
}

interface ChargingSummaryWithBreakdown {
  network_breakdown?: NetworkBreakdownEntry[];
}

function NetworkBar({ fraction, className }: { fraction: number; className?: string }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-bg-elevated">
      <div
        className={`h-full rounded-full transition-all ${className ?? 'bg-accent'}`}
        style={{ width: `${Math.min(100, Math.max(0, fraction * 100)).toFixed(1)}%` }}
      />
    </div>
  );
}

const NETWORK_ICON: Record<string, string> = {
  rivian: 'lucide:zap',
  'electrify america': 'lucide:bolt',
  evgo: 'lucide:plug-zap',
  chargepoint: 'lucide:plug',
};

function networkIcon(vendor: string | null): string {
  if (!vendor) return 'lucide:help-circle';
  return NETWORK_ICON[vendor.toLowerCase()] ?? 'lucide:building';
}

function NetworkBreakdownWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { data, isLoading } = useChargingSummary(ctx.vehicleId, ctx.from, ctx.to);
  const summary = data as ChargingSummaryWithBreakdown | undefined;
  const breakdown: NetworkBreakdownEntry[] = summary?.network_breakdown ?? [];

  const totalEnergy = breakdown.reduce((sum, r) => sum + (r.energy_kwh ?? 0), 0);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-2 p-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl border border-border bg-bg-elevated/60" />
        ))}
      </div>
    );
  }

  if (breakdown.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-tertiary">
        <div className="text-center">
          <Icon icon="lucide:plug-zap" className="mx-auto mb-2 h-8 w-8 text-fg-tertiary/40" />
          <p>No network data yet</p>
          <p className="mt-1 text-xs">Available after charge history backfill</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-1">
      {breakdown.map((row) => {
        const fraction = totalEnergy > 0 ? (row.energy_kwh ?? 0) / totalEnergy : 0;
        const name = row.network_vendor ?? 'Unknown';
        return (
          <div
            key={name}
            className="rounded-xl border border-border bg-bg-elevated/60 px-3 py-2.5"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon icon={networkIcon(row.network_vendor)} className="h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="truncate text-sm font-medium text-fg">{name}</span>
                {row.free_sessions > 0 && (
                  <span className="shrink-0 rounded-full bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
                    {row.free_sessions} free
                  </span>
                )}
              </div>
              <span className="font-mono text-sm text-fg-secondary">
                {row.energy_kwh != null ? formatKwh(row.energy_kwh) : '—'}
              </span>
            </div>
            <NetworkBar fraction={fraction} />
            <div className="mt-1.5 flex items-center gap-3 text-xs text-fg-tertiary">
              <span>{formatNumber(row.session_count, 0)} sessions</span>
              {row.cost_usd != null && row.cost_usd > 0 && (
                <>
                  <span>·</span>
                  <span className="font-mono">{formatCurrency(row.cost_usd)}</span>
                </>
              )}
              <span className="ml-auto">
                {(fraction * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

registerWidget({
  componentType: 'custom',
  definitionId: 'charging.network_breakdown',
  title: 'Network Breakdown',
  defaultSize: { w: 4, h: 8 },
  minSize: { w: 3, h: 4 },
  defaultOptions: {},
  component: NetworkBreakdownWidget,
});
