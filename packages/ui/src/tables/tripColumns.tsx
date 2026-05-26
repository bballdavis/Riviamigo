import * as React from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { PiArrowFatLinesRight } from 'react-icons/pi';
import { Badge } from '../primitives/Badge';
import { formatMiles, formatDuration, formatPercent, formatEfficiency } from '../lib/utils';
import { formatDriveMode, getDriveModeBadgeClass } from '../lib/driveMode';
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

export function createTripColumns(places: Place[] = []) {
  return [
    col.accessor('started_at', {
      header: 'Date',
      cell: (info) => (
        <span className="font-medium text-fg whitespace-nowrap">
          {format(parseISO(info.getValue()), 'MM/dd/yyyy, h:mm a')}
        </span>
      ),
    }),
    locationColumn('start', 'Start', places),
    locationColumn('end', 'Destination', places),
    col.accessor('duration_min', {
      header: 'Duration',
      cell: (info) => formatDuration(info.getValue()),
    }),
    col.accessor('distance_mi', {
      header: 'Distance',
      cell: (info) => (
        <span className="font-mono text-fg">{formatMiles(info.getValue())}</span>
      ),
    }),
    col.accessor('soc_start', {
      id: 'soc_range',
      header: 'SoC',
      enableSorting: false,
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
      header: 'Avg Efficiency',
      cell: (info) => {
        const v = info.getValue();
        return v !== null ? (
          <span className="font-mono text-fg whitespace-nowrap">{formatEfficiency(v)}</span>
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
          <Badge size="sm" className={getDriveModeBadgeClass(mode)} title={formatDriveMode(mode)}>
            {formatDriveMode(mode)}
          </Badge>
        );
      },
    }),
  ];
}

export const tripColumns = createTripColumns();

function locationColumn(kind: 'start' | 'end', header: string, places: Place[]) {
  return col.accessor(kind === 'start' ? 'started_at' : 'ended_at', {
    id: kind,
    header,
    enableSorting: false,
    cell: (info) => {
      const trip = info.row.original;
      const location = resolveTripLocation(trip, kind, places);
      return location ? (
        <span className="block min-w-0 flex-1 truncate font-medium text-fg text-sm" title={location.title}>
          {location.label}
        </span>
      ) : (
        <span className="text-fg-tertiary">-</span>
      );
    },
  });
}

function resolveTripLocation(trip: TripRow, kind: 'start' | 'end', places: Place[]) {
  const record = trip as unknown as Record<string, unknown>;
  const placeLabel = readFirstString(record, [
    `${kind}_place`,
    `${kind}_place_name`,
    `${kind}_location_name`,
    `${kind}_location`,
    `${kind}_label`,
  ]);
  if (placeLabel) return { label: placeLabel, title: placeLabel };

  const addressLabel = readFirstString(record, [
    `${kind}_address`,
    `${kind}_address_display_name`,
    `${kind}_address_name`,
    `${kind}_address_label`,
  ]);
  const lat = readNumber(record, `${kind}_lat`);
  const lng = readNumber(record, `${kind}_lng`);

  if (lat !== null && lng !== null) {
    const matchedPlace = findMatchingPlace(lat, lng, places);
    if (matchedPlace) {
      return {
        label: matchedPlace.name,
        title: matchedPlace.address?.display_name ?? matchedPlace.name,
      };
    }
  }

  if (addressLabel) return { label: addressLabel, title: addressLabel };
  if (lat !== null && lng !== null) {
    const label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return { label, title: label };
  }

  return null;
}

function findMatchingPlace(lat: number, lng: number, places: Place[]) {
  let closest: Place | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const place of places) {
    const distance = distanceMeters(lat, lng, place.latitude, place.longitude);
    if (distance <= place.radius_m && distance < closestDistance) {
      closest = place;
      closestDistance = distance;
    }
  }

  return closest;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const earthRadius = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function readFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
