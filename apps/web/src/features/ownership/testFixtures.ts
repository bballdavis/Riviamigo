import type { OwnershipCostAssumptions, OwnershipResponse } from '@riviamigo/types';

/** Shared Ownership test data: a tracked EV, one gas and one electric comparison. */
export type Item = OwnershipCostAssumptions['maintenance'][number];
export const item = (
  id: string,
  category: Item['category'],
  interval_mi: number | null,
  interval_months: number | null,
  cost_usd: number,
): Item => ({ id, label: id, category, interval_mi, interval_months, cost_usd });

const evSchedule: Item[] = [
  item('service', 'service', null, 12, 200),
  item('brake_pads', 'brakes', 100_000, null, 800),
  item('tires', 'tires', 30_000, null, 1_600),
];

export const costs = (overrides: Partial<OwnershipCostAssumptions> = {}): OwnershipCostAssumptions => ({
  annual_retention: 0.85,
  insurance_monthly_usd: 100,
  maintenance: evSchedule,
  ...overrides,
});

export const gasCosts = costs({
  maintenance: [
    item('oil', 'oil', 5_000, null, 100),
    item('service', 'service', null, 12, 200),
    item('brake_pads', 'brakes', 40_000, null, 800),
    item('tires', 'tires', 30_000, null, 1_600),
  ],
});

export function response(overrides: Partial<OwnershipResponse> = {}): OwnershipResponse {
  return {
    vehicle_id: 'vehicle-1',
    can_edit: true,
    settings: {
      purchase_price_usd: 80_000,
      purchase_date: '2025-01-01',
      purchase_odometer_mi: null,
      resale_value_usd: null,
      insurance_monthly_usd: null,
      tire_set_cost_usd: null,
      gas_price_usd_per_gallon: null,
      projection_years: null,
      comparisons: { enabled: null, custom: [] },
    },
    usage: {
      months: [
        { month: '2025-07-01', miles: 1_000, drive_energy_kwh: 420, charged_kwh: 500, priced_kwh: 500, charging_cost_usd: 60, fast_kwh: 0, fast_priced_kwh: 0, fast_cost_usd: 0 },
        { month: '2025-08-01', miles: 1_000, drive_energy_kwh: 420, charged_kwh: 500, priced_kwh: 500, charging_cost_usd: 60, fast_kwh: 0, fast_priced_kwh: 0, fast_cost_usd: 0 },
        { month: '2025-09-01', miles: 1_000, drive_energy_kwh: 420, charged_kwh: 500, priced_kwh: 500, charging_cost_usd: 60, fast_kwh: 0, fast_priced_kwh: 0, fast_cost_usd: 0 },
      ],
      tracked_from: '2025-07-01T00:00:00Z',
      tracked_to: '2025-09-30T00:00:00Z',
      // No odometer reading: miles come from the recorded drives alone.
      odometer_mi: null,
    },
    fuel_prices: {
      connection_enabled: true,
      months: [
        { month: '2025-07-01', regular_usd: 3, premium_usd: 4 },
        { month: '2025-08-01', regular_usd: 4, premium_usd: 5 },
      ],
      last_updated_at: '2025-10-01T00:00:00Z',
      refresh_failed: false,
    },
    vehicle_lookup_enabled: true,
    reference_vehicles: [
      {
        id: 'gas_suv', label: 'Gas SUV', powertrain: 'gas', price_usd: 50_000, mpg: 20, kwh_per_mi: null,
        premium_fuel: false, default_enabled: true, ...gasCosts,
      },
      {
        id: 'other_ev', label: 'Other EV', powertrain: 'ev', price_usd: 60_000, mpg: null, kwh_per_mi: 0.3,
        premium_fuel: false, default_enabled: false, ...costs(),
      },
    ],
    class_defaults: { ev: costs(), hybrid: gasCosts, gas: gasCosts },
    own_defaults: costs(),
    own_rated_kwh_per_mi: null,
    home_plan: null,
    ...overrides,
  } as OwnershipResponse;
}
