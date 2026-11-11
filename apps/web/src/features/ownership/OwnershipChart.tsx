import React, { useMemo } from 'react';
import { CHART_COLORS, CostTimelineChart, type CostTimelineRow } from '@riviamigo/ui/charts';
import type { Ledger } from './model';

export type ValueMode = 'spent' | 'net';

/**
 * One row at the purchase date, then two per month: the balance after the
 * month's fuel and insurance, and the balance after any one-time costs. Two
 * rows at the same instant draw the jump as a vertical step.
 */
export function buildChartRows(ledger: Ledger, mode: ValueMode): CostTimelineRow[] {
  const rows: CostTimelineRow[] = [{ t: ledger.startMs }];
  ledger.periods.forEach((period) => {
    rows.push({ t: period.endMs }, { t: period.endMs });
  });
  for (const entry of ledger.vehicles) {
    const id = entry.vehicle.id;
    let cursor = 0;
    const first = entry.points[0];
    if (!first) continue;
    (rows[0] as CostTimelineRow)[id] = first[mode];
    ledger.periods.forEach((period, index) => {
      cursor += 1;
      const before = entry.points[cursor];
      if (!before) return;
      const next = entry.points[cursor + 1];
      const after = next && next.t === period.endMs ? next : before;
      if (after !== before) cursor += 1;
      (rows[1 + index * 2] as CostTimelineRow)[id] = before[mode];
      (rows[2 + index * 2] as CostTimelineRow)[id] = after[mode];
    });
  }
  return rows;
}

export function formatMonth(ms: number, options: { long?: boolean } = {}): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: options.long ? 'long' : 'short',
    year: options.long ? 'numeric' : '2-digit',
    timeZone: 'UTC',
  });
}

interface OwnershipChartProps {
  ledger: Ledger;
  mode: ValueMode;
  colors: Record<string, string>;
  /** Index into `ledger.periods` of the inspected month. */
  cursorIndex: number;
  onCursorChange: (index: number) => void;
  /** Size of the plot; defaults to the shared chart's fixed height. */
  className?: string;
}

export function OwnershipChart({ ledger, mode, colors, cursorIndex, onCursorChange, className }: OwnershipChartProps) {
  const rows = useMemo(() => buildChartRows(ledger, mode), [ledger, mode]);
  const series = useMemo(
    () =>
      ledger.vehicles.map((entry) => ({
        id: entry.vehicle.id,
        label: entry.vehicle.label,
        color: colors[entry.vehicle.id] ?? CHART_COLORS.muted,
        emphasized: entry.vehicle.isOwn,
      })),
    [ledger.vehicles, colors],
  );
  const regions = useMemo(() => {
    const list = [];
    if (ledger.estimatedUntilMs != null) {
      list.push({ fromMs: ledger.startMs, toMs: ledger.estimatedUntilMs, label: 'Estimated' });
    }
    if (ledger.projectedFromMs != null) {
      list.push({ fromMs: ledger.projectedFromMs, toMs: ledger.endMs, label: 'Projected' });
    }
    return list;
  }, [ledger.startMs, ledger.endMs, ledger.estimatedUntilMs, ledger.projectedFromMs]);

  return (
    <CostTimelineChart
      rows={rows}
      series={series}
      regions={regions}
      startMs={ledger.startMs}
      endMs={ledger.endMs}
      cursorMs={ledger.periods[cursorIndex]?.endMs ?? ledger.endMs}
      onCursorChange={(ms) => {
        const index = ledger.periods.findIndex((period) => period.endMs >= ms);
        onCursorChange(index === -1 ? ledger.periods.length - 1 : index);
      }}
      ariaLabel={`${mode === 'net' ? 'Net cost' : 'Money spent'} over time for ${ledger.vehicles.length} vehicles`}
      {...(className ? { className } : {})}
    />
  );
}
