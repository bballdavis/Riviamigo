import * as React from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { formatKwh, formatMiles, formatPercent, formatSmartNumber } from '../lib/utils';

export interface PhantomDrainRow {
  period_start: string | null;
  period_end: string | null;
  duration_hours: number | null;
  standby_pct: number | null;
  soc_start: number | null;
  soc_end: number | null;
  soc_lost_pct: number | null;
  drain_pct_per_hour: number | null;
  range_start_mi: number | null;
  range_end_mi: number | null;
  range_lost_mi: number | null;
  range_lost_per_hour_mi: number | null;
  energy_drained_kwh: number | null;
  avg_power_w: number | null;
  has_reduced_range: boolean | null;
}

const col = createColumnHelper<PhantomDrainRow>();

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const parsed = parseISO(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return format(parsed, 'MMM d, yyyy h:mm a');
}

function formatDurationHours(value: number | null) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${formatSmartNumber(value, 1)} h`;
}

function formatPowerWatts(value: number | null) {
  if (value == null || Number.isNaN(value)) return '—';
  if (Math.abs(value) >= 1000) {
    return `${formatSmartNumber(value / 1000, 2)} kW`;
  }
  return `${formatSmartNumber(value, 0)} W`;
}

export const phantomDrainColumns = [
  col.accessor('period_start', {
    header: 'Start',
    cell: (info) => <span className="whitespace-nowrap text-fg">{formatDateTime(info.getValue())}</span>,
  }),
  col.accessor('period_end', {
    header: 'End',
    cell: (info) => <span className="whitespace-nowrap text-fg">{formatDateTime(info.getValue())}</span>,
  }),
  col.accessor('duration_hours', {
    header: 'Period',
    cell: (info) => <span className="font-mono text-fg-secondary">{formatDurationHours(info.getValue())}</span>,
  }),
  col.accessor('standby_pct', {
    header: 'Standby',
    cell: (info) => {
      const value = info.getValue();
      if (value == null || Number.isNaN(value)) return <span className="text-fg-tertiary">—</span>;
      return <span className="font-mono text-fg-secondary">{formatPercent(value * 100, 0)}</span>;
    },
  }),
  col.accessor('soc_lost_pct', {
    header: 'SoC Diff',
    cell: (info) => {
      const value = info.getValue();
      if (value == null || Number.isNaN(value)) return <span className="text-fg-tertiary">—</span>;
      return <span className="font-mono text-fg">-{formatPercent(value, 2)}</span>;
    },
  }),
  col.accessor('range_lost_mi', {
    header: 'Range loss',
    cell: (info) => {
      const value = info.getValue();
      if (value == null || Number.isNaN(value)) return <span className="text-fg-tertiary">—</span>;
      return <span className="font-mono text-fg">{formatMiles(value)}</span>;
    },
  }),
  col.accessor('range_lost_per_hour_mi', {
    header: 'Range loss / h',
    cell: (info) => {
      const value = info.getValue();
      if (value == null || Number.isNaN(value)) return <span className="text-fg-tertiary">—</span>;
      return <span className="font-mono text-fg-secondary">{`${formatMiles(value)} / h`}</span>;
    },
  }),
  col.accessor('energy_drained_kwh', {
    header: 'Energy drained',
    cell: (info) => <span className="font-mono text-fg">{formatKwh(info.getValue())}</span>,
  }),
  col.accessor('avg_power_w', {
    header: 'Avg power',
    cell: (info) => <span className="font-mono text-fg-secondary">{formatPowerWatts(info.getValue())}</span>,
  }),
  col.accessor('has_reduced_range', {
    header: ' ',
    cell: (info) => {
      if (!info.getValue()) return <span className="text-fg-tertiary"> </span>;
      return (
        <span
          role="img"
          aria-label="Reduced range conditions"
          title="Estimated range loss may be impacted by reduced-range conditions."
          className="text-accent"
        >
          ❄
        </span>
      );
    },
  }),
];
