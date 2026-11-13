/** Ownership ledger types: the shapes the cost math and the page share. */
import type {
  OwnershipCostAssumptions,
  OwnershipHomePlan,
  OwnershipMaintenanceCategory,
  OwnershipMaintenanceItem,
  OwnershipPowertrain,
} from '@riviamigo/types';

export type Horizon = 'to_date' | 'projected';

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
  /** What the tracked vehicle's home and fast charging cost per kWh this month. */
  homeUsdPerKwh: number;
  fastUsdPerKwh: number;
  /** False when the month had no priced session of that kind and the average stands in. */
  homeFromSessions: boolean;
  fastFromSessions: boolean;
  /**
   * What the tracked vehicle's charging cost per kWh this month, home and fast
   * together; the projected rate in months without sessions. Electric
   * comparison vehicles pay it too.
   */
  chargingUsdPerKwh: number;
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

export type OneTimeKind = OwnershipMaintenanceCategory;

/** What one vehicle spent in one period. */
export interface LedgerMonth {
  fuel: number;
  insurance: number;
  /** One-time costs that fell due in the period, in a fixed order. */
  oneTime: Array<{ kind: OneTimeKind; count: number; usd: number; labels: string[] }>;
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
  /** Average miles a month since the ledger start; fills the months before tracking. */
  avgMonthlyMiles: number;
  /** Miles a month the projection drives. */
  projectedMonthlyMiles: number;
  /** Pace over the last year of odometer readings, once they span enough days. */
  recentMonthlyMiles: number | null;
  recentDays: number | null;
  /** Where the projection's pace comes from. */
  paceSource: 'recent' | 'since_purchase' | 'recorded' | 'assumed';
  /** The latest odometer reading, and where the projection takes it by the ledger's end. */
  odometerMi: number | null;
  odometerAtEndMi: number | null;
  /**
   * The odometer at purchase that charging history before tracking suggests,
   * when none is entered and it differs a lot from zero.
   */
  impliedPurchaseOdometerMi: number | null;
  /** True when no driving has been recorded and a typical mileage is assumed. */
  mileageAssumed: boolean;
  /** True when total miles come from the odometer rather than recorded drives alone. */
  mileageFromOdometer: boolean;
  /** Miles driven from the ledger start to now. */
  milesToDate: number;
  electricityUsdPerKwh: number;
  /** What home and other AC charging costs you per kWh. */
  homeUsdPerKwh: number;
  /** What DC fast charging costs you per kWh. */
  fastUsdPerKwh: number;
  /** Share of recorded charging energy from DC fast charging, 0 to 1. */
  fastShare: number;
  /** True when no charging cost has been recorded to derive the rate from. */
  electricityRateAssumed: boolean;
  /** The electricity plan home charging is priced by, when one applies. */
  homePlan: OwnershipHomePlan | null;
  /** Energy from the wall per mile for the tracked vehicle; null until both are recorded. */
  ownKwhPerMi: number | null;
  /** The tracked vehicle's EPA rating in kWh per mile, when its model is known. */
  ownRatedKwhPerMi: number | null;
  /** What a comparison EV's rated consumption is multiplied by; 1 when unadjusted. */
  realWorldFactor: number;
  /** True when the ledger starts at first tracking because no purchase date is set. */
  startAssumed: boolean;
}

export interface ScheduleTarget {
  key: string;
  label: string;
  powertrain: OwnershipPowertrain;
  builtIn: OwnershipMaintenanceItem[];
  schedule: OwnershipMaintenanceItem[];
  edited: boolean;
}

export interface GasPriceResolver {
  (month: string): { regular: number; premium: number; fromSeries: boolean };
  /** What a month without stored data falls back to. */
  fallbackRegular: number;
}

export interface BuildLedgerOptions {
  horizon: Horizon;
  now: Date;
  ownLabel: string;
  /** Years from the purchase date the Projected view covers. Defaults to the stored setting. */
  projectionYears?: number;
  /** Comparison vehicle ids to include. Defaults to the stored selection. */
  enabledIds?: string[];
}
