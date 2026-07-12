import type { TripRow } from '@riviamigo/ui/tables';
import { formatDuration, formatEfficiency, formatMiles } from '@riviamigo/ui/lib/utils';

export type TripStatKind = 'miles' | 'count' | 'efficiency' | 'duration';

const TRIP_STAT_BY_METRIC: Record<string, TripStatKind> = {
  trip_miles: 'miles',
  total_trips: 'count',
  avg_efficiency: 'efficiency',
  avg_trip_duration: 'duration',
};

export function getTripStatKind(metric: string | null | undefined): TripStatKind | null {
  if (!metric) return null;
  return TRIP_STAT_BY_METRIC[metric] ?? null;
}

export function computeTripStat(stat: TripStatKind, trips: TripRow[]): number | null {
  if (trips.length === 0) return null;
  if (stat === 'count') return trips.length;
  if (stat === 'miles') return trips.reduce((sum, trip) => sum + trip.distance_mi, 0);
  if (stat === 'duration') return trips.reduce((sum, trip) => sum + trip.duration_min, 0) / trips.length;

  const weightedTrips = trips.filter((trip) => trip.distance_mi > 0 && trip.efficiency_wh_mi != null);
  if (weightedTrips.length === 0) return null;

  const totalDistance = weightedTrips.reduce((sum, trip) => sum + trip.distance_mi, 0);
  if (totalDistance <= 0) return null;

  const weightedEfficiency = weightedTrips.reduce(
    (sum, trip) => sum + (trip.distance_mi * (trip.efficiency_wh_mi ?? 0)),
    0,
  );
  return weightedEfficiency / totalDistance;
}

export function formatTripStat(stat: TripStatKind, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  if (stat === 'miles') return formatMiles(value);
  if (stat === 'duration') return formatDuration(value);
  if (stat === 'efficiency') return formatEfficiency(value);
  return value.toFixed(0);
}

export function formatTripSelectionLabel(count: number) {
  return `${count} trip${count === 1 ? '' : 's'} selected`;
}
