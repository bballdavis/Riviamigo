import { describe, expect, it } from 'vitest';
import type { OwnershipCostAssumptions, OwnershipResponse } from '@riviamigo/types';
import { buildChartRows } from './OwnershipChart';
import { formToSettings, settingsToForm } from './OwnershipCostsFields';
import {
  buildLedger,
  createGasPriceResolver,
  enabledComparisonIds,
  impliedRetention,
  insightSentence,
  ordinal,
  ownRank,
} from './model';

const costs = (overrides: Partial<OwnershipCostAssumptions> = {}): OwnershipCostAssumptions => ({
  annual_retention: 0.85,
  oil_interval_mi: null,
  oil_cost_usd: null,
  brake_interval_mi: 100_000,
  brake_cost_usd: 800,
  tire_interval_mi: 30_000,
  tire_cost_usd: 1_600,
  annual_service_usd: 200,
  insurance_monthly_usd: 100,
  ...overrides,
});

const gasCosts = costs({ oil_interval_mi: 5_000, oil_cost_usd: 100, brake_interval_mi: 40_000 });

function response(overrides: Partial<OwnershipResponse> = {}): OwnershipResponse {
  return {
    vehicle_id: 'vehicle-1',
    can_edit: true,
    settings: {
      purchase_price_usd: 80_000,
      purchase_date: '2025-01-01',
      resale_value_usd: null,
      insurance_monthly_usd: null,
      tire_set_cost_usd: null,
      gas_price_usd_per_gallon: null,
      comparisons: { enabled: null, custom: [] },
    },
    usage: {
      months: [
        { month: '2025-07-01', miles: 1_000, drive_energy_kwh: 420, charged_kwh: 500, priced_kwh: 500, charging_cost_usd: 60 },
        { month: '2025-08-01', miles: 1_000, drive_energy_kwh: 420, charged_kwh: 500, priced_kwh: 500, charging_cost_usd: 60 },
        { month: '2025-09-01', miles: 1_000, drive_energy_kwh: 420, charged_kwh: 500, priced_kwh: 500, charging_cost_usd: 60 },
      ],
      tracked_from: '2025-07-01T00:00:00Z',
      tracked_to: '2025-09-30T00:00:00Z',
      odometer_mi: 9_000,
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
    ...overrides,
  } as OwnershipResponse;
}

const now = new Date('2025-10-01T00:00:00Z');
const build = (data = response(), horizon: 'to_date' | '5y' | '10y' = 'to_date', enabledIds?: string[]) =>
  buildLedger(data, { horizon, now, ownLabel: 'R1S', ...(enabledIds ? { enabledIds } : {}) });
const find = (ledger: ReturnType<typeof build>, id: string) => {
  const entry = ledger.vehicles.find((candidate) => candidate.vehicle.id === id);
  if (!entry) throw new Error(`missing ${id}`);
  return entry;
};

describe('createGasPriceResolver', () => {
  const months = [
    { month: '2025-01-01', regular_usd: 3, premium_usd: 3.9 },
    { month: '2025-02-01', regular_usd: 3.2, premium_usd: null },
  ];

  it('uses the stored month and fills a missing premium price from the usual surcharge', () => {
    const resolve = createGasPriceResolver(months, null);
    expect(resolve('2025-01')).toEqual({ regular: 3, premium: 3.9, fromSeries: true });
    expect(resolve('2025-02').premium).toBeCloseTo(4.1);
  });

  it('falls back to the flat price, then the recent average, then the default', () => {
    expect(createGasPriceResolver(months, 5)('2030-01')).toMatchObject({ regular: 5, fromSeries: false });
    expect(createGasPriceResolver(months, null)('2030-01').regular).toBeCloseTo(3.1);
    expect(createGasPriceResolver([], null)('2030-01').regular).toBe(3.5);
  });
});

describe('buildLedger', () => {
  it('starts every vehicle at its purchase price', () => {
    const ledger = build();
    expect(ledger.startMs).toBe(Date.UTC(2025, 0, 1));
    expect(find(ledger, 'own').points[0]).toMatchObject({ spent: 80_000, net: 0 });
    expect(find(ledger, 'gas_suv').points[0]).toMatchObject({ spent: 50_000, net: 0 });
  });

  it('fills months before tracking from the recorded average and marks them estimated', () => {
    const ledger = build();
    expect(ledger.periods).toHaveLength(9);
    expect(ledger.periods.slice(0, 6).every((period) => period.kind === 'estimated')).toBe(true);
    expect(ledger.periods.slice(6).every((period) => period.kind === 'actual')).toBe(true);
    expect(ledger.estimatedUntilMs).toBe(Date.UTC(2025, 6, 1));
    expect(ledger.projectedFromMs).toBeNull();
    // 3,000 mi over 92 tracked days.
    const daily = 3_000 / 92;
    expect(ledger.periods[0]?.miles).toBeCloseTo(daily * 31);
    expect(ledger.periods[6]?.miles).toBe(1_000);
    expect(find(ledger, 'own').totals.miles).toBeCloseTo(3_000 + daily * 181);
  });

  it('charges the tracked vehicle its recorded charging cost and estimates the rest per mile', () => {
    const ledger = build();
    const own = find(ledger, 'own');
    const estimatedMiles = (3_000 / 92) * 181;
    expect(ledger.electricityUsdPerKwh).toBeCloseTo(0.12);
    expect(ledger.electricityRateAssumed).toBe(false);
    expect(own.totals.fuel).toBeCloseTo(180 + estimatedMiles * 0.06);
  });

  it('charges energy from sessions without a price at the rate of the priced ones', () => {
    const data = response();
    const first = data.usage.months[0];
    if (!first) throw new Error('missing month');
    // Half of July's energy has no price: the recorded cost covers 250 kWh.
    first.priced_kwh = 250;
    first.charging_cost_usd = 30;
    const ledger = build(data);
    expect(ledger.electricityUsdPerKwh).toBeCloseTo(0.12);
    const estimatedMiles = (3_000 / 92) * 181;
    expect(find(ledger, 'own').totals.fuel).toBeCloseTo(180 + estimatedMiles * 0.06);
  });

  it('ends on the entered resale value, even soon after purchase', () => {
    const data = response();
    data.settings.purchase_date = '2025-08-01';
    data.settings.resale_value_usd = 70_000;
    const own = find(build(data), 'own');
    expect(own.totals.resaleValue).toBeCloseTo(70_000);
    expect(own.points[0]).toMatchObject({ spent: 80_000, net: 0 });

    data.settings.resale_value_usd = 0;
    expect(find(build(data), 'own').totals.resaleValue).toBeCloseTo(0);
  });

  it('prices gas by month, using stored prices where they exist', () => {
    const ledger = build();
    const gas = find(ledger, 'gas_suv');
    // Stored months average $3.50, which also fills the months with no data.
    const estimatedMiles = (3_000 / 92) * 181;
    const expected = (1_000 / 20) * 3 + (1_000 / 20) * 4 + (1_000 / 20) * 3.5 + (estimatedMiles / 20) * 3.5;
    expect(gas.totals.fuel).toBeCloseTo(expected);
    expect(ledger.periods[6]).toMatchObject({ gasRegularUsd: 3, gasFromSeries: true });
    expect(ledger.periods[8]).toMatchObject({ gasRegularUsd: 3.5, gasFromSeries: false });
  });

  it('posts oil changes as one-time jumps when the mileage falls due', () => {
    const ledger = build();
    const gas = find(ledger, 'gas_suv');
    // About 8,900 mi driven: one 5,000 mi oil change, none for the EVs.
    expect(gas.totals.oilCount).toBe(1);
    expect(gas.totals.oil).toBe(100);
    expect(find(ledger, 'own').totals.oilCount).toBe(0);
    const jump = gas.points.findIndex((point, index) => index > 0 && point.t === gas.points[index - 1]?.t);
    expect(jump).toBeGreaterThan(0);
    expect((gas.points[jump]?.spent ?? 0) - (gas.points[jump - 1]?.spent ?? 0)).toBe(100);
  });

  it('keeps spent, net, and the cost categories consistent', () => {
    const ledger = build(response(), '5y');
    for (const { vehicle, totals } of ledger.vehicles) {
      const running = totals.fuel + totals.oil + totals.brakes + totals.tires + totals.service + totals.insurance;
      expect(totals.spent).toBeCloseTo(vehicle.priceUsd + running);
      expect(totals.net).toBeCloseTo(totals.depreciation + running);
      expect(totals.resaleValue).toBeCloseTo(vehicle.priceUsd * Math.pow(vehicle.costs.annual_retention, 1826 / 365.25));
    }
  });

  it('projects future months and annual service across a longer horizon', () => {
    const ledger = build(response(), '5y');
    expect(ledger.endMs).toBe(Date.UTC(2030, 0, 1));
    expect(ledger.projectedFromMs).toBe(now.getTime());
    expect(ledger.periods).toHaveLength(60);
    expect(ledger.periods[59]?.kind).toBe('projected');
    expect(find(ledger, 'own').totals.service).toBe(5 * 200);
    expect(find(ledger, 'own').totals.insurance).toBeCloseTo(100 * (1826 / 30.44));
  });

  it('uses the user figures over the defaults', () => {
    const data = response();
    data.settings.resale_value_usd = 64_000;
    data.settings.insurance_monthly_usd = 250;
    data.settings.gas_price_usd_per_gallon = 6;
    const ledger = build(data);
    const own = find(ledger, 'own');
    expect(own.totals.resaleValue).toBeCloseTo(64_000, -2);
    expect(own.vehicle.costs.insurance_monthly_usd).toBe(250);
    expect(ledger.periods[0]?.gasRegularUsd).toBe(6);
    expect(ledger.periods[6]?.gasRegularUsd).toBe(3);
  });

  it('starts at the first recorded day when no purchase date is set', () => {
    const data = response();
    data.settings.purchase_date = null;
    const ledger = build(data);
    expect(ledger.startAssumed).toBe(true);
    expect(ledger.startMs).toBe(Date.UTC(2025, 6, 1));
    expect(ledger.estimatedUntilMs).toBeNull();
    expect(ledger.periods).toHaveLength(3);
  });

  it('assumes typical driving and electricity when nothing is recorded', () => {
    const data = response();
    data.usage = { months: [], tracked_from: null, tracked_to: null, odometer_mi: null };
    const ledger = build(data);
    expect(ledger.mileageAssumed).toBe(true);
    expect(ledger.electricityRateAssumed).toBe(true);
    expect(ledger.avgMonthlyMiles).toBeCloseTo(1_000);
    expect(ledger.electricityUsdPerKwh).toBe(0.16);
  });

  it('includes only the enabled comparison vehicles', () => {
    expect(build().vehicles.map((entry) => entry.vehicle.id)).toEqual(['own', 'gas_suv']);
    expect(build(response(), 'to_date', ['other_ev']).vehicles.map((entry) => entry.vehicle.id)).toEqual([
      'own',
      'other_ev',
    ]);
  });
});

describe('comparison selection', () => {
  it('uses reference defaults until a selection is stored, and turns added vehicles on', () => {
    const data = response();
    data.settings.comparisons.custom = [
      { id: 'custom_1', label: 'Mine', powertrain: 'gas', price_usd: 30_000, mpg: 30, kwh_per_mi: null, premium_fuel: false },
    ];
    expect(enabledComparisonIds(data)).toEqual(['gas_suv', 'custom_1']);
    data.settings.comparisons.enabled = ['other_ev'];
    expect(enabledComparisonIds(data)).toEqual(['other_ev']);
  });
});

describe('presentation helpers', () => {
  it('ranks the tracked vehicle by net cost', () => {
    const ledger = build(response(), 'to_date', ['gas_suv', 'other_ev']);
    const own = find(ledger, 'own');
    const cheaper = ledger.vehicles.filter((entry) => entry.totals.net < own.totals.net).length;
    expect(ownRank(ledger)).toEqual({ rank: cheaper + 1, of: 3 });
  });

  it('describes the gap to the compared vehicles, or nothing when none are on', () => {
    expect(insightSentence(build(response(), 'to_date', []), 'To date')).toBeNull();
    expect(insightSentence(build(), 'To date')).toMatch(/^So far, R1S nets out \$[\d,]+ more than the Gas SUV after resale\.$/);
    expect(insightSentence(build(response(), '5y'), '5 years')).toMatch(/^Over 5 years, /);
  });

  it('formats ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st']);
  });

  it('derives retention from a resale value and ignores unusable inputs', () => {
    expect(impliedRetention(100, 81, 2)).toBeCloseTo(0.9);
    expect(impliedRetention(100, 81, 0.1)).toBeNull();
    expect(impliedRetention(0, 81, 2)).toBeNull();
    expect(impliedRetention(100, 1, 2)).toBe(0.5);
  });
});

describe('buildChartRows', () => {
  it('emits a start row and two rows per month, stepping at one-time costs', () => {
    const ledger = build();
    const rows = buildChartRows(ledger, 'spent');
    expect(rows).toHaveLength(1 + ledger.periods.length * 2);
    expect(rows[0]).toMatchObject({ t: ledger.startMs, own: 80_000, gas_suv: 50_000 });
    const gas = find(ledger, 'gas_suv');
    expect(rows[rows.length - 1]?.gas_suv).toBeCloseTo(gas.totals.spent);
    const steps = rows.filter((row, index) => index > 0 && row.t === rows[index - 1]?.t && row.gas_suv !== rows[index - 1]?.gas_suv);
    expect(steps.length).toBeGreaterThan(0);
  });
});

describe('ownership cost form', () => {
  const base = response().settings;

  it('round-trips stored settings and clears blank fields', () => {
    const form = settingsToForm({ ...base, resale_value_usd: 60_000 });
    expect(form).toMatchObject({ purchasePrice: '80000', purchaseDate: '2025-01-01', resaleValue: '60000', gasPrice: '' });
    const result = formToSettings({ ...form, purchasePrice: '$84,500', resaleValue: '' }, base, now);
    expect(result.errors).toEqual({});
    expect(result.settings).toMatchObject({ purchase_price_usd: 84_500, resale_value_usd: null, comparisons: base.comparisons });
  });

  it('rejects bad amounts and future dates', () => {
    const form = { ...settingsToForm(base), purchasePrice: 'abc', gasPrice: '0', purchaseDate: '2026-01-01' };
    const result = formToSettings(form, base, now);
    expect(result.settings).toBeNull();
    expect(Object.keys(result.errors).sort()).toEqual(['gasPrice', 'purchaseDate', 'purchasePrice']);
  });
});
