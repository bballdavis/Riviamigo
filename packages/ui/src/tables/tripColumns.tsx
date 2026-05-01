import * as React from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { formatMiles, formatDuration, formatPercent, formatEnergyPerDistance } from '../lib/utils';
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
  start_lat?: number | null;
  start_lng?: number | null;
  end_lat?: number | null;
  end_lng?: number | null;
}

const col = createColumnHelper<TripRow>();

export function createTripColumns(places: Place[] = []) {
  return [
    col.accessor('started_at', {
      header: 'Date',
      cell: (info) => (
        <span className="font-medium text-fg whitespace-nowrap">
          {format(parseISO(info.getValue()), 'MM/dd/yyyy, h:mm:ss a')}
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
      header: '% Start',
      cell: (info) => {
        const value = info.getValue();
        return value === null ? <span className="text-fg-tertiary">-</span> : <span className="font-mono text-fg">{formatPercent(value)}</span>;
      },
    }),
    col.accessor('soc_end', {
      header: '% End',
      cell: (info) => {
        const value = info.getValue();
        return value === null ? <span className="text-fg-tertiary">-</span> : <span className="font-mono text-fg">{formatPercent(value)}</span>;
      },
    }),
    col.accessor('efficiency_wh_mi', {
      header: 'Ø Consumption (net)',
      cell: (info) => {
        const v = info.getValue();
        return v !== null ? (
          <span className="font-mono text-fg whitespace-nowrap">{formatEnergyPerDistance(v)}</span>
        ) : (
          <span className="text-fg-tertiary">-</span>
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
        <span className="block min-w-0 w-[14rem] truncate font-medium text-fg" title={location.title}>
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
