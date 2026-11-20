import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAppTimezone, setAppTimezone } from '@riviamigo/ui/lib/dateTime';
import type { VehicleNavigationRoute } from '@riviamigo/types';
import {
  decodeNavigationLine,
  resolveNavigationArrival,
  splitRouteAtVehicle,
} from '../../../../packages/dashboards/src/widgets/custom/overviewNavigation';
import { DRIVE_WAVE_HEIGHT, layoutDriveWave } from '../../../../packages/dashboards/src/widgets/custom/overviewDriveWaveLayout';

// (38.5, -120.2) → (40.7, -120.95) → (43.252, -126.453)
const FIRST_LEG = '_p~iF~ps|U_ulLnnqC';
const SECOND_LEG = '_flwFn`faV_mqNvxq`@';

function route(polylines: string[]): VehicleNavigationRoute {
  return {
    id: '1',
    polylines,
    polyline_precision: 5,
    stops: [{ kind: 'place', name: 'Trailhead', latitude: 43.252, longitude: -126.453, arrival_at: null }],
  };
}

describe('decodeNavigationLine', () => {
  it('joins the legs in order without repeating the stop between them', () => {
    expect(decodeNavigationLine(route([FIRST_LEG, SECOND_LEG]))).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it('is empty for a route with no usable line', () => {
    expect(decodeNavigationLine(route([]))).toEqual([]);
    expect(decodeNavigationLine(route(['not a polyline']))).toEqual([]);
  });
});

describe('splitRouteAtVehicle', () => {
  const line = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.01 },
    { lat: 0.01, lng: 0.01 },
  ];

  it('cuts the line at the vehicle, snapped onto the road', () => {
    // About 20 m north of the middle of the first segment.
    const split = splitRouteAtVehicle(line, { lat: 0.0002, lng: 0.005 });
    expect(split.index).toBe(0);
    expect(split.traveled).toEqual([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.005 }]);
    expect(split.ahead).toEqual([{ lat: 0, lng: 0.005 }, { lat: 0, lng: 0.01 }, { lat: 0.01, lng: 0.01 }]);
  });

  it('counts nothing as driven at the start, off the route, or without a position', () => {
    expect(splitRouteAtVehicle(line, { lat: 0, lng: 0 })).toMatchObject({ traveled: [], ahead: line });
    // Several kilometres from the line.
    expect(splitRouteAtVehicle(line, { lat: 0.2, lng: 0.2 })).toMatchObject({ traveled: [], ahead: line });
    expect(splitRouteAtVehicle(line, null)).toMatchObject({ traveled: [], ahead: line });
    expect(splitRouteAtVehicle([], { lat: 0, lng: 0 })).toMatchObject({ traveled: [], ahead: [] });
  });

  it('stays on the outbound leg of a route that returns along the same road', () => {
    const outAndBack = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
      { lat: 0, lng: 0 },
    ];
    const vehicle = { lat: 0, lng: 0.004 };
    const outbound = splitRouteAtVehicle(outAndBack, vehicle);
    expect(outbound.index).toBe(0);
    expect(outbound.ahead).toHaveLength(3);
    // Once the vehicle has reached the return leg, the earlier one is behind it.
    const returning = splitRouteAtVehicle(outAndBack, vehicle, 1);
    expect(returning.index).toBe(1);
    expect(returning.ahead).toEqual([{ lat: 0, lng: 0.004 }, { lat: 0, lng: 0 }]);
  });
});

describe('resolveNavigationArrival', () => {
  let timezone: string;
  beforeEach(() => {
    timezone = getAppTimezone();
    setAppTimezone('UTC');
  });
  afterEach(() => setAppTimezone(timezone));

  const now = Date.parse('2026-11-19T15:49:00Z');

  it('splits the clock time from its day period and counts the time left', () => {
    expect(resolveNavigationArrival('2026-11-19T16:12:00Z', now)).toEqual({ time: '4:12', period: 'PM', remaining: '23 min' });
    expect(resolveNavigationArrival('2026-11-19T18:54:00Z', now)).toMatchObject({ remaining: '3h 05m' });
    expect(resolveNavigationArrival('2026-11-21T03:49:00Z', now)).toMatchObject({ remaining: '1d 12h' });
  });

  it('reads Arriving once the arrival time is reached', () => {
    expect(resolveNavigationArrival('2026-11-19T15:49:20Z', now)).toMatchObject({ remaining: 'Arriving' });
    expect(resolveNavigationArrival('2026-11-19T15:40:00Z', now)).toMatchObject({ remaining: 'Arriving' });
  });

  it('has nothing to show without a usable arrival time', () => {
    expect(resolveNavigationArrival(null, now)).toBeNull();
    expect(resolveNavigationArrival(undefined, now)).toBeNull();
    expect(resolveNavigationArrival('not a time', now)).toBeNull();
  });
});

describe('layoutDriveWave with an arrival time', () => {
  const speed = { width: 34, height: 38 };
  const gear = { width: 10, height: 14 };
  const arrival = { width: 52, height: 26 };

  it('places the arrival hump to the right of the speed with the gear to its left', () => {
    const layout = layoutDriveWave(440, speed, gear, arrival);
    expect(layout.gear.b).toBeCloseTo(layout.center.a);
    expect(layout.arrival.a).toBeCloseTo(layout.center.b);
    expect(layout.center.x).toBeCloseTo(220);
    expect(layout.arrival.x).toBeGreaterThan(layout.center.b);
    // The crest clears the top of the arrival text.
    expect(layout.arrival.crest).toBeLessThan(DRIVE_WAVE_HEIGHT - arrival.height);
    expect(layout.arrival.b).toBeLessThanOrEqual(440 - 12);
  });

  it('moves the speed left when the arrival hump would run into the corner', () => {
    const layout = layoutDriveWave(200, speed, null, arrival);
    expect(layout.center.x).toBeLessThan(100);
    expect(layout.arrival.b).toBeLessThanOrEqual(200 - 12);
    expect(layout.center.a).toBeGreaterThanOrEqual(12);
  });

  it('keeps a wide charging hump off the corner and the center value as near the midline as it allows', () => {
    // "Parked" beside a charging hump: a bolt over its label is wider than a gear letter.
    const parked = { width: 46, height: 13 };
    const charging = { width: 50, height: 31 };
    const layout = layoutDriveWave(307, parked, charging);
    expect(layout.gear.a).toBeGreaterThanOrEqual(12);
    expect(layout.gear.b).toBeCloseTo(layout.center.a);
    expect(layout.center.b).toBeLessThanOrEqual(307 - 12);
    // The crest clears the bolt and its label.
    expect(layout.gear.crest).toBeLessThan(DRIVE_WAVE_HEIGHT - charging.height);
    expect(layout.gear.crest).toBeLessThan(layout.center.crest);
  });

  it('keeps one command list with or without the arrival hump so the line can animate', () => {
    const commands = (path: string) => path.replace(/[-\d.,\s]/g, '');
    const withArrival = layoutDriveWave(440, speed, gear, arrival);
    const without = layoutDriveWave(440, speed, gear);
    expect(commands(withArrival.line)).toBe(commands(without.line));
    expect(commands(withArrival.fill)).toBe(commands(without.fill));
    // Collapsed at the speed hump's foot when there is nothing to show.
    expect(without.arrival.a).toBe(without.arrival.b);
  });
});
