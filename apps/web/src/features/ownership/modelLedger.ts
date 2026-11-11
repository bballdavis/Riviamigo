/**
 * The whole-household ledger: periods, the tracked vehicle, and every compared
 * vehicle, built from one response and one clock reading.
 */
import type { OwnershipResponse } from '@riviamigo/types';
import { createGasPriceResolver } from './modelGas';
import {
  DAYS_PER_MONTH,
  DAY_MS,
  DEFAULT_DAILY_MILES,
  DEFAULT_ELECTRICITY_USD_PER_KWH,
  DEFAULT_FAST_CHARGING_USD_PER_KWH,
  OWN_SCHEDULE_KEY,
  OWN_VEHICLE_ID,
  YEAR_MS,
} from './modelConstants';
import { addYears, monthKey, monthStart, nextMonth, overlapMs, parseDay } from './modelDates';
import { normalizeOwnershipResponse } from './modelNormalize';
import { projectionYearsOf } from './modelPresentation';
import { ownBuiltInSchedule, scheduleFor } from './modelSchedules';
import type { BuildLedgerOptions, Ledger, LedgerPeriod, LedgerVehicle } from './modelTypes';
import { buildVehicleLedger } from './modelVehicleLedger';
import { comparisonVehicles, enabledComparisonIds, impliedRetention } from './modelVehicles';

const DEFAULT_OWN_KWH_PER_MI = 0.42;

export function buildLedger(input: OwnershipResponse, options: BuildLedgerOptions): Ledger {
  const data = normalizeOwnershipResponse(input);
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
      maintenance: scheduleFor(data, OWN_SCHEDULE_KEY, ownBuiltInSchedule(data)),
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
