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
  MAX_REAL_WORLD_FACTOR,
  MIN_MILES_FOR_REAL_WORLD_FACTOR,
  MIN_REAL_WORLD_FACTOR,
  OWN_SCHEDULE_KEY,
  OWN_VEHICLE_ID,
  YEAR_MS,
} from './modelConstants';
import { addMonths, addYears, monthKey, monthStart, nextMonth, overlapMs, parseDay } from './modelDates';
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
  // A month's miles: its odometer movement where its trips carry readings,
  // since drives that were not recorded still move the odometer. A month whose
  // reading continues from the month before covers the whole month; the first
  // month with readings covers only the part after its first trip.
  const odometerByMonth = new Map<string, { miles: number; wholeMonth: boolean }>();
  let previousEnd: { key: string; mi: number } | null = null;
  for (const row of recorded) {
    const key = row.month.slice(0, 7);
    const end = row.odometer_end_mi ?? null;
    if (end == null) continue;
    const continues = previousEnd != null && previousEnd.key === monthKey(addMonths(Date.parse(`${key}-01T00:00:00Z`), -1));
    const start = continues ? (previousEnd as { mi: number }).mi : (row.odometer_start_mi ?? null);
    if (start != null) odometerByMonth.set(key, { miles: Math.max(0, end - start), wholeMonth: continues });
    previousEnd = { key, mi: end };
  }
  const monthMiles = (row: (typeof recorded)[number]) =>
    Math.max(row.miles, odometerByMonth.get(row.month.slice(0, 7))?.miles ?? 0);
  const trackedMiles = recorded.reduce((sum, row) => sum + monthMiles(row), 0);
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

  // Miles. The odometer is the total: recorded trips miss every mile driven
  // while nothing was collecting, and every compared vehicle is charged by the
  // mile. It needs a purchase date, because without one the ledger starts at
  // first tracking and the odometer also counts the miles before that.
  const ownedDays = Math.max(1, (nowMs - startMs) / DAY_MS);
  const odometerMiles =
    usage.odometer_mi != null ? usage.odometer_mi - (settings.purchase_odometer_mi ?? 0) : null;
  const mileageFromOdometer = purchaseMs != null && odometerMiles != null && odometerMiles > trackedMiles;
  const milesToDate = mileageFromOdometer ? (odometerMiles as number) : trackedMiles;
  const trackedDays = Math.max(1, (nowMs - Math.max(trackedFromMs, startMs)) / DAY_MS);
  const mileageAssumed = milesToDate <= 0;
  const avgDailyMiles = mileageAssumed
    ? DEFAULT_DAILY_MILES
    : mileageFromOdometer
      ? milesToDate / ownedDays
      : trackedMiles / trackedDays;

  const gasPrice = createGasPriceResolver(
    data.fuel_prices.months,
    settings.gas_price_usd_per_gallon,
  );
  const usageByMonth = new Map(recorded.map((row) => [row.month.slice(0, 7), row]));

  // Periods: one per calendar month, clipped to the ledger window.
  const spans: Array<{
    key: string;
    startMs: number;
    endMs: number;
    actual: (typeof recorded)[number] | undefined;
    pastDays: number;
    futureDays: number;
    untrackedDays: number;
  }> = [];
  for (let cursor = monthStart(startMs); cursor < endMs; cursor = nextMonth(cursor)) {
    const periodStart = Math.max(cursor, startMs);
    const periodEnd = Math.min(nextMonth(cursor), endMs);
    if (periodEnd <= periodStart) continue;
    const key = monthKey(cursor);
    spans.push({
      key,
      startMs: periodStart,
      endMs: periodEnd,
      actual: usageByMonth.get(key),
      pastDays: overlapMs(periodStart, periodEnd, startMs, nowMs) / DAY_MS,
      futureDays: overlapMs(periodStart, periodEnd, nowMs, endMs) / DAY_MS,
      untrackedDays: overlapMs(periodStart, periodEnd, startMs, trackedFromMs) / DAY_MS,
    });
  }

  // Miles driven but not recorded as trips. With an odometer total, the
  // shortfall goes to the months that fall short of the owner's average, in
  // proportion to how far short. Without one, only the months before tracking
  // began can be estimated.
  // A month the odometer covers whole already has every mile it drove.
  const recordedMiles = (span: (typeof spans)[number]) => (span.actual ? monthMiles(span.actual) : 0);
  const shortBy = spans.map((span) =>
    mileageFromOdometer && !odometerByMonth.get(span.key)?.wholeMonth
      ? Math.max(0, avgDailyMiles * span.pastDays - recordedMiles(span))
      : 0,
  );
  const shortTotal = shortBy.reduce((total, value) => total + value, 0);
  const unrecordedMiles = spans.map((span, index) =>
    mileageFromOdometer
      ? shortTotal > 0
        ? ((milesToDate - trackedMiles) * (shortBy[index] as number)) / shortTotal
        : 0
      : avgDailyMiles * span.untrackedDays,
  );

  // Charging is billed from the sessions themselves, so months with charging
  // history cost what was paid however many miles were recorded. Only months
  // before the first session, and the projection, are priced by the mile.
  const firstChargeMonth = recorded.find((row) => row.charged_kwh > 0)?.month.slice(0, 7) ?? null;
  const hasChargeHistory = (key: string) => firstChargeMonth != null && key >= firstChargeMonth;
  const chargedMiles = spans.reduce(
    (total, span, index) =>
      hasChargeHistory(span.key) ? total + recordedMiles(span) + (unrecordedMiles[index] as number) : total,
    0,
  );
  // Months the odometer covers whole are the ones where both the miles and
  // the charging are known. Before tracking began, charging history can miss
  // sessions and the miles are only an estimate, so per-mile figures come
  // from the covered months once they hold enough miles.
  const covered = recorded.filter((row) => odometerByMonth.get(row.month.slice(0, 7))?.wholeMonth);
  const coveredMiles = covered.reduce((total, row) => total + monthMiles(row), 0);
  const useCovered = coveredMiles >= MIN_MILES_FOR_REAL_WORLD_FACTOR;
  const perMileBase = useCovered
    ? {
        miles: coveredMiles,
        kwh: covered.reduce((total, row) => total + row.charged_kwh, 0),
        cost: covered.reduce((total, row) => total + monthEnergyCost(row), 0),
      }
    : { miles: chargedMiles, kwh: trackedKwh, cost: trackedEnergyCost };
  const ownCostPerMile =
    perMileBase.cost > 0 && perMileBase.miles > 0
      ? perMileBase.cost / perMileBase.miles
      : DEFAULT_OWN_KWH_PER_MI * electricityUsdPerKwh;

  // Rated consumption is measured on a test cycle; real driving, weather,
  // charging losses and idle drain all add to it. The owner's energy from the
  // wall per mile, against their own vehicle's rating, says by how much for
  // the way they drive, and a comparison EV's rating is raised by the same
  // share. Bounded, and left alone until there are enough miles to trust.
  const ownKwhPerMi = perMileBase.kwh > 0 && perMileBase.miles > 0 ? perMileBase.kwh / perMileBase.miles : null;
  const ownRatedKwhPerMi = data.own_rated_kwh_per_mi ?? null;
  const realWorldFactor =
    ownKwhPerMi != null && ownRatedKwhPerMi != null && perMileBase.miles >= MIN_MILES_FOR_REAL_WORLD_FACTOR
      ? Math.min(MAX_REAL_WORLD_FACTOR, Math.max(MIN_REAL_WORLD_FACTOR, ownKwhPerMi / ownRatedKwhPerMi))
      : 1;

  // What a kWh costs in months without charging sessions, and in the
  // projection: the same months the tracked vehicle's per-mile cost comes from.
  const projectedUsdPerKwh = perMileBase.kwh > 0 && perMileBase.cost > 0 ? perMileBase.cost / perMileBase.kwh : electricityUsdPerKwh;

  const periods: LedgerPeriod[] = [];
  const ownEnergy: number[] = [];
  spans.forEach((span, index) => {
    const unrecorded = unrecordedMiles[index] as number;
    const projectedMiles = avgDailyMiles * span.futureDays;
    const price = gasPrice(span.key);
    // That month's own rates where it had priced sessions of the kind, else the averages.
    const row = span.actual;
    const monthFastPriced = row ? fastOf(row).pricedKwh : 0;
    const monthHomePriced = row ? row.priced_kwh - monthFastPriced : 0;
    const monthHomeRate =
      row && monthHomePriced > 0 ? Math.max(0, row.charging_cost_usd - fastOf(row).cost) / monthHomePriced : null;
    const monthFastRate = row && monthFastPriced > 0 ? fastOf(row).cost / monthFastPriced : null;
    periods.push({
      startMs: span.startMs,
      endMs: span.endMs,
      kind:
        span.endMs <= trackedFromMs ? 'estimated' : span.startMs >= nowMs ? 'projected' : 'actual',
      miles: recordedMiles(span) + unrecorded + projectedMiles,
      gasRegularUsd: price.regular,
      gasPremiumUsd: price.premium,
      gasFromSeries: price.fromSeries,
      homeUsdPerKwh: monthHomeRate ?? homeUsdPerKwh,
      fastUsdPerKwh: monthFastRate ?? fastUsdPerKwh,
      homeFromSessions: monthHomeRate != null,
      fastFromSessions: monthFastRate != null,
      chargingUsdPerKwh: row && row.charged_kwh > 0 ? monthEnergyCost(row) / row.charged_kwh : projectedUsdPerKwh,
    });
    ownEnergy.push(
      (span.actual ? monthEnergyCost(span.actual) : 0) +
        ((hasChargeHistory(span.key) ? 0 : unrecorded) + projectedMiles) * ownCostPerMile,
    );
  });

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
    buildVehicleLedger(vehicle, periods, startMs, realWorldFactor, ownEnergy),
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
    mileageFromOdometer,
    milesToDate,
    electricityUsdPerKwh,
    homeUsdPerKwh,
    fastUsdPerKwh,
    fastShare,
    electricityRateAssumed,
    homePlan: data.home_plan ?? null,
    ownKwhPerMi,
    ownRatedKwhPerMi,
    realWorldFactor,
    startAssumed: purchaseMs == null,
  };
}
