/** Presentation helpers: horizon labels, projection years, ranking, money and ordinal formatting, and the insight sentence. */
import { DEFAULT_PROJECTION_YEARS } from './modelConstants';
import type { Horizon, Ledger, VehicleLedger } from './modelTypes';

export function projectionYearsOf(settings: { projection_years: number | null }): number {
  return settings.projection_years ?? DEFAULT_PROJECTION_YEARS;
}

/** How the span reads in sentences: "So far" for to date, "Over 5 years" when projected. */
export function horizonSpan(horizon: Horizon, years: number): string {
  return horizon === 'to_date' ? 'So far' : `Over ${years} year${years === 1 ? '' : 's'} of ownership`;
}

/** 1-based position of the tracked vehicle by net cost, lowest first. */
export function ownRank(ledger: Ledger): { rank: number; of: number } {
  const own = ledger.vehicles.find((entry) => entry.vehicle.isOwn);
  const cheaper = ledger.vehicles.filter(
    (entry) => own && !entry.vehicle.isOwn && entry.totals.net < own.totals.net,
  ).length;
  return { rank: cheaper + 1, of: ledger.vehicles.length };
}

export function formatUsd(value: number, options: { cents?: boolean } = {}): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: options.cents ? 2 : 0,
    maximumFractionDigits: options.cents ? 2 : 0,
  }).format(value);
}

export function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${suffix}`;
}

/** One sentence placing the tracked vehicle against the cheapest and dearest alternatives. */
export function insightSentence(ledger: Ledger, span: string): string | null {
  const own = ledger.vehicles.find((entry) => entry.vehicle.isOwn);
  const others = ledger.vehicles.filter((entry) => !entry.vehicle.isOwn);
  if (!own || others.length === 0) return null;
  const sorted = [...others].sort((a, b) => a.totals.net - b.totals.net);
  const describe = (entry: VehicleLedger) => {
    const difference = own.totals.net - entry.totals.net;
    const amount = formatUsd(Math.abs(difference));
    return difference > 0
      ? `${amount} more than the ${entry.vehicle.label}`
      : `${amount} less than the ${entry.vehicle.label}`;
  };
  const cheapest = sorted[0] as VehicleLedger;
  const dearest = sorted[sorted.length - 1] as VehicleLedger;
  const parts = cheapest === dearest ? [describe(cheapest)] : [describe(dearest), describe(cheapest)];
  return `${span}, ${own.vehicle.label} nets out ${parts.join(' and ')} after resale.`;
}
