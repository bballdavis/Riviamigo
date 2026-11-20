import type { VehicleNavigationRoute } from '@riviamigo/types';
import { formatAppTimeParts } from '@riviamigo/ui/lib/dateTime';
import { decodePolyline } from '@riviamigo/ui/lib/polyline';

/** Geometry and copy for the route drawn on the Vehicle Overview map. */

export interface RoutePoint { lat: number; lng: number }

/** Lines longer than this are thinned before they reach the map. */
const MAX_LINE_POINTS = 20_000;
/** A vehicle this close to the line is on it, wherever GPS drift puts it. */
const ON_ROUTE_METERS = 60;
/** Beyond this the vehicle has left the route; the whole line stays ahead. */
const OFF_ROUTE_METERS = 250;
const METERS_PER_DEGREE = 111_320;

/** The route's legs joined into one line, in driving order. */
export function decodeNavigationLine(route: VehicleNavigationRoute): RoutePoint[] {
  const line: RoutePoint[] = [];
  for (const encoded of route.polylines) {
    for (const point of decodePolyline(encoded, route.polyline_precision)) {
      const last = line[line.length - 1];
      // Consecutive legs share the stop between them.
      if (last && last.lat === point.lat && last.lng === point.lng) continue;
      line.push(point);
    }
  }
  if (line.length <= MAX_LINE_POINTS) return line;
  const stride = Math.ceil(line.length / MAX_LINE_POINTS);
  const thinned = line.filter((_, index) => index % stride === 0);
  const end = line[line.length - 1]!;
  if (thinned[thinned.length - 1] !== end) thinned.push(end);
  return thinned;
}

export interface RouteSplit {
  /** The part already driven, ending at the vehicle. */
  traveled: RoutePoint[];
  /** The part still to drive, starting at the vehicle. */
  ahead: RoutePoint[];
  /** Segment the vehicle is on; pass it back as `fromIndex` next time. */
  index: number;
}

/**
 * Splits the route at the vehicle.
 *
 * The vehicle is placed on the first segment at or after `fromIndex` that it
 * is on, so a route that doubles back on itself (out and back along one road)
 * is not cut at the return leg. Off the route entirely, nothing counts as
 * driven.
 */
export function splitRouteAtVehicle(line: RoutePoint[], vehicle: RoutePoint | null, fromIndex = 0): RouteSplit {
  const whole: RouteSplit = { traveled: [], ahead: line, index: 0 };
  if (!vehicle || line.length < 2) return whole;
  const scaleX = Math.cos((vehicle.lat * Math.PI) / 180) * METERS_PER_DEGREE;
  const toLocal = (point: RoutePoint) => ({ x: (point.lng - vehicle.lng) * scaleX, y: (point.lat - vehicle.lat) * METERS_PER_DEGREE });

  let nearest = { distance: Infinity, index: 0, t: 0 };
  let onRoute: typeof nearest | null = null;
  let a = toLocal(line[0]!);
  for (let index = 0; index < line.length - 1; index += 1) {
    const b = toLocal(line[index + 1]!);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    // Closest point on the segment to the vehicle, which is the local origin.
    const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / lengthSquared));
    const distance = Math.hypot(a.x + dx * t, a.y + dy * t);
    if (distance < nearest.distance) nearest = { distance, index, t };
    if (!onRoute && index >= fromIndex && distance <= ON_ROUTE_METERS) onRoute = { distance, index, t };
    a = b;
  }

  const hit = onRoute ?? nearest;
  if (hit.distance > OFF_ROUTE_METERS) return whole;
  const start = line[hit.index]!;
  const end = line[hit.index + 1]!;
  const joint = { lat: start.lat + (end.lat - start.lat) * hit.t, lng: start.lng + (end.lng - start.lng) * hit.t };
  return {
    // At the very start nothing has been driven yet.
    traveled: hit.index === 0 && hit.t === 0 ? [] : [...line.slice(0, hit.index + 1), joint],
    ahead: [joint, ...line.slice(hit.index + 1)],
    index: hit.index,
  };
}

export interface NavigationArrival {
  /** Clock time, such as "4:12". */
  time: string;
  /** Day period ("PM"), or null on a 24-hour clock. */
  period: string | null;
  /** Time left, such as "23 min" or "1h 05m". */
  remaining: string;
}

/** The arrival time and the time left until it, or null when there is none to show. */
export function resolveNavigationArrival(destinationEta: string | null | undefined, nowMs: number): NavigationArrival | null {
  if (!destinationEta) return null;
  const arrivalMs = new Date(destinationEta).getTime();
  const clock = formatAppTimeParts(destinationEta);
  if (!Number.isFinite(arrivalMs) || !clock) return null;
  return { ...clock, remaining: formatRemaining(arrivalMs - nowMs) };
}

function formatRemaining(remainingMs: number): string {
  const minutes = Math.round(remainingMs / 60_000);
  if (minutes < 1) return 'Arriving';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
