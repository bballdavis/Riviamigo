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
 *
 * The implementation lives in the `model*` modules beside this file; this
 * barrel keeps `./model` the single import path for the page and its tests.
 */
export type {
  BuildLedgerOptions,
  GasPriceResolver,
  Horizon,
  Ledger,
  LedgerMonth,
  LedgerPeriod,
  LedgerPoint,
  LedgerTotals,
  LedgerVehicle,
  OneTimeKind,
  PeriodKind,
  ScheduleTarget,
  VehicleLedger,
} from './modelTypes';
export {
  DEFAULT_DAILY_MILES,
  DEFAULT_ELECTRICITY_USD_PER_KWH,
  DEFAULT_FAST_CHARGING_USD_PER_KWH,
  DEFAULT_GAS_USD_PER_GALLON,
  DEFAULT_PREMIUM_SURCHARGE_USD,
  DEFAULT_PROJECTION_YEARS,
  HORIZONS,
  MAX_PROJECTION_YEARS,
  OWN_SCHEDULE_KEY,
  OWN_VEHICLE_ID,
} from './modelConstants';
export { parseDay } from './modelDates';
export { normalizeOwnershipResponse } from './modelNormalize';
export { scheduleFor, scheduleTargets } from './modelSchedules';
export { createGasPriceResolver } from './modelGas';
export { comparisonVehicles, enabledComparisonIds, impliedRetention, isComparisonEnabled } from './modelVehicles';
export { buildLedger } from './modelLedger';
export { describeHomePlan, formatCents, formatUsd, horizonSpan, insightSentence, ordinal, ownRank, projectionYearsOf } from './modelPresentation';
