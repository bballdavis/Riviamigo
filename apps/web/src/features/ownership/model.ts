/**
 * Ownership cost ledger.
 *
 * Every compared vehicle is "driven" the same miles as the tracked vehicle,
 * period by period from the purchase date. Fuel or charging accrues with the
 * miles of each month; oil changes, brakes, tires and annual service post as
 * one-time jumps when they fall due. Months before tracking began and months
 * after today are filled from the recorded daily average.
 *
 * Pure and deterministic: `now` is always passed in.
 */
import type {
  OwnershipCostAssumptions,
  OwnershipCustomVehicle,
  OwnershipFuelPriceMonth,
  OwnershipPowertrain,
  OwnershipResponse,
} from '@riviamigo/types';

export type Horizon = 'to_date' | 'projected';

export const HORIZONS: Array<{ value: Horizon; label: string }> = [
  { value: 'to_date', label: 'To date' },
  { value: 'projected', label: 'Projected' },
];

/** Years of ownership the Projected view covers when none is stored. */
export const DEFAULT_PROJECTION_YEARS = 5;
export const MAX_PROJECTION_YEARS = 20;

export function projectionYearsOf(settings: { projection_years: number | null }): number {
  return settings.projection_years ?? DEFAULT_PROJECTION_YEARS;
}

/** How the span reads in sentences: "So far" for to date, "Over 5 years" when projected. */
export function horizonSpan(horizon: Horizon, years: number): string {
  return horizon === 'to_date' ? 'So far' : `Over ${years} year${years === 1 ? '' : 's'} of ownership`;
}

export const OWN_VEHICLE_ID = 'own';

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;
const DAYS_PER_MONTH = 30.44;
/** Used only until a vehicle has recorded any driving. */
export const DEFAULT_DAILY_MILES = 1000 / DAYS_PER_MONTH;
/** Used for reference EVs when no charging cost has been recorded. */
export const DEFAULT_ELECTRICITY_USD_PER_KWH = 0.16;
/** Typical U.S. DC fast-charging price, used only when no fast session has a price. */
export const DEFAULT_FAST_CHARGING_USD_PER_KWH = 0.45;
/** Used when neither stored prices nor a flat price are available. */
export const DEFAULT_GAS_USD_PER_GALLON = 3.5;
export const DEFAULT_PREMIUM_SURCHARGE_USD = 0.8;
const DEFAULT_OWN_KWH_PER_MI = 0.42;

export interface LedgerVehicle {
  id: string;
  label: string;
  powertrain: OwnershipPowertrain;
  isOwn: boolean;
  isCustom: boolean;
  priceUsd: number;
  mpg: number | null;
  kwhPerMi: number | null;
  premiumFuel: boolean;
  costs: OwnershipCostAssumptions;
  /** A value the owner entered: the resale curve passes through it. */
  resaleAnchor?: { ms: number; valueUsd: number } | null;
}

export type PeriodKind = 'estimated' | 'actual' | 'projected';

export interface LedgerPeriod {
  /** Period bounds in epoch milliseconds, clipped to the ledger window. */
  startMs: number;
  endMs: number;
  kind: PeriodKind;
  miles: number;
  gasRegularUsd: number;
  gasPremiumUsd: number;
  /** False when the month's gas price is a flat or averaged stand-in. */
  gasFromSeries: boolean;
}

export interface LedgerPoint {
  t: number;
  spent: number;
  net: number;
}

export interface LedgerTotals {
  miles: number;
  depreciation: number;
  fuel: number;
  oil: number;
  oilCount: number;
  brakes: number;
  brakeCount: number;
  tires: number;
  tireCount: number;
  service: number;
  insurance: number;
  /** Purchase price plus every running cost. */
  spent: number;
  /** Money spent minus what the vehicle would sell for. */
  net: number;
  resaleValue: number;
  netPerMile: number | null;
}

export type OneTimeKind = 'oil' | 'brakes' | 'tires' | 'service';

/** What one vehicle spent in one period. */
export interface LedgerMonth {
  fuel: number;
  insurance: number;
  /** One-time costs that fell due in the period, in a fixed order. */
  oneTime: Array<{ kind: OneTimeKind; count: number; usd: number }>;
}

export interface VehicleLedger {
  vehicle: LedgerVehicle;
  /** One entry per period, aligned with `Ledger.periods`. */
  months: LedgerMonth[];
  /** Polyline, including the vertical jumps of one-time costs. */
  points: LedgerPoint[];
  /** Value at the purchase date (index 0) and at the end of each period. */
  atPeriodEnd: LedgerPoint[];
  totals: LedgerTotals;
}

export interface Ledger {
  startMs: number;
  endMs: number;
  nowMs: number;
  /** End of the estimated run-up before tracking began, when there is one. */
  estimatedUntilMs: number | null;
  /** Start of the projection, when the horizon reaches past today. */
  projectedFromMs: number | null;
  periods: LedgerPeriod[];
  vehicles: VehicleLedger[];
  avgMonthlyMiles: number;
  /** True when no driving has been recorded and a typical mileage is assumed. */
  mileageAssumed: boolean;
  electricityUsdPerKwh: number;
  /** What home and other AC charging costs you per kWh. */
  homeUsdPerKwh: number;
  /** What DC fast charging costs you per kWh. */
  fastUsdPerKwh: number;
  /** Share of recorded charging energy from DC fast charging, 0 to 1. */
  fastShare: number;
  /** True when no charging cost has been recorded to derive the rate from. */
  electricityRateAssumed: boolean;
  /** True when the ledger starts at first tracking because no purchase date is set. */
  startAssumed: boolean;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Parse a `YYYY-MM-DD` calendar date as UTC midnight. */
export function parseDay(value: string): number {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function monthStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function nextMonth(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function addYears(ms: number, years: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate());
}

function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// ---------------------------------------------------------------------------
// Gas prices
// ---------------------------------------------------------------------------

export interface GasPriceResolver {
  (month: string): { regular: number; premium: number; fromSeries: boolean };
  /** What a month without stored data falls back to. */
  fallbackRegular: number;
}

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

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/** Annual retention implied by what the vehicle is worth today. */
export function impliedRetention(
  priceUsd: number,
  resaleUsd: number,
  yearsOwned: number,
): number | null {
  if (priceUsd <= 0 || resaleUsd <= 0 || yearsOwned < 0.25) return null;
  const retention = Math.pow(resaleUsd / priceUsd, 1 / yearsOwned);
  return Math.min(0.99, Math.max(0.5, retention));
}

export function isComparisonEnabled(data: OwnershipResponse, id: string): boolean {
  const enabled = data.settings.comparisons.enabled;
  if (enabled) return enabled.includes(id);
  const reference = data.reference_vehicles.find((vehicle) => vehicle.id === id);
  // A vehicle the user added is on until they turn it off.
  return reference ? reference.default_enabled : true;
}

/** Ids currently enabled, in a form ready to store. */
export function enabledComparisonIds(data: OwnershipResponse): string[] {
  return [
    ...data.reference_vehicles.map((vehicle) => vehicle.id),
    ...data.settings.comparisons.custom.map((vehicle) => vehicle.id),
  ].filter((id) => isComparisonEnabled(data, id));
}

function customVehicle(
  vehicle: OwnershipCustomVehicle,
  defaults: OwnershipCostAssumptions,
): LedgerVehicle {
  return {
    id: vehicle.id,
    label: vehicle.label,
    powertrain: vehicle.powertrain,
    isOwn: false,
    isCustom: true,
    priceUsd: vehicle.price_usd,
    mpg: vehicle.mpg,
    kwhPerMi: vehicle.kwh_per_mi,
    premiumFuel: vehicle.premium_fuel,
    costs: defaults,
  };
}

/** Every vehicle that can be compared, in display order, own vehicle excluded. */
export function comparisonVehicles(data: OwnershipResponse): LedgerVehicle[] {
  const references: LedgerVehicle[] = data.reference_vehicles.map((vehicle) => ({
    id: vehicle.id,
    label: vehicle.label,
    powertrain: vehicle.powertrain,
    isOwn: false,
    isCustom: false,
    priceUsd: vehicle.price_usd,
    mpg: vehicle.mpg,
    kwhPerMi: vehicle.kwh_per_mi,
    premiumFuel: vehicle.premium_fuel,
    costs: vehicle,
  }));
  const custom = data.settings.comparisons.custom.map((vehicle) =>
    customVehicle(vehicle, data.class_defaults[vehicle.powertrain]),
  );
  return [...references, ...custom];
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface BuildLedgerOptions {
  horizon: Horizon;
  now: Date;
  ownLabel: string;
  /** Years from the purchase date the Projected view covers. Defaults to the stored setting. */
  projectionYears?: number;
  /** Comparison vehicle ids to include. Defaults to the stored selection. */
  enabledIds?: string[];
}

export function buildLedger(data: OwnershipResponse, options: BuildLedgerOptions): Ledger {
  const { settings, usage } = data;
  const nowMs = options.now.getTime();
  const trackedFromMs = usage.tracked_from ? Date.parse(usage.tracked_from) : nowMs;
  const purchaseMs = settings.purchase_date ? parseDay(settings.purchase_date) : null;
  const startMs = Math.min(purchaseMs ?? trackedFromMs, nowMs);
  const horizonYears =
    options.horizon === 'projected' ? (options.projectionYears ?? projectionYearsOf(settings)) : 0;
  const endMs = horizonYears ? Math.max(addYears(startMs, horizonYears), nowMs) : nowMs;

  // Averages from everything recorded so far.
  const startMonth = monthKey(startMs);
  const recorded = usage.months.filter((row) => row.month.slice(0, 7) >= startMonth);
  const trackedMiles = recorded.reduce((sum, row) => sum + row.miles, 0);
  // Home and fast charging are priced apart: a fast session can cost ten times
  // a night at home, so one average would bill home energy at fast-charge rates.
  // A session without a price is charged at the owner's own rate for its kind.
  const sum = (pick: (row: (typeof recorded)[number]) => number) =>
    recorded.reduce((total, row) => total + pick(row), 0);
  // A response cached by an older build lacks the fast-charging split; read it as all home charging.
  const fastOf = (row: (typeof recorded)[number]) => ({
    kwh: row.fast_kwh ?? 0,
    pricedKwh: row.fast_priced_kwh ?? 0,
    cost: row.fast_cost_usd ?? 0,
  });
  const fastCost = sum((row) => fastOf(row).cost);
  const fastPricedKwh = sum((row) => fastOf(row).pricedKwh);
  const homeCost = sum((row) => row.charging_cost_usd - fastOf(row).cost);
  const homePricedKwh = sum((row) => row.priced_kwh - fastOf(row).pricedKwh);
  const trackedKwh = sum((row) => row.charged_kwh);
  const fastKwh = sum((row) => fastOf(row).kwh);
  const homeUsdPerKwh = homePricedKwh > 0 ? Math.max(0, homeCost) / homePricedKwh : DEFAULT_ELECTRICITY_USD_PER_KWH;
  const fastUsdPerKwh = fastPricedKwh > 0 ? fastCost / fastPricedKwh : DEFAULT_FAST_CHARGING_USD_PER_KWH;
  const unpricedFastKwh = (row: (typeof recorded)[number]) => Math.max(0, fastOf(row).kwh - fastOf(row).pricedKwh);
  const unpricedHomeKwh = (row: (typeof recorded)[number]) =>
    Math.max(0, row.charged_kwh - fastOf(row).kwh - (row.priced_kwh - fastOf(row).pricedKwh));
  const trackedDays = Math.max(1, (nowMs - Math.max(trackedFromMs, startMs)) / DAY_MS);
  const mileageAssumed = trackedMiles <= 0;
  const avgDailyMiles = mileageAssumed ? DEFAULT_DAILY_MILES : trackedMiles / trackedDays;
  const monthEnergyCost = (row: (typeof recorded)[number]) =>
    row.charging_cost_usd + unpricedFastKwh(row) * fastUsdPerKwh + unpricedHomeKwh(row) * homeUsdPerKwh;
  const trackedEnergyCost = sum(monthEnergyCost);
  // The blended rate the owner actually pays. Electric comparison vehicles use
  // it too, so they charge with the same habits: mostly home, some fast.
  const electricityRateAssumed = !(homePricedKwh > 0 || fastPricedKwh > 0) || trackedKwh <= 0;
  const electricityUsdPerKwh = electricityRateAssumed
    ? DEFAULT_ELECTRICITY_USD_PER_KWH
    : trackedEnergyCost / trackedKwh;
  const fastShare = trackedKwh > 0 ? fastKwh / trackedKwh : 0;
  const ownCostPerMile =
    trackedEnergyCost > 0 && trackedMiles > 0
      ? trackedEnergyCost / trackedMiles
      : DEFAULT_OWN_KWH_PER_MI * electricityUsdPerKwh;

  const gasPrice = createGasPriceResolver(
    data.fuel_prices.months,
    settings.gas_price_usd_per_gallon,
  );
  const usageByMonth = new Map(recorded.map((row) => [row.month.slice(0, 7), row]));

  // Periods: one per calendar month, clipped to the ledger window.
  const periods: LedgerPeriod[] = [];
  const ownEnergy: number[] = [];
  for (let cursor = monthStart(startMs); cursor < endMs; cursor = nextMonth(cursor)) {
    const periodStart = Math.max(cursor, startMs);
    const periodEnd = Math.min(nextMonth(cursor), endMs);
    if (periodEnd <= periodStart) continue;
    const key = monthKey(cursor);
    const actual = usageByMonth.get(key);
    const estimatedDays =
      (overlapMs(periodStart, periodEnd, startMs, trackedFromMs) +
        overlapMs(periodStart, periodEnd, nowMs, endMs)) /
      DAY_MS;
    const estimatedMiles = avgDailyMiles * estimatedDays;
    const price = gasPrice(key);
    periods.push({
      startMs: periodStart,
      endMs: periodEnd,
      kind:
        periodEnd <= trackedFromMs ? 'estimated' : periodStart >= nowMs ? 'projected' : 'actual',
      miles: (actual?.miles ?? 0) + estimatedMiles,
      gasRegularUsd: price.regular,
      gasPremiumUsd: price.premium,
      gasFromSeries: price.fromSeries,
    });
    ownEnergy.push((actual ? monthEnergyCost(actual) : 0) + estimatedMiles * ownCostPerMile);
  }

  // The tracked vehicle, with the user's figures over the defaults.
  const ownPrice = settings.purchase_price_usd ?? 0;
  const yearsOwned = (nowMs - startMs) / YEAR_MS;
  const ownRetention =
    (settings.resale_value_usd != null
      ? impliedRetention(ownPrice, settings.resale_value_usd, yearsOwned)
      : null) ?? data.own_defaults.annual_retention;
  const own: LedgerVehicle = {
    id: OWN_VEHICLE_ID,
    label: options.ownLabel,
    powertrain: 'ev',
    isOwn: true,
    isCustom: false,
    priceUsd: ownPrice,
    mpg: null,
    kwhPerMi: null,
    premiumFuel: false,
    resaleAnchor:
      settings.resale_value_usd != null && ownPrice > 0
        ? { ms: nowMs, valueUsd: settings.resale_value_usd }
        : null,
    costs: {
      ...data.own_defaults,
      annual_retention: ownRetention,
      insurance_monthly_usd:
        settings.insurance_monthly_usd ?? data.own_defaults.insurance_monthly_usd,
      tire_cost_usd: settings.tire_set_cost_usd ?? data.own_defaults.tire_cost_usd,
    },
  };

  const enabled = new Set(options.enabledIds ?? enabledComparisonIds(data));
  const compared = comparisonVehicles(data).filter((vehicle) => enabled.has(vehicle.id));

  const vehicles = [own, ...compared].map((vehicle) =>
    buildVehicleLedger(vehicle, periods, startMs, electricityUsdPerKwh, ownEnergy),
  );

  return {
    startMs,
    endMs,
    nowMs,
    estimatedUntilMs: trackedFromMs > startMs ? Math.min(trackedFromMs, endMs) : null,
    projectedFromMs: endMs > nowMs ? nowMs : null,
    periods,
    vehicles,
    avgMonthlyMiles: avgDailyMiles * DAYS_PER_MONTH,
    mileageAssumed,
    electricityUsdPerKwh,
    homeUsdPerKwh,
    fastUsdPerKwh,
    fastShare,
    electricityRateAssumed,
    startAssumed: purchaseMs == null,
  };
}

/** How many times a recurring item falls due while a counter advances. */
function crossings(before: number, after: number, interval: number | null): number {
  if (!interval || interval <= 0) return 0;
  return Math.max(0, Math.floor(after / interval) - Math.floor(before / interval));
}

/** Calendar anniversaries of `startMs` that fall after `fromMs`, up to and including `toMs`. */
function anniversaries(startMs: number, fromMs: number, toMs: number): number {
  let count = 0;
  for (let year = 1; ; year += 1) {
    const anniversary = addYears(startMs, year);
    if (anniversary > toMs) return count;
    if (anniversary > fromMs) count += 1;
  }
}

function buildVehicleLedger(
  vehicle: LedgerVehicle,
  periods: LedgerPeriod[],
  startMs: number,
  electricityUsdPerKwh: number,
  ownEnergy: number[],
): VehicleLedger {
  const { costs } = vehicle;
  const anchor = vehicle.resaleAnchor ?? null;
  const valueAt = (ms: number) => {
    if (!anchor) {
      return vehicle.priceUsd * Math.pow(costs.annual_retention, (ms - startMs) / YEAR_MS);
    }
    // Past the entered value, keep depreciating from it.
    if (ms >= anchor.ms || anchor.ms <= startMs) {
      return anchor.valueUsd * Math.pow(costs.annual_retention, Math.max(0, ms - anchor.ms) / YEAR_MS);
    }
    // Before it, run from the purchase price to the entered value.
    const share = (ms - startMs) / (anchor.ms - startMs);
    return anchor.valueUsd > 0
      ? vehicle.priceUsd * Math.pow(anchor.valueUsd / vehicle.priceUsd, share)
      : vehicle.priceUsd * (1 - share);
  };
  const totals = {
    miles: 0,
    fuel: 0,
    oil: 0,
    oilCount: 0,
    brakes: 0,
    brakeCount: 0,
    tires: 0,
    tireCount: 0,
    service: 0,
    insurance: 0,
  };
  let running = 0;
  const point = (t: number): LedgerPoint => ({
    t,
    spent: vehicle.priceUsd + running,
    net: vehicle.priceUsd - valueAt(t) + running,
  });
  const points: LedgerPoint[] = [point(startMs)];
  const atPeriodEnd: LedgerPoint[] = [point(startMs)];
  const months: LedgerMonth[] = [];

  periods.forEach((period, index) => {
    const milesBefore = totals.miles;
    const milesAfter = milesBefore + period.miles;

    let fuel: number;
    if (vehicle.isOwn) {
      fuel = ownEnergy[index] ?? 0;
    } else if (vehicle.powertrain === 'ev') {
      fuel = period.miles * (vehicle.kwhPerMi ?? 0) * electricityUsdPerKwh;
    } else {
      const price = vehicle.premiumFuel ? period.gasPremiumUsd : period.gasRegularUsd;
      fuel = vehicle.mpg ? (period.miles / vehicle.mpg) * price : 0;
    }
    const insurance =
      costs.insurance_monthly_usd * ((period.endMs - period.startMs) / DAY_MS / DAYS_PER_MONTH);

    // Costs that accrue across the period.
    totals.miles = milesAfter;
    totals.fuel += fuel;
    totals.insurance += insurance;
    running += fuel + insurance;
    points.push(point(period.endMs));

    // Costs that land all at once.
    const oilCount = crossings(milesBefore, milesAfter, costs.oil_interval_mi);
    const brakeCount = crossings(milesBefore, milesAfter, costs.brake_interval_mi);
    const tireCount = crossings(milesBefore, milesAfter, costs.tire_interval_mi);
    const serviceCount = anniversaries(startMs, period.startMs, period.endMs);
    const oil = oilCount * (costs.oil_cost_usd ?? 0);
    const brakes = brakeCount * costs.brake_cost_usd;
    const tires = tireCount * costs.tire_cost_usd;
    const service = serviceCount * costs.annual_service_usd;
    const events = oil + brakes + tires + service;
    const oneTime: LedgerMonth['oneTime'] = [];
    if (oilCount && oil > 0) oneTime.push({ kind: 'oil', count: oilCount, usd: oil });
    if (brakeCount) oneTime.push({ kind: 'brakes', count: brakeCount, usd: brakes });
    if (tireCount) oneTime.push({ kind: 'tires', count: tireCount, usd: tires });
    if (serviceCount && service > 0) oneTime.push({ kind: 'service', count: serviceCount, usd: service });
    months.push({ fuel, insurance, oneTime });
    totals.oil += oil;
    totals.oilCount += oilCount;
    totals.brakes += brakes;
    totals.brakeCount += brakeCount;
    totals.tires += tires;
    totals.tireCount += tireCount;
    totals.service += service;
    if (events > 0) {
      running += events;
      points.push(point(period.endMs));
    }
    atPeriodEnd.push(point(period.endMs));
  });

  const last = atPeriodEnd[atPeriodEnd.length - 1] as LedgerPoint;
  const resaleValue = vehicle.priceUsd + running - last.net;
  return {
    vehicle,
    months,
    points,
    atPeriodEnd,
    totals: {
      ...totals,
      depreciation: vehicle.priceUsd - resaleValue,
      spent: last.spent,
      net: last.net,
      resaleValue,
      netPerMile: totals.miles > 0 ? last.net / totals.miles : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

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
