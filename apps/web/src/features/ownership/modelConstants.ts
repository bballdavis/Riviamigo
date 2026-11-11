/** Ownership ledger constants: calendar units, typical-price fallbacks, and fixed keys. */
import type { Horizon } from './modelTypes';

export const HORIZONS: Array<{ value: Horizon; label: string }> = [
  { value: 'to_date', label: 'To date' },
  { value: 'projected', label: 'Projected' },
];

/** Years of ownership the Projected view covers when none is stored. */
export const DEFAULT_PROJECTION_YEARS = 5;
export const MAX_PROJECTION_YEARS = 20;

export const OWN_VEHICLE_ID = 'own';

export const DAY_MS = 86_400_000;
export const YEAR_MS = 365.25 * DAY_MS;
export const DAYS_PER_MONTH = 30.44;
/** Used only until a vehicle has recorded any driving. */
export const DEFAULT_DAILY_MILES = 1000 / DAYS_PER_MONTH;
/** Used for reference EVs when no charging cost has been recorded. */
export const DEFAULT_ELECTRICITY_USD_PER_KWH = 0.16;
/** Typical U.S. DC fast-charging price, used only when no fast session has a price. */
export const DEFAULT_FAST_CHARGING_USD_PER_KWH = 0.45;
/** Used when neither stored prices nor a flat price are available. */
export const DEFAULT_GAS_USD_PER_GALLON = 3.5;
export const DEFAULT_PREMIUM_SURCHARGE_USD = 0.8;

/** Schedule key of the tracked vehicle in `settings.maintenance`. */
export const OWN_SCHEDULE_KEY = 'own';
