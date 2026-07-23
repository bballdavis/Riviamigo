import * as React from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { FaInfo } from 'react-icons/fa6';
import { PiArrowFatLinesRight } from 'react-icons/pi';
import { Badge } from '../primitives/Badge';
import {
  formatMiles,
  formatDuration,
  formatPercent,
  formatEfficiencyValue,
  getEfficiencyUnitLabel,
} from '../lib/utils';
import { formatDriveMode, getDriveModeBadgeClass } from '../lib/driveMode';
import { resolveTripLocation } from '../lib/tripPresentation';
import { formatAppDateTime } from '../lib/dateTime';
import type { Place } from '@riviamigo/types';

export interface TripRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  distance_mi: number;
  duration_min: number;
  energy_used_kwh: number | null;
  efficiency_wh_mi: number | null;
  soc_start: number | null;
  soc_end: number | null;
  drive_mode?: string | null;
  start_lat?: number | null;
  start_lng?: number | null;
  end_lat?: number | null;
  end_lng?: number | null;
  // Reverse-geocoded labels returned by the API
  start_address?: string | null;
  end_address?: string | null;
  start_place?: string | null;
  end_place?: string | null;
}

const col = createColumnHelper<TripRow>();

interface CreateTripColumnsOptions {
  onInfoClick?: (tripId: string) => void;
}

export function createTripColumns(places: Place[] = [], options: CreateTripColumnsOptions = {}) {
  const columns: ColumnDef<TripRow, any>[] = [
    col.accessor('started_at', {
      header: () => <span>Date</span>,
      meta: {
        headerClassName: 'w-[10.75rem]',
        cellClassName: 'w-[10.75rem]',
      },
      cell: (info) => (
        <span className="font-medium text-fg whitespace-nowrap">
          {formatAppDateTime(info.getValue())}
        </span>
      ),
    }),
    locationColumn('start', 'Start', places),
    locationColumn('end', 'Destination', places),
    col.accessor('duration_min', {
      header: 'Duration',
      meta: {
        headerClassName: 'w-[5.25rem]',
        cellClassName: 'w-[5.25rem] whitespace-nowrap text-center',
        headerContentClassName: 'w-full justify-center',
      },
      cell: (info) => formatDuration(info.getValue()),
    }),
    col.accessor('distance_mi', {
      header: 'Distance',
      meta: {
        headerClassName: 'w-[5.25rem]',
        cellClassName: 'w-[5.25rem] whitespace-nowrap text-center',
        headerContentClassName: 'w-full justify-center',
      },
      cell: (info) => (
        <span className="font-mono text-fg">{formatMiles(info.getValue())}</span>
      ),
    }),
    col.accessor('soc_start', {
      id: 'soc_range',
      header: 'SoC',
      enableSorting: false,
      meta: {
        headerClassName: 'w-[5.25rem]',
        cellClassName: 'w-[5.25rem] whitespace-nowrap text-center',
        headerContentClassName: 'w-full justify-center',
      },
      cell: (info) => {
        const row = info.row.original;
        if (row.soc_start === null || row.soc_end === null) return <span className="text-fg-tertiary">-</span>;
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-fg">
            {formatPercent(row.soc_start)}
            <PiArrowFatLinesRight className="h-3.5 w-3.5 text-fg-tertiary" />
            {formatPercent(row.soc_end)}
          </span>
        );
      },
    }),
    col.accessor('efficiency_wh_mi', {
      header: () => <span className="whitespace-nowrap">Avg. Eff.</span>,
      meta: {
        headerClassName: 'w-[8.5rem]',
        cellClassName: 'w-[8.5rem] whitespace-nowrap text-center',
        headerContentClassName: 'w-full justify-center',
      },
      cell: (info) => {
        const v = info.getValue();
        return v !== null ? (
          <span className="inline-flex items-baseline justify-center gap-1 whitespace-nowrap font-mono text-fg">
            <span>{formatEfficiencyValue(v)}</span>
            <span className="text-[11px] font-normal text-fg-tertiary">{getEfficiencyUnitLabel()}</span>
          </span>
        ) : (
          <span className="text-fg-tertiary">-</span>
        );
      },
    }),
    col.accessor('drive_mode', {
      header: 'Mode',
      enableSorting: false,
      meta: {
        headerClassName: 'w-[6.5rem]',
        cellClassName: 'w-[6.5rem] text-center',
        headerContentClassName: 'w-full justify-center',
      },
      cell: (info) => {
        const mode = info.getValue();
        if (!mode) return <span className="text-fg-tertiary">-</span>;
        return (
          <Badge size="sm" className={`mx-auto max-w-[6.5rem] truncate ${getDriveModeBadgeClass(mode)}`} title={formatDriveMode(mode)}>
            {formatDriveMode(mode)}
          </Badge>
        );
      },
    }),
  ];

  if (options.onInfoClick) {
    columns.push(
      col.display({
        id: 'details',
        header: '',
        enableSorting: false,
        meta: {
          headerClassName: 'w-[3.25rem] text-center',
          cellClassName: 'w-[3.25rem] text-center',
          headerContentClassName: 'w-full justify-center',
        },
        cell: (info) => (
          <div className="ml-auto mr-1 h-7 w-7">
            <button
              type="button"
              aria-label="Open trip details"
              title="Open trip details"
              onClick={(event) => {
                event.stopPropagation();
                options.onInfoClick?.(info.row.original.id);
              }}
              className="inline-flex h-full w-full items-center justify-center rounded-md border border-border bg-bg-surface p-1 text-fg-tertiary transition-colors hover:border-border-strong hover:text-fg"
            >
              <FaInfo className="h-full w-full" />
            </button>
          </div>
        ),
      }),
    );
  }

  return columns;
}

export const tripColumns = createTripColumns();

function locationColumn(kind: 'start' | 'end', header: string, places: Place[]) {
  return col.accessor(kind === 'start' ? 'started_at' : 'ended_at', {
    id: kind,
    header,
    enableSorting: false,
    meta: {
      // Start/Destination are the flexible columns and absorb width pressure.
      headerClassName: 'min-w-0',
      cellClassName: 'min-w-0',
    },
    cell: (info) => {
      const trip = info.row.original as unknown as Record<string, unknown>;
      const location = resolveTripLocation(trip, kind, places);
      return (
        <span className="block w-full min-w-0 max-w-full truncate font-medium text-fg text-sm" title={location.title}>
          {location.label}
        </span>
      );
    },
  });
}
