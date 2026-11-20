/**
 * Where the Vehicle Overview's vehicle sits in its panel.
 *
 * The vehicle picture, its tire labels and its lock icons are one unit: a
 * frame the size of the picture, with every label placed in percent of it.
 * The unit's outermost parts are the two end badges, the rear gate on the
 * left and the frunk on the right, so those two decide where the unit goes.
 */

/** Horizontal centers of the two end badges, in percent of the frame's width. */
export interface VehicleEndBadges {
  rearPct: number;
  frontPct: number;
}

/** Fits Rivian's R1 pictures and every packaged fallback picture. */
export const SHARED_END_BADGES: VehicleEndBadges = { rearPct: 4, frontPct: 102 };

/**
 * Rivian's own R2 picture has more empty canvas behind the tailgate than the
 * R1 pictures, so the rear badge moves in to sit as close to the vehicle as
 * the frunk badge does.
 */
export const R2_PICTURE_END_BADGES: VehicleEndBadges = { rearPct: 8.8, frontPct: 102 };

/** Widths of the two badge sizes, in rem. They match the badges' size classes. */
export const LARGE_END_BADGE_REM = 2.25;
export const SMALL_END_BADGE_REM = 1.5;

/** The point of the frame, in percent of its width, midway between the two end badges. */
export function endBadgeMidpointPct(badges: VehicleEndBadges): number {
  return round((badges.rearPct + badges.frontPct) / 2);
}

/**
 * The `transform` that centers the unit in its panel: the rear badge's outer
 * edge ends up as far from the panel's left side as the frunk badge's outer
 * edge is from its right side.
 *
 * The frame itself is centered by its parent, so this is the distance from
 * the frame's middle to the middle of the two badges' outer edges. Percent
 * resolves against the frame's own width; the badges do not scale with it,
 * so a size difference between them is corrected in rem.
 */
export function resolveVehicleUnitTransform(
  badges: VehicleEndBadges,
  rearBadgeRem: number,
  frontBadgeRem: number,
): string {
  const percent = round(50 - (badges.rearPct + badges.frontPct) / 2);
  const rem = round((rearBadgeRem - frontBadgeRem) / 4);
  if (rem === 0) return `translateX(${percent}%)`;
  return `translateX(calc(${percent}% ${rem < 0 ? '-' : '+'} ${Math.abs(rem)}rem))`;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
