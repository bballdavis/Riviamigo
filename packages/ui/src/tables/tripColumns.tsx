import * as React from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { Badge } from '../primitives/Badge';
import { formatMiles, formatDuration, formatKwh, formatEfficiency, formatEnergyPerDistance } from '../lib/utils';

export interface TripRow {
  id: string;
  started_at: string;
  ended_at: string;
  distance_mi: number;
  duration_min: number;
  energy_used_kwh: number;
  efficiency_wh_mi: number | null;
  drive_mode: string | null;
}

const col = createColumnHelper<TripRow>();

const MODE_VARIANT: Record<string, 'accent' | 'warning' | 'success' | 'info'> = {
  sport: 'warning',
  everyday: 'success',
  conserve: 'info',
  off_road_auto: 'accent',
};

export const tripColumns = [
  col.accessor('started_at', {
    header: 'Date',
    cell: (info) => (
      <span className="text-fg font-medium">
        {format(parseISO(info.getValue()), 'MMM d, yyyy')}
      </span>
    ),
  }),
  col.accessor('started_at', {
    id: 'time',
    header: 'Time',
    enableSorting: false,
    cell: (info) => (
      <span className="text-fg-secondary">
        {format(parseISO(info.getValue()), 'h:mm a')}
      </span>
    ),
  }),
  col.accessor('distance_mi', {
    header: 'Distance',
    cell: (info) => (
      <span className="font-mono text-fg">{formatMiles(info.getValue())}</span>
    ),
  }),
  col.accessor('duration_min', {
    header: 'Duration',
    cell: (info) => formatDuration(info.getValue()),
  }),
  col.accessor('energy_used_kwh', {
    header: 'Energy',
    cell: (info) => (
      <span className="font-mono">{formatKwh(info.getValue())}</span>
    ),
  }),
  col.accessor('efficiency_wh_mi', {
    header: 'Efficiency',
    cell: (info) => {
      const v = info.getValue();
      return v !== null ? (
        <span className="font-mono leading-tight">
          <span className="block text-fg">{formatEfficiency(v)}</span>
          <span className="block text-[11px] text-fg-tertiary">{formatEnergyPerDistance(v)}</span>
        </span>
      ) : (
        <span className="text-fg-tertiary">-</span>
      );
    },
  }),
  col.accessor('drive_mode', {
    header: 'Mode',
    enableSorting: false,
    cell: (info) => {
      const mode = info.getValue();
      if (!mode) return <span className="text-fg-tertiary">-</span>;
      return (
        <Badge variant={MODE_VARIANT[mode] ?? 'default'} size="sm">
          {mode.replace(/_/g, ' ')}
        </Badge>
      );
    },
  }),
];
