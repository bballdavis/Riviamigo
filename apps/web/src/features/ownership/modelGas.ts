/** Gas price resolution: stored monthly prices first, then the flat price, the recent average, or a default. */
import type { OwnershipFuelPriceMonth } from '@riviamigo/types';
import { DEFAULT_GAS_USD_PER_GALLON, DEFAULT_PREMIUM_SURCHARGE_USD } from './modelConstants';
import type { GasPriceResolver } from './modelTypes';

/**
 * Stored monthly prices where they exist. Other months use the flat price the
 * user entered, else the average of the latest twelve stored months, else a
 * fixed default.
 */
export function createGasPriceResolver(
  months: OwnershipFuelPriceMonth[],
  flatUsd: number | null,
): GasPriceResolver {
  const stored = new Map(months.map((row) => [row.month.slice(0, 7), row]));
  const recent = months.filter((row) => row.regular_usd != null).slice(-12);
  const average = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const recentRegular = average(recent.map((row) => row.regular_usd as number));
  const surcharges = recent
    .filter((row) => row.premium_usd != null)
    .map((row) => (row.premium_usd as number) - (row.regular_usd as number));
  const surcharge = average(surcharges) ?? DEFAULT_PREMIUM_SURCHARGE_USD;
  const fallbackRegular = flatUsd ?? recentRegular ?? DEFAULT_GAS_USD_PER_GALLON;

  const resolve = ((month: string) => {
    const row = stored.get(month);
    if (row?.regular_usd != null) {
      return {
        regular: row.regular_usd,
        premium: row.premium_usd ?? row.regular_usd + surcharge,
        fromSeries: true,
      };
    }
    return { regular: fallbackRegular, premium: fallbackRegular + surcharge, fromSeries: false };
  }) as GasPriceResolver;
  resolve.fallbackRegular = fallbackRegular;
  return resolve;
}
