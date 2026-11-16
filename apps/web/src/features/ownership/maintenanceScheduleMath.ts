/** Maintenance schedule math and wording: how often an item falls due, when it next does, and how its interval reads. */
import type { OwnershipMaintenanceItem } from '@riviamigo/types';

/** How many times a year an item falls due at the given monthly mileage. */
export function timesPerYear(item: OwnershipMaintenanceItem, milesPerMonth: number): number {
  const byMiles = item.interval_mi ? (milesPerMonth * 12) / item.interval_mi : 0;
  const byTime = item.interval_months ? 12 / item.interval_months : 0;
  // Whichever comes first sets the pace.
  return Math.max(byMiles, byTime);
}

const MONTH_MS = 30.44 * 86_400_000;

/**
 * How many times an item has fallen due since the purchase and when it is next
 * due, at the owner's average monthly mileage. The Ownership page counts only
 * what has fallen due, so this explains why an edit may not move its totals yet.
 */
export function dueSoFarText(
  item: OwnershipMaintenanceItem,
  milesPerMonth: number,
  startMs: number,
  nowMs: number,
): string {
  const byMiles = item.interval_mi && milesPerMonth > 0 ? item.interval_mi / milesPerMonth : Number.POSITIVE_INFINITY;
  const byTime = item.interval_months ?? Number.POSITIVE_INFINITY;
  const every = Math.min(byMiles, byTime);
  if (!Number.isFinite(every) || every <= 0) return 'Not due at your mileage';
  const elapsed = Math.max(0, (nowMs - startMs) / MONTH_MS);
  const done = Math.floor(elapsed / every);
  const next = new Date(startMs + (done + 1) * every * MONTH_MS).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${done === 0 ? 'Not due yet' : `Due ${done}× so far`}, next around ${next}`;
}

export function describeInterval(item: OwnershipMaintenanceItem): string {
  const miles = item.interval_mi ? `${Math.round(item.interval_mi).toLocaleString('en-US')} mi` : null;
  const months = item.interval_months
    ? item.interval_months % 12 === 0
      ? `${item.interval_months / 12} yr`
      : `${item.interval_months} mo`
    : null;
  return miles && months ? `${miles} or ${months}` : (miles ?? months ?? '');
}
