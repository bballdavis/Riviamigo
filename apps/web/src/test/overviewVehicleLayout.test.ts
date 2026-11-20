import { describe, expect, it } from 'vitest';
import type { VehicleStatus } from '@riviamigo/types';
import { resolveVehicleLocks } from '../../../../packages/dashboards/src/widgets/custom/overviewLocks';
import {
  endBadgeMidpointPct,
  LARGE_END_BADGE_REM,
  R2_PICTURE_END_BADGES,
  resolveVehicleUnitTransform,
  SHARED_END_BADGES,
  SMALL_END_BADGE_REM,
} from '../../../../packages/dashboards/src/widgets/custom/overviewVehicleLayout';

/**
 * Lays the unit out the way the browser does: a frame centered in a panel,
 * moved by the transform, with a badge centered on each end anchor. Returns
 * the room left outside each badge.
 */
function outerGaps(
  transform: string,
  badges: { rearPct: number; frontPct: number },
  rearBadgeRem: number,
  frontBadgeRem: number,
  panelWidth: number,
  frameWidth: number,
) {
  const match = /^translateX\((?:calc\((-?[\d.]+)% ([+-]) ([\d.]+)rem\)|(-?[\d.]+)%)\)$/.exec(transform);
  if (!match) throw new Error(`unexpected transform ${transform}`);
  const percent = Number(match[1] ?? match[4]);
  const rem = match[2] ? Number(match[3]) * (match[2] === '-' ? -1 : 1) : 0;
  const frameLeft = (panelWidth - frameWidth) / 2 + (percent / 100) * frameWidth + rem * 16;
  const rearEdge = frameLeft + (badges.rearPct / 100) * frameWidth - (rearBadgeRem * 16) / 2;
  const frontEdge = frameLeft + (badges.frontPct / 100) * frameWidth + (frontBadgeRem * 16) / 2;
  return { left: rearEdge, right: panelWidth - frontEdge };
}

describe('vehicle unit centering', () => {
  it.each([
    ['shared badges, both large (R1S, R2 demo, packaged art)', SHARED_END_BADGES, LARGE_END_BADGE_REM, 'translateX(-3%)'],
    ['shared badges, small rear padlock (R1T)', SHARED_END_BADGES, SMALL_END_BADGE_REM, 'translateX(calc(-3% - 0.1875rem))'],
    ["Rivian's own R2 picture", R2_PICTURE_END_BADGES, LARGE_END_BADGE_REM, 'translateX(-5.4%)'],
  ] as const)('leaves equal room outside both end badges: %s', (_name, badges, rearBadgeRem, expected) => {
    const transform = resolveVehicleUnitTransform(badges, rearBadgeRem, LARGE_END_BADGE_REM);
    expect(transform).toBe(expected);
    // Phone, compact column, wide column, and a frame larger than its panel.
    for (const [panelWidth, frameWidth] of [[340, 294], [232, 190], [465, 415], [900, 520], [180, 160]] as const) {
      const gaps = outerGaps(transform, badges, rearBadgeRem, LARGE_END_BADGE_REM, panelWidth, frameWidth);
      expect(gaps.left).toBeCloseTo(gaps.right, 6);
    }
  });

  it('moved the unit right of where the fixed 5% offset left it', () => {
    const before = outerGaps('translateX(-5%)', SHARED_END_BADGES, LARGE_END_BADGE_REM, LARGE_END_BADGE_REM, 465, 415);
    expect(before.right - before.left).toBeCloseTo(16.6, 1);
  });

  it('puts a packaged picture midway between the end badges', () => {
    expect(endBadgeMidpointPct(SHARED_END_BADGES)).toBe(53);
    expect(endBadgeMidpointPct(R2_PICTURE_END_BADGES)).toBe(55.4);
  });

  it('adds rem when the rear badge is the larger one', () => {
    expect(resolveVehicleUnitTransform(SHARED_END_BADGES, LARGE_END_BADGE_REM, SMALL_END_BADGE_REM)).toBe('translateX(calc(-3% + 0.1875rem))');
  });
});

describe('resolveVehicleLocks', () => {
  const allLocked = {
    door_front_left_locked: true,
    door_front_right_locked: true,
    door_rear_left_locked: true,
    door_rear_right_locked: true,
    closure_frunk_locked: true,
    closure_liftgate_locked: true,
    closure_tailgate_locked: true,
    tonneau_locked: true,
    side_bin_left_locked: true,
    side_bin_right_locked: true,
  } as VehicleStatus;
  const labels = (model: string | undefined, status: VehicleStatus | null = allLocked) =>
    resolveVehicleLocks(status, model).parts.map((part) => part.label);

  it('lists the locks each model has', () => {
    const doors = ['Front left door', 'Front right door', 'Rear left door', 'Rear right door', 'Frunk'];
    expect(labels('R1T')).toEqual([...doors, 'Tailgate', 'Tonneau cover', 'Left side bin', 'Right side bin']);
    expect(labels('R1S')).toEqual([...doors, 'Liftgate', 'Tailgate']);
    expect(labels('R2')).toEqual([...doors, 'Liftgate']);
    expect(labels('R2S')).toEqual([...doors, 'Liftgate']);
    expect(labels(undefined)).toEqual([...doors, 'Rear gate']);
  });

  it('leaves out optional parts the vehicle has not reported', () => {
    const status = { ...allLocked, tonneau_locked: null, closure_tailgate_locked: null } as VehicleStatus;
    expect(labels('R1T', status)).not.toContain('Tonneau cover');
    expect(labels('R1S', status)).not.toContain('Tailgate');
    // The R1T's tailgate is not optional: it stays listed, waiting for a report.
    expect(resolveVehicleLocks(status, 'R1T').parts.find((part) => part.id === 'tailgate')).toMatchObject({ locked: null });
  });

  it('is unlocked when any lock the model has is unlocked', () => {
    expect(resolveVehicleLocks(allLocked, 'R1S').state).toBe('locked');
    expect(resolveVehicleLocks({ ...allLocked, closure_frunk_locked: false } as VehicleStatus, 'R1S').state).toBe('unlocked');
    expect(resolveVehicleLocks({ ...allLocked, door_rear_left_locked: false } as VehicleStatus, 'R2').state).toBe('unlocked');
  });

  it('ignores locks reported for parts the model does not have', () => {
    // A real R1S reports tonneau and side-bin locks although it has neither.
    const status = { ...allLocked, tonneau_locked: false, side_bin_left_locked: false, side_bin_right_locked: false } as VehicleStatus;
    expect(resolveVehicleLocks(status, 'R1S').state).toBe('locked');
    expect(resolveVehicleLocks(status, 'R2').state).toBe('locked');
    expect(resolveVehicleLocks(status, 'R1T').state).toBe('unlocked');
  });

  it('is unknown until all four doors have reported, unless something is already unlocked', () => {
    expect(resolveVehicleLocks(null, 'R1S').state).toBe('unknown');
    expect(resolveVehicleLocks({} as VehicleStatus, 'R1T').state).toBe('unknown');
    // A frunk or a single door is not the whole vehicle.
    expect(resolveVehicleLocks({ closure_frunk_locked: true } as VehicleStatus, 'R1S').state).toBe('unknown');
    expect(resolveVehicleLocks({ door_front_left_locked: true } as VehicleStatus, 'R1S').state).toBe('unknown');
    expect(resolveVehicleLocks({ closure_frunk_locked: false } as VehicleStatus, 'R1S').state).toBe('unlocked');
    // All four doors locked is enough when the closures have not reported.
    const doorsOnly = { door_front_left_locked: true, door_front_right_locked: true, door_rear_left_locked: true, door_rear_right_locked: true } as VehicleStatus;
    expect(resolveVehicleLocks(doorsOnly, 'R2').state).toBe('locked');
  });
});
