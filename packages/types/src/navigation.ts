/**
 * Live navigation from the vehicle's own route planner, sent on the live
 * status socket while the vehicle is navigating. It is never stored: there is
 * no REST endpoint for it and no history.
 */

/** `place` is a destination the driver chose; `charging` is a stop the planner added. */
export type VehicleNavigationStopKind = 'place' | 'charging';

export interface VehicleNavigationStop {
  kind: VehicleNavigationStopKind;
  name: string | null;
  latitude: number;
  longitude: number;
  /** Arrival time planned when the route was computed. */
  arrival_at: string | null;
}

export interface VehicleNavigationRoute {
  /** Changes whenever the vehicle sends a different route. */
  id: string;
  /** Encoded polylines in driving order, one per leg (or one for the trip). */
  polylines: string[];
  /** Decimal digits the polylines are encoded with. */
  polyline_precision: number;
  /** Remaining stops in order; the last one is the destination. */
  stops: VehicleNavigationStop[];
}

/** What the client keeps for a navigating vehicle. */
export interface VehicleNavigation {
  route: VehicleNavigationRoute;
  /** Live arrival time at the destination, or the planned one. */
  destination_eta: string | null;
}

/**
 * The `navigation` body of a `{ "type": "navigation" }` socket frame. The
 * route is included when it is new to this socket and omitted while only the
 * arrival time changes.
 */
export type VehicleNavigationFrame =
  | { active: false }
  | {
    active: true;
    route_id: string;
    route?: VehicleNavigationRoute;
    destination_eta: string | null;
  };
