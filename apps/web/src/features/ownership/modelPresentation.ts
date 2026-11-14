/** Presentation helpers: horizon labels, projection years, ranking, money and ordinal formatting, and the insight sentence. */
import { DEFAULT_PROJECTION_YEARS } from './modelConstants';
import type { OwnershipHomePlan } from '@riviamigo/types';
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

/** A per-kWh price in cents under a dollar, for example 1.9¢ or 49¢. */
export function formatCents(usd: number): string {
  if (usd >= 1) return formatUsd(usd, { cents: true });
  const value = usd * 100;
  if (value === 0) return '0¢';
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}¢`;
}

function clockLabel(minute: number): string {
  const hour = Math.floor((minute % 1440) / 60);
  const minutes = minute % 60;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return minutes ? `${display}:${String(minutes).padStart(2, '0')} ${suffix}` : `${display} ${suffix}`;
}

/**
 * A plan in a few words: "free 8 PM–6 AM, 32¢ 6 AM–8 PM" for time of use,
 * otherwise its one price. Windows with the same rate that meet, including
 * across midnight, read as one.
 */
export function describeHomePlan(plan: OwnershipHomePlan): string {
  const price = (rate: number) => (rate === 0 ? 'free' : `${formatCents(rate)}/kWh`);
  switch (plan.billing_type) {
    case 'free':
      return 'free';
    case 'flat':
      return `${formatUsd(plan.rate, { cents: true })} a session`;
    case 'per_minute':
      return `${formatCents(plan.rate)} a minute`;
    case 'per_kwh':
      return price(plan.rate);
    case 'tou': {
      const periods = [...plan.tou_periods].sort((a, b) => a.start_minute - b.start_minute);
      if (!periods.length) return price(plan.rate);
      const merged: Array<{ start: number; end: number; rate: number }> = [];
      for (const period of periods) {
        const last = merged[merged.length - 1];
        if (last && last.rate === period.rate && last.end === period.start_minute) last.end = period.end_minute;
        else merged.push({ start: period.start_minute, end: period.end_minute, rate: period.rate });
      }
      const first = merged[0];
      const last = merged[merged.length - 1];
      if (merged.length > 1 && first && last && first.start === 0 && last.end === 1440 && first.rate === last.rate) {
        merged.pop();
        first.start = last.start;
      }
      return merged
        .map((window) => `${window.rate === 0 ? 'free' : formatCents(window.rate)} ${clockLabel(window.start)}–${clockLabel(window.end)}`)
        .join(', ');
    }
    default:
      return price(plan.rate);
  }
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
