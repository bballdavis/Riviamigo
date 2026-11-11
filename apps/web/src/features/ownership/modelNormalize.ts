/** Fills in fields an older response or cached copy may lack, so the page never reads an undefined list. */
import type { OwnershipMaintenanceItem, OwnershipResponse } from '@riviamigo/types';

/**
 * Fill in fields an older server or an older cached copy of the response may
 * lack, so the page never reads an undefined list. Safe to call repeatedly.
 * A filled-in empty schedule only lasts until the next fetch replaces it.
 */
export function normalizeOwnershipResponse(data: OwnershipResponse): OwnershipResponse {
  const withSchedule = <T extends { maintenance?: OwnershipMaintenanceItem[] }>(value: T): T => ({
    ...value,
    maintenance: Array.isArray(value.maintenance) ? value.maintenance : [],
  });
  const comparisons = data.settings?.comparisons;
  return {
    ...data,
    settings: {
      ...data.settings,
      projection_years: data.settings?.projection_years ?? null,
      comparisons: {
        enabled: comparisons?.enabled ?? null,
        custom: Array.isArray(comparisons?.custom) ? comparisons.custom : [],
      },
      maintenance: data.settings?.maintenance ?? {},
    },
    usage: {
      ...data.usage,
      months: (data.usage?.months ?? []).map((row) => ({
        ...row,
        priced_kwh: row.priced_kwh ?? 0,
        fast_kwh: row.fast_kwh ?? 0,
        fast_priced_kwh: row.fast_priced_kwh ?? 0,
        fast_cost_usd: row.fast_cost_usd ?? 0,
      })),
    },
    reference_vehicles: (data.reference_vehicles ?? []).map(withSchedule),
    own_defaults: withSchedule(data.own_defaults),
    class_defaults: {
      ev: withSchedule(data.class_defaults.ev),
      hybrid: withSchedule(data.class_defaults.hybrid),
      gas: withSchedule(data.class_defaults.gas),
    },
  };
}
