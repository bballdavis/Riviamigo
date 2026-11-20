import type { VehicleStatus } from '@riviamigo/types';

/** One lockable part of the vehicle. `locked` is `null` until the vehicle reports it. */
export interface VehicleLockPart {
  id: string;
  label: string;
  locked: boolean | null;
}

export type VehicleLockState = 'locked' | 'unlocked' | 'unknown';

const DOOR_COUNT = 4;

export interface VehicleLocks {
  /**
   * Unlocked when any part is. Locked when none is and all four doors have
   * reported locked, so a vehicle that has so far reported only its frunk
   * does not read as locked. Otherwise unknown.
   */
  state: VehicleLockState;
  parts: VehicleLockPart[];
}

/**
 * The locks a model has, with their current state.
 *
 * The list goes by model, not by which fields carry a value: a vehicle also
 * reports locks for parts it does not have (an R1S sends tonneau and side-bin
 * locks), and those must not make it read as unlocked.
 */
export function resolveVehicleLocks(
  status: VehicleStatus | null | undefined,
  model: string | null | undefined,
): VehicleLocks {
  const parts: VehicleLockPart[] = [
    part('door_front_left', 'Front left door', status?.door_front_left_locked),
    part('door_front_right', 'Front right door', status?.door_front_right_locked),
    part('door_rear_left', 'Rear left door', status?.door_rear_left_locked),
    part('door_rear_right', 'Rear right door', status?.door_rear_right_locked),
    part('frunk', 'Frunk', status?.closure_frunk_locked),
  ];
  if (model === 'R1T') {
    parts.push(part('tailgate', 'Tailgate', status?.closure_tailgate_locked));
    // Not every R1T has a powered tonneau cover; list it once it reports.
    if (isKnown(status?.tonneau_locked)) parts.push(part('tonneau', 'Tonneau cover', status?.tonneau_locked));
    parts.push(part('side_bin_left', 'Left side bin', status?.side_bin_left_locked));
    parts.push(part('side_bin_right', 'Right side bin', status?.side_bin_right_locked));
  } else if (model === 'R1S') {
    parts.push(part('liftgate', 'Liftgate', status?.closure_liftgate_locked));
    // The R1S rear opening is split: a liftgate above a short tailgate.
    if (isKnown(status?.closure_tailgate_locked)) parts.push(part('tailgate', 'Tailgate', status?.closure_tailgate_locked));
  } else if (model === 'R2' || model === 'R2S') {
    parts.push(part('liftgate', 'Liftgate', status?.closure_liftgate_locked));
  } else {
    parts.push(part('rear_gate', 'Rear gate', status?.closure_liftgate_locked ?? status?.closure_tailgate_locked));
  }
  // The doors come first in the list and every model has four.
  const doors = parts.slice(0, DOOR_COUNT);
  const state: VehicleLockState = parts.some((entry) => entry.locked === false)
    ? 'unlocked'
    : doors.every((entry) => entry.locked === true)
      ? 'locked'
      : 'unknown';
  return { state, parts };
}

function part(id: string, label: string, locked: boolean | null | undefined): VehicleLockPart {
  return { id, label, locked: isKnown(locked) ? locked : null };
}

function isKnown(value: boolean | null | undefined): value is boolean {
  return value === true || value === false;
}
