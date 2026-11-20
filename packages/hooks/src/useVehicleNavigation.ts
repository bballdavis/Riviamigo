import { create } from 'zustand';
import type { VehicleNavigation, VehicleNavigationFrame, VehicleNavigationRoute, VehicleNavigationStop } from '@riviamigo/types';

/**
 * Live navigation per vehicle, fed by `navigation` frames on the live status
 * socket. It is kept apart from vehicle status because it is not status: the
 * server never stores it, so nothing here is merged with the REST snapshot
 * and nothing survives a reload.
 */
interface LiveNavigationStore {
  navigation: Record<string, VehicleNavigation>;
  apply: (vehicleId: string, frame: VehicleNavigationFrame) => void;
  clear: (vehicleId: string) => void;
}

export const useLiveNavigationStore = create<LiveNavigationStore>((set) => ({
  navigation: {},
  apply: (vehicleId, frame) =>
    set((state) => {
      const current = state.navigation[vehicleId];
      const next = nextNavigation(current, frame);
      if (next === current) return state;
      const navigation = { ...state.navigation };
      if (next) navigation[vehicleId] = next;
      else delete navigation[vehicleId];
      return { navigation };
    }),
  clear: (vehicleId) =>
    set((state) => {
      if (!(vehicleId in state.navigation)) return state;
      const navigation = { ...state.navigation };
      delete navigation[vehicleId];
      return { navigation };
    }),
}));

function nextNavigation(
  current: VehicleNavigation | undefined,
  frame: VehicleNavigationFrame,
): VehicleNavigation | undefined {
  if (!frame.active) return undefined;
  // The server sends the route once per socket, then only what changes.
  const route = frame.route ?? (current?.route.id === frame.route_id ? current.route : undefined);
  if (!route) return undefined;
  if (current && current.route === route && current.destination_eta === frame.destination_eta) return current;
  return { route, destination_eta: frame.destination_eta };
}

/**
 * How long a route stays on the map after the live socket goes down. A
 * reconnect inside this window (a token renewal, a brief network drop) keeps
 * it, because every new socket is told the current state at once. Past it,
 * nothing confirms the vehicle is still navigating, so the route is removed.
 */
export const NAVIGATION_DISCONNECT_GRACE_MS = 60_000;

const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelDisconnectExpiry(vehicleId: string) {
  clearTimeout(disconnectTimers.get(vehicleId));
  disconnectTimers.delete(vehicleId);
}

/**
 * Call when a vehicle's live socket closes. The route is removed unless a
 * navigation frame arrives within the grace period. Repeated closes keep the
 * first deadline, so a socket that never reconnects cannot postpone it.
 */
export function expireNavigationAfterDisconnect(vehicleId: string) {
  if (disconnectTimers.has(vehicleId)) return;
  if (!(vehicleId in useLiveNavigationStore.getState().navigation)) return;
  disconnectTimers.set(vehicleId, setTimeout(() => {
    disconnectTimers.delete(vehicleId);
    useLiveNavigationStore.getState().clear(vehicleId);
  }, NAVIGATION_DISCONNECT_GRACE_MS));
}

/**
 * Applies a parsed live-socket message when it is a navigation frame.
 * Returns whether it was one, so the caller does not treat it as status.
 */
export function applyNavigationMessage(vehicleId: string, message: unknown): boolean {
  if (!isRecord(message) || message.type !== 'navigation') return false;
  // The server has just said where navigation stands.
  cancelDisconnectExpiry(vehicleId);
  const frame = parseNavigationFrame(message.navigation);
  // A frame this client cannot read must not leave an old route on the map.
  if (frame) useLiveNavigationStore.getState().apply(vehicleId, frame);
  else useLiveNavigationStore.getState().clear(vehicleId);
  return true;
}

export function clearVehicleNavigation(vehicleId: string) {
  cancelDisconnectExpiry(vehicleId);
  useLiveNavigationStore.getState().clear(vehicleId);
}

/** The vehicle's live navigation, or `null` while it is not navigating. */
export function useVehicleNavigation(vehicleId: string | null | undefined): VehicleNavigation | null {
  return useLiveNavigationStore((state) => (vehicleId ? state.navigation[vehicleId] ?? null : null));
}

function parseNavigationFrame(value: unknown): VehicleNavigationFrame | null {
  if (!isRecord(value)) return null;
  if (value.active === false) return { active: false };
  if (value.active !== true || typeof value.route_id !== 'string') return null;
  const destination_eta = typeof value.destination_eta === 'string' ? value.destination_eta : null;
  if (value.route === undefined || value.route === null) {
    return { active: true, route_id: value.route_id, destination_eta };
  }
  const route = parseRoute(value.route);
  if (!route || route.id !== value.route_id) return null;
  return { active: true, route_id: value.route_id, route, destination_eta };
}

function parseRoute(value: unknown): VehicleNavigationRoute | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !Array.isArray(value.stops)) return null;
  const stops = value.stops.map(parseStop);
  if (stops.length === 0 || stops.some((stop) => stop === null)) return null;
  const polylines = Array.isArray(value.polylines)
    ? value.polylines.filter((line): line is string => typeof line === 'string')
    : [];
  return {
    id: value.id,
    polylines,
    polyline_precision: typeof value.polyline_precision === 'number' ? value.polyline_precision : 5,
    stops: stops as VehicleNavigationStop[],
  };
}

function parseStop(value: unknown): VehicleNavigationStop | null {
  if (!isRecord(value)) return null;
  const { latitude, longitude } = value;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    kind: value.kind === 'charging' ? 'charging' : 'place',
    name: typeof value.name === 'string' && value.name ? value.name : null,
    latitude,
    longitude,
    arrival_at: typeof value.arrival_at === 'string' ? value.arrival_at : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
