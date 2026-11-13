import { describe, expect, it } from 'vitest';
import type { OwnershipResponse } from '@riviamigo/types';
import { item, response } from './testFixtures';
import { buildChartRows } from './OwnershipChart';
import { formToSettings, settingsToForm } from './OwnershipCostsFields';
import {
  buildLedger,
  createGasPriceResolver,
  describeHomePlan,
  enabledComparisonIds,
  formatCents,
  impliedRetention,
  horizonSpan,
  insightSentence,
  ordinal,
  ownRank,
  scheduleTargets,
} from './model';

const now = new Date('2025-10-01T00:00:00Z');
const build = (data = response(), horizon: 'to_date' | 'projected' = 'to_date', enabledIds?: string[]) =>
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

describe('describeHomePlan', () => {
  it('joins time-of-use windows that share a rate, across midnight too', () => {
    const plan = {
      name: 'Home',
      billing_type: 'tou' as const,
      rate: 0.13,
      tou_periods: [
        { label: 'Night 1', start_minute: 0, end_minute: 360, rate: 0 },
        { label: 'Day', start_minute: 360, end_minute: 1200, rate: 0.322499 },
        { label: 'Night 2', start_minute: 1200, end_minute: 1440, rate: 0 },
      ],
    };
    expect(describeHomePlan(plan)).toBe('free 8 PM–6 AM, 32¢ 6 AM–8 PM');
  });

  it('gives a single price for the other plan types', () => {
    const base = { name: 'Home', tou_periods: [] };
    expect(describeHomePlan({ ...base, billing_type: 'per_kwh', rate: 0.14 })).toBe('14¢/kWh');
    expect(describeHomePlan({ ...base, billing_type: 'free', rate: 0 })).toBe('free');
    expect(formatCents(0.019)).toBe('1.9¢');
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

  describe('with an odometer reading', () => {
    // Charging history reaches back to the purchase; drives were only recorded from July.
    const charged = { drive_energy_kwh: 0, charged_kwh: 500, priced_kwh: 500, charging_cost_usd: 60, fast_kwh: 0, fast_priced_kwh: 0, fast_cost_usd: 0 };
    const withOdometer = (odometer_mi: number, settings: Partial<OwnershipResponse['settings']> = {}) => {
      const data = response();
      data.settings = { ...data.settings, ...settings };
      data.usage = {
        ...data.usage,
        tracked_from: '2025-01-01T00:00:00Z',
        odometer_mi,
        months: ['01', '02', '03', '04', '05', '06', '07', '08', '09'].map((month) => ({
          ...charged,
          month: `2025-${month}-01`,
          miles: month >= '07' ? 1_000 : 0,
        })),
      };
      return data;
    };

    it('takes total miles from the odometer and puts the unrecorded ones in the months that fall short', () => {
      const ledger = build(withOdometer(9_000));
      expect(ledger.mileageFromOdometer).toBe(true);
      expect(ledger.milesToDate).toBe(9_000);
      expect(find(ledger, 'own').totals.miles).toBeCloseTo(9_000);
      expect(ledger.avgMonthlyMiles).toBeCloseTo((9_000 / 273) * 30.44);
      // January had charging but no recorded drives; September already beat the average.
      expect(ledger.periods[0]?.miles).toBeGreaterThan(900);
      expect(ledger.periods[8]?.miles).toBe(1_000);
    });

    it('bills the tracked vehicle what its sessions cost and every other vehicle for the same miles', () => {
      const ledger = build(withOdometer(9_000), 'to_date', ['gas_suv', 'other_ev']);
      // Nine months of sessions at $60: no per-mile estimate is added on top.
      expect(find(ledger, 'own').totals.fuel).toBeCloseTo(540);
      // 9,000 mi at 0.3 kWh/mi and the owner's $0.12 per kWh.
      expect(find(ledger, 'other_ev').totals.fuel).toBeCloseTo(9_000 * 0.3 * 0.12);
      expect(find(ledger, 'gas_suv').totals.miles).toBeCloseTo(9_000);
    });

    it('raises a comparison EV by how far the tracked vehicle runs over its own rating', () => {
      // 4,500 kWh over 9,000 mi is 0.5 kWh/mi from the wall, against a rated 0.4.
      const data = { ...withOdometer(9_000), own_rated_kwh_per_mi: 0.4 };
      const ledger = build(data, 'to_date', ['gas_suv', 'other_ev']);
      expect(ledger.ownKwhPerMi).toBeCloseTo(0.5);
      expect(ledger.realWorldFactor).toBeCloseTo(1.25);
      expect(find(ledger, 'other_ev').totals.fuel).toBeCloseTo(9_000 * 0.3 * 1.25 * 0.12);
      // The tracked vehicle still pays what its sessions cost.
      expect(find(ledger, 'own').totals.fuel).toBeCloseTo(540);
    });

    it('bounds the adjustment and skips it without a rating', () => {
      expect(build({ ...withOdometer(9_000), own_rated_kwh_per_mi: 0.1 }).realWorldFactor).toBe(1.5);
      expect(build(withOdometer(9_000)).realWorldFactor).toBe(1);
    });

    it('projects future charging at the cost per odometer mile', () => {
      const ledger = build(withOdometer(9_000), 'projected');
      const own = find(ledger, 'own');
      // $540 over 9,000 mi is 6 cents a mile.
      expect(own.totals.fuel).toBeCloseTo(540 + (own.totals.miles - 9_000) * 0.06);
    });

    it('takes a month the odometer covers from its readings, and efficiency only from whole covered months', () => {
      const data = withOdometer(9_000);
      // Readings start mid-July. August and September continue from the month
      // before, so they are covered whole: 1,500 mi each against 1,000 recorded.
      const odometer: Record<string, [number, number]> = { '07': [6_000, 6_200], '08': [6_200, 7_700], '09': [7_700, 9_000] };
      data.usage.months = data.usage.months.map((row) => {
        const reading = odometer[row.month.slice(5, 7)];
        return reading ? { ...row, odometer_start_mi: reading[0], odometer_end_mi: reading[1] } : row;
      });
      const ledger = build({ ...data, own_rated_kwh_per_mi: 0.3 });
      expect(ledger.periods[7]?.miles).toBeCloseTo(1_500);
      expect(ledger.periods[8]?.miles).toBeCloseTo(1_300);
      expect(find(ledger, 'own').totals.miles).toBeCloseTo(9_000);
      // 1,000 kWh over the 2,800 covered miles.
      expect(ledger.ownKwhPerMi).toBeCloseTo(1_000 / 2_800);
      expect(ledger.realWorldFactor).toBeCloseTo(1_000 / 2_800 / 0.3);
    });

    it('subtracts the odometer reading at purchase', () => {
      const ledger = build(withOdometer(9_000, { purchase_odometer_mi: 3_000 }));
      expect(find(ledger, 'own').totals.miles).toBeCloseTo(6_000);
    });

    it('keeps to recorded drives without a purchase date, or when the odometer is behind them', () => {
      expect(build(withOdometer(9_000, { purchase_date: null })).mileageFromOdometer).toBe(false);
      const behind = build(withOdometer(9_000, { purchase_odometer_mi: 8_000 }));
      expect(behind.mileageFromOdometer).toBe(false);
      expect(find(behind, 'own').totals.miles).toBeCloseTo(3_000);
    });
  });

  it('gives each month its own home and fast rates, and the averages where it had none', () => {
    const data = response();
    data.usage.months[1] = {
      ...data.usage.months[1]!,
      charged_kwh: 600, priced_kwh: 600, charging_cost_usd: 60 + 50, fast_kwh: 100, fast_priced_kwh: 100, fast_cost_usd: 50,
    };
    const ledger = build(data);
    // July: home only, at $60 for 500 kWh.
    expect(ledger.periods[6]).toMatchObject({ homeFromSessions: true, fastFromSessions: false });
    expect(ledger.periods[6]?.homeUsdPerKwh).toBeCloseTo(0.12);
    expect(ledger.periods[6]?.fastUsdPerKwh).toBeCloseTo(0.5);
    // August: its own fast sessions at 50 cents.
    expect(ledger.periods[7]).toMatchObject({ fastFromSessions: true });
    expect(ledger.periods[7]?.fastUsdPerKwh).toBeCloseTo(0.5);
    // Months before tracking use the averages.
    expect(ledger.periods[0]).toMatchObject({ homeFromSessions: false, fastFromSessions: false });
    expect(ledger.periods[0]?.homeUsdPerKwh).toBeCloseTo(ledger.homeUsdPerKwh);
  });

  it('charges an electric comparison vehicle what the tracked vehicle paid per kWh that month', () => {
    const data = response();
    data.usage.months[1] = {
      ...data.usage.months[1]!,
      charged_kwh: 600, priced_kwh: 600, charging_cost_usd: 110, fast_kwh: 100, fast_priced_kwh: 100, fast_cost_usd: 50,
    };
    const ledger = build(data, 'to_date', ['other_ev']);
    const other = find(ledger, 'other_ev');
    // August: $110 over 600 kWh; July: $60 over 500 kWh.
    expect(ledger.periods[7]?.chargingUsdPerKwh).toBeCloseTo(110 / 600);
    expect(other.months[7]?.fuel).toBeCloseTo(1_000 * 0.3 * (110 / 600));
    expect(other.months[6]?.fuel).toBeCloseTo(1_000 * 0.3 * 0.12);
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

  it('builds from a cached response saved before maintenance schedules existed', () => {
    const data = response();
    const strip = <T extends { maintenance?: unknown }>(value: T) => {
      const { maintenance: _dropped, ...rest } = value;
      return rest as T;
    };
    const old = {
      ...data,
      reference_vehicles: data.reference_vehicles.map(strip),
      own_defaults: strip(data.own_defaults),
      class_defaults: { ev: strip(data.class_defaults.ev), hybrid: strip(data.class_defaults.hybrid), gas: strip(data.class_defaults.gas) },
    } as OwnershipResponse;
    const ledger = build(old);
    expect(Number.isFinite(find(ledger, 'own').totals.net)).toBe(true);
    expect(scheduleTargets(old, 'R1S').every((target) => Array.isArray(target.schedule))).toBe(true);
  });

  it('reads a cached response without the fast-charging split as all home charging', () => {
    const data = response();
    data.usage.months = data.usage.months.map(({ fast_kwh: _a, fast_priced_kwh: _b, fast_cost_usd: _c, ...row }) => row) as typeof data.usage.months;
    const ledger = build(data);
    expect(Number.isFinite(find(ledger, 'own').totals.net)).toBe(true);
    expect(ledger.electricityUsdPerKwh).toBeCloseTo(0.12);
  });

  it('prices unpriced home charging at the home rate, not the fast-charging rate', () => {
    const data = response();
    // Each month: 400 kWh at home (100 kWh priced at $0.02), 100 kWh fast-charged at $0.50.
    data.usage.months = data.usage.months.map((row) => ({
      ...row,
      charged_kwh: 500,
      priced_kwh: 200,
      charging_cost_usd: 2 + 50,
      fast_kwh: 100,
      fast_priced_kwh: 100,
      fast_cost_usd: 50,
    }));
    const ledger = build(data);
    expect(ledger.homeUsdPerKwh).toBeCloseTo(0.02);
    expect(ledger.fastUsdPerKwh).toBeCloseTo(0.5);
    expect(ledger.fastShare).toBeCloseTo(0.2);
    // 300 unpriced home kWh at $0.02 each month, not at the fast or blended rate.
    const monthCost = 52 + 300 * 0.02;
    expect(ledger.electricityUsdPerKwh).toBeCloseTo(monthCost / 500);
    const estimatedMiles = (3_000 / 92) * 181;
    expect(find(ledger, 'own').totals.fuel).toBeCloseTo(monthCost * 3 + estimatedMiles * (monthCost / 1_000));
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

  it('posts an item at its mileage or its time interval, whichever comes first', () => {
    const data = response();
    // About 900 mi a month: a 20,000 mi / 6 month item is due on time, twice in the year.
    data.reference_vehicles[1] = {
      ...data.reference_vehicles[1]!,
      default_enabled: true,
      maintenance: [item('filter', 'service', 20_000, 6, 50), item('rotation', 'service', 3_000, 24, 10)],
    };
    const other = find(build(data), 'other_ev');
    const labels = other.months.flatMap((month) => month.oneTime.flatMap((entry) => entry.labels));
    expect(labels.filter((label) => label.startsWith('filter'))).toHaveLength(1);
    // The 3,000 mi rotation falls due by mileage: about 8,900 mi / 3,000 = 2 times.
    expect(labels.join(' ')).toMatch(/rotation/);
    expect(other.totals.service).toBeCloseTo(50 + 2 * 10);
  });

  it('uses a saved schedule over the built-in one, and the tire price on the tracked vehicle', () => {
    const data = response();
    data.settings.tire_set_cost_usd = 2_000;
    const builtIn = scheduleTargets(data, 'R1S');
    expect(builtIn.map((target) => target.key)).toEqual(['own', 'gas_suv', 'other_ev']);
    expect(builtIn[0]?.schedule.find((entry) => entry.category === 'tires')?.cost_usd).toBe(2_000);
    expect(builtIn.every((target) => !target.edited)).toBe(true);

    data.settings.maintenance = { gas_suv: [item('oil', 'oil', 1_000, null, 10)] };
    const gas = find(build(data), 'gas_suv');
    expect(gas.totals.oilCount).toBe(8);
    expect(gas.totals.brakes + gas.totals.tires + gas.totals.service).toBe(0);
    expect(scheduleTargets(data, 'R1S')[1]?.edited).toBe(true);
  });

  it('records each month\'s running and one-time costs per vehicle', () => {
    const ledger = build();
    const gas = find(ledger, 'gas_suv');
    expect(gas.months).toHaveLength(ledger.periods.length);
    const oil = gas.months.flatMap((month) => month.oneTime).filter((item) => item.kind === 'oil');
    expect(oil.reduce((sum, item) => sum + item.count, 0)).toBe(gas.totals.oilCount);
    gas.months.forEach((month, index) => {
      const before = gas.atPeriodEnd[index]?.spent ?? 0;
      const after = gas.atPeriodEnd[index + 1]?.spent ?? 0;
      const oneTime = month.oneTime.reduce((sum, item) => sum + item.usd, 0);
      expect(after - before).toBeCloseTo(month.fuel + month.insurance + oneTime);
    });
  });

  it('keeps spent, net, and the cost categories consistent', () => {
    const ledger = build(response(), 'projected');
    for (const { vehicle, totals } of ledger.vehicles) {
      const running = totals.fuel + totals.oil + totals.brakes + totals.tires + totals.service + totals.insurance;
      expect(totals.spent).toBeCloseTo(vehicle.priceUsd + running);
      expect(totals.net).toBeCloseTo(totals.depreciation + running);
      expect(totals.resaleValue).toBeCloseTo(vehicle.priceUsd * Math.pow(vehicle.costs.annual_retention, 1826 / 365.25));
    }
  });

  it('projects the stored number of years from the purchase date, or five by default', () => {
    expect(build(response(), 'projected').endMs).toBe(Date.UTC(2030, 0, 1));
    const data = response();
    data.settings.projection_years = 2;
    expect(build(data, 'projected').endMs).toBe(Date.UTC(2027, 0, 1));
    // A projection that would end before today still runs through today.
    data.settings.purchase_date = '2023-01-01';
    data.settings.projection_years = 1;
    expect(build(data, 'projected').endMs).toBe(now.getTime());
  });

  it('projects future months and annual service across a longer horizon', () => {
    const ledger = build(response(), 'projected');
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
    expect(insightSentence(build(response(), 'to_date', []), 'So far')).toBeNull();
    expect(insightSentence(build(), 'So far')).toMatch(/^So far, R1S nets out \$[\d,]+ more than the Gas SUV after resale\.$/);
    expect(insightSentence(build(response(), 'projected'), horizonSpan('projected', 5))).toMatch(/^Over 5 years of ownership, /);
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

  it('requires a purchase price when anything else is entered, or always when asked', () => {
    const blank = settingsToForm({ ...base, purchase_price_usd: null, purchase_date: null });
    const dateOnly = formToSettings({ ...blank, purchaseDate: '2025-08-25' }, base, now);
    expect(dateOnly.settings).toBeNull();
    expect(dateOnly.errors).toEqual({ purchasePrice: 'Enter what you paid.' });
    expect(formToSettings(blank, base, now).settings).toMatchObject({ purchase_price_usd: null });
    expect(formToSettings(blank, base, now, { requirePrice: true }).errors).toHaveProperty('purchasePrice');
  });

  it('rejects bad amounts and future dates', () => {
    const form = { ...settingsToForm(base), purchasePrice: 'abc', gasPrice: '0', purchaseDate: '2026-01-01' };
    const result = formToSettings(form, base, now);
    expect(result.settings).toBeNull();
    expect(Object.keys(result.errors).sort()).toEqual(['gasPrice', 'purchaseDate', 'purchasePrice']);
  });
});
