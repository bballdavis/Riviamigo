import type { VehicleStatus } from '@riviamigo/types';

/**
 * What the drive wave along the bottom of the overview map shows.
 *
 * Parked keeps it to a single word. Once the vehicle is in gear the line lifts
 * into a large hump around the speed and a smaller one around the gear letter.
 */
export type DriveWaveState =
  | { kind: 'parked' }
  | { kind: 'moving'; gear: DriveWaveGear | null; speedMph: number | null };

export type DriveWaveGear = 'D' | 'R' | 'N';

/** Below this the vehicle is treated as stationary when the gear is unknown. */
const MOVING_SPEED_MPH = 2;

const GEAR_LETTERS: Record<string, DriveWaveGear> = {
  drive: 'D',
  reverse: 'R',
  neutral: 'N',
};

export function resolveDriveWaveState(status: VehicleStatus | null | undefined): DriveWaveState | null {
  if (!status) return null;
  const speedMph = typeof status.speed_mph === 'number' && Number.isFinite(status.speed_mph) ? Math.max(0, status.speed_mph) : null;
  if (status.power_state === 'sleep') return { kind: 'parked' };
  const rawGear = status.gear_status?.trim().toLowerCase();
  if (rawGear === 'park') return { kind: 'parked' };
  const gear = rawGear ? GEAR_LETTERS[rawGear] ?? null : null;
  if (gear) return { kind: 'moving', gear, speedMph };
  // No usable gear report: fall back to speed so a moving vehicle still reads as moving.
  if (speedMph !== null && speedMph >= MOVING_SPEED_MPH) return { kind: 'moving', gear: null, speedMph };
  return { kind: 'parked' };
}

// ---- geometry ----

/** Height of the drive wave's box at the bottom of the map. */
export const DRIVE_WAVE_HEIGHT = 64;
export const DRIVE_WAVE_STROKE = 3;
/** Text sits this far above the map's bottom edge. */
export const DRIVE_WAVE_TEXT_BOTTOM = 4;
/** Panels at or below this width get the compact layout. */
export const DRIVE_WAVE_NARROW_WIDTH = 210;

/** The flat line runs along the bottom edge, inset by half the stroke so none of it is cut off. */
const BASE = DRIVE_WAVE_HEIGHT - DRIVE_WAVE_STROKE / 2;
/** Gap between a value's top edge and the hump's crest. */
const CREST_LIFT = 5;
/** Panel corner radius; humps keep a flat lead-in past it. */
const CORNER = 12;

export interface DriveWaveBox { width: number; height: number }

export interface DriveWaveHump {
  /** Footprint start and end along the line. */
  a: number;
  b: number;
  crest: number;
  /** Horizontal run of each shoulder. */
  s: number;
  /** Center, where the value is placed. */
  x: number;
}

export interface DriveWaveLayout {
  gear: DriveWaveHump;
  center: DriveWaveHump;
  /** Stroke path: flat along the bottom edge, overrunning both sides so the panel clips it. */
  line: string;
  /** Closed shape of everything under the line, for the glass fill. */
  fill: string;
}

/**
 * Lays out the humps for the measured value boxes.
 *
 * Each hump hugs its value: the flat crest is a little narrower than the text,
 * since the shoulders are still above the text's top corners where they begin
 * to fall. The speed hump stays centered when it can; when space is short the
 * shoulders tighten before anything moves into the flat lead-in at either end.
 */
export function layoutDriveWave(width: number, center: DriveWaveBox, gear: DriveWaveBox | null): DriveWaveLayout {
  const narrow = width <= DRIVE_WAVE_NARROW_WIDTH;
  const shoulderPerRise = narrow ? 0.95 : 1.25;
  const edge = CORNER + (narrow ? 4 : 14);

  const shape = (box: DriveWaveBox) => {
    const crest = DRIVE_WAVE_HEIGHT - DRIVE_WAVE_TEXT_BOTTOM - box.height - CREST_LIFT;
    const flat = Math.max(4, box.width - 2 * Math.min(7, box.width * 0.18));
    const s = Math.max(0, BASE - crest) * shoulderPerRise;
    return { crest, flat, s, span: flat + 2 * s };
  };

  const c = shape(center);
  const g = gear ? shape(gear) : null;
  const parts = g ? [g, c] : [c];
  const flatSum = parts.reduce((total, part) => total + part.flat, 0);
  const shoulderSum = parts.reduce((total, part) => total + 2 * part.s, 0);
  const available = width - 2 * edge;
  if (shoulderSum > 0 && flatSum + shoulderSum > available) {
    const factor = Math.max(0.4, (available - flatSum) / shoulderSum);
    for (const part of parts) {
      part.s *= factor;
      part.span = part.flat + 2 * part.s;
    }
  }

  const leftOf = g ? g.span : 0;
  let cx = width / 2;
  if (cx + c.span / 2 > width - edge) cx = width - edge - c.span / 2;
  if (cx - c.span / 2 - leftOf < edge) cx = edge + leftOf + c.span / 2;

  const centerHump: DriveWaveHump = { a: cx - c.span / 2, b: cx + c.span / 2, crest: c.crest, s: c.s, x: cx };
  // An absent gear hump collapses to nothing at the speed hump's foot, so the
  // path keeps the same commands and can animate between states.
  const gearHump: DriveWaveHump = g
    ? { a: centerHump.a - g.span, b: centerHump.a, crest: g.crest, s: g.s, x: centerHump.a - g.span / 2 }
    : { a: centerHump.a, b: centerHump.a, crest: BASE, s: 0, x: centerHump.a };

  const humps = `${hump(gearHump)}${hump(centerHump)}`;
  const overrun = DRIVE_WAVE_STROKE * 2;
  return {
    gear: gearHump,
    center: centerHump,
    line: `M${n(-overrun)},${n(BASE)} ${humps}L${n(width + overrun)},${n(BASE)}`,
    fill: `M0,${DRIVE_WAVE_HEIGHT} L0,${n(BASE)} ${humps}L${n(width)},${n(BASE)} L${n(width)},${DRIVE_WAVE_HEIGHT} Z`,
  };
}

function hump({ a, b, crest, s }: DriveWaveHump): string {
  const run = Math.min(s, (b - a) / 2);
  return `L${n(a)},${n(BASE)} C${n(a + run / 2)},${n(BASE)} ${n(a + run / 2)},${n(crest)} ${n(a + run)},${n(crest)} `
    + `L${n(b - run)},${n(crest)} C${n(b - run / 2)},${n(crest)} ${n(b - run / 2)},${n(BASE)} ${n(b)},${n(BASE)} `;
}

function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}
