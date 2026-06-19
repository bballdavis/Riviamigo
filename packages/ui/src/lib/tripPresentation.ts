import type { Place } from '@riviamigo/types';

export const TRIP_LOCATION_UNAVAILABLE_COPY = 'Location unavailable';

export interface ResolvedTripLocation {
  label: string;
  title: string;
  source: 'place' | 'address' | 'coordinates' | 'unavailable';
}

export function resolveTripLocation(
  trip: Record<string, unknown>,
  kind: 'start' | 'end',
  places: Place[] = [],
): ResolvedTripLocation {
  const placeLabel = readFirstString(trip, [
    `${kind}_place`,
    `${kind}_place_name`,
    `${kind}_location_name`,
    `${kind}_location`,
    `${kind}_label`,
  ]);
  if (placeLabel) return { label: placeLabel, title: placeLabel, source: 'place' };

  const addressLabel = readFirstString(trip, [
    `${kind}_address`,
    `${kind}_address_display_name`,
    `${kind}_address_name`,
    `${kind}_address_label`,
  ]);
  const lat = readNumber(trip, `${kind}_lat`);
  const lng = readNumber(trip, `${kind}_lng`);

  if (lat !== null && lng !== null && !isZeroCoordinate(lat, lng)) {
    const matchedPlace = findMatchingPlace(lat, lng, places);
    if (matchedPlace) {
      return {
        label: matchedPlace.name,
        title: matchedPlace.address?.display_name ?? matchedPlace.name,
        source: 'place',
      };
    }
  }

  if (addressLabel) return { label: addressLabel, title: addressLabel, source: 'address' };
  if (lat !== null && lng !== null && !isZeroCoordinate(lat, lng)) {
    const label = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return { label, title: label, source: 'coordinates' };
  }

  return {
    label: TRIP_LOCATION_UNAVAILABLE_COPY,
    title: TRIP_LOCATION_UNAVAILABLE_COPY,
    source: 'unavailable',
  };
}

function isZeroCoordinate(lat: number, lng: number) {
  return lat === 0 && lng === 0;
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
