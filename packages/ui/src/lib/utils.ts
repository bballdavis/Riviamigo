import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type UnitSystem = 'imperial' | 'metric';
export type EfficiencyDisplay = 'distance_per_energy' | 'energy_per_distance';
export type UnitMode = 'imperial' | 'metric' | 'custom';
export type DistanceUnit = 'miles' | 'kilometers';
export type SpeedUnit = 'mph' | 'kmh';
export type TemperatureUnit = 'fahrenheit' | 'celsius';
export type PressureUnit = 'psi' | 'kpa';
export type AltitudeUnit = 'feet' | 'meters';
export type PlaceRadiusUnit = 'feet' | 'meters';

export interface UnitPreferences {
  mode: UnitMode;
  distance_unit: DistanceUnit;
  speed_unit: SpeedUnit;
  temperature_unit: TemperatureUnit;
  pressure_unit: PressureUnit;
  altitude_unit: AltitudeUnit;
  place_radius_unit: PlaceRadiusUnit;
  efficiency_display: EfficiencyDisplay;
}

const UNIT_SYSTEM_STORAGE_KEY = 'rm-units';
const EFFICIENCY_DISPLAY_STORAGE_KEY = 'rm-efficiency-display';
const UNIT_PREFERENCES_STORAGE_KEY = 'rm-unit-preferences';
const MILES_TO_KM = 1.609344;
const MPH_TO_KMH = 1.609344;
const METERS_TO_FEET = 3.28084;
const PSI_TO_KPA = 6.894757293168361;

const IMPERIAL_PREFS: UnitPreferences = {
  mode: 'imperial',
  distance_unit: 'miles',
  speed_unit: 'mph',
  temperature_unit: 'fahrenheit',
  pressure_unit: 'psi',
  altitude_unit: 'feet',
  place_radius_unit: 'feet',
  efficiency_display: 'distance_per_energy',
};

const METRIC_PREFS: UnitPreferences = {
  mode: 'metric',
  distance_unit: 'kilometers',
  speed_unit: 'kmh',
  temperature_unit: 'celsius',
  pressure_unit: 'kpa',
  altitude_unit: 'meters',
  place_radius_unit: 'meters',
  efficiency_display: 'distance_per_energy',
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function clonePrefs(prefs: UnitPreferences): UnitPreferences {
  return { ...prefs };
}

function resolveFromMode(mode: UnitMode): UnitPreferences {
  if (mode === 'metric') return clonePrefs(METRIC_PREFS);
  if (mode === 'imperial') return clonePrefs(IMPERIAL_PREFS);
  return clonePrefs(IMPERIAL_PREFS);
}

function isUnitPreferences(value: unknown): value is UnitPreferences {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<UnitPreferences>;
  return (
    (v.mode === 'imperial' || v.mode === 'metric' || v.mode === 'custom') &&
    (v.distance_unit === 'miles' || v.distance_unit === 'kilometers') &&
    (v.speed_unit === 'mph' || v.speed_unit === 'kmh') &&
    (v.temperature_unit === 'fahrenheit' || v.temperature_unit === 'celsius') &&
    (v.pressure_unit === 'psi' || v.pressure_unit === 'kpa') &&
    (v.altitude_unit === 'feet' || v.altitude_unit === 'meters') &&
    (v.place_radius_unit === 'feet' || v.place_radius_unit === 'meters') &&
    (v.efficiency_display === 'distance_per_energy' || v.efficiency_display === 'energy_per_distance')
  );
}

function readLegacyPreferences(): UnitPreferences {
  const base = clonePrefs(IMPERIAL_PREFS);
  try {
    const system = window.localStorage.getItem(UNIT_SYSTEM_STORAGE_KEY);
    if (system === 'metric') Object.assign(base, METRIC_PREFS);
    const efficiencyDisplay = window.localStorage.getItem(EFFICIENCY_DISPLAY_STORAGE_KEY);
    base.efficiency_display =
      efficiencyDisplay === 'energy_per_distance' ? 'energy_per_distance' : 'distance_per_energy';
  } catch {
    // Ignore.
  }
  return base;
}

export function getUnitPreferences(): UnitPreferences {
  if (typeof window === 'undefined') return clonePrefs(IMPERIAL_PREFS);
  try {
    const stored = window.localStorage.getItem(UNIT_PREFERENCES_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (isUnitPreferences(parsed)) return parsed;
    }
  } catch {
    // Ignore parse/storage errors.
  }

  const migrated = readLegacyPreferences();
  setUnitPreferences(migrated, { suppressEvent: true });
  return migrated;
}

export function setUnitPreferences(
  preferences: UnitPreferences,
  options: { suppressEvent?: boolean } = {},
) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UNIT_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    window.localStorage.setItem(
      UNIT_SYSTEM_STORAGE_KEY,
      preferences.distance_unit === 'kilometers' ? 'metric' : 'imperial',
    );
    window.localStorage.setItem(EFFICIENCY_DISPLAY_STORAGE_KEY, preferences.efficiency_display);
    if (!options.suppressEvent) {
      window.dispatchEvent(new Event('rm-units-change'));
      window.dispatchEvent(new Event('rm-efficiency-display-change'));
    }
  } catch {
    // Ignore storage errors.
  }
}

export function getUnitSystem(): UnitSystem {
  return getUnitPreferences().distance_unit === 'kilometers' ? 'metric' : 'imperial';
}

export function setUnitSystem(system: UnitSystem) {
  const next = system === 'metric' ? clonePrefs(METRIC_PREFS) : clonePrefs(IMPERIAL_PREFS);
  setUnitPreferences(next);
}

export function getEfficiencyDisplay(): EfficiencyDisplay {
  return getUnitPreferences().efficiency_display;
}

export function setEfficiencyDisplay(display: EfficiencyDisplay) {
  const next = getUnitPreferences();
  next.efficiency_display = display;
  setUnitPreferences(next);
}

export function mergeUnitPreferences(partial: Partial<UnitPreferences>) {
  const current = getUnitPreferences();
  setUnitPreferences({ ...current, ...partial });
}

export function formatNumber(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';

  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatSmartNumber(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatMiles(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const prefs = getUnitPreferences();
  if (prefs.distance_unit === 'kilometers') return `${formatNumber(value * MILES_TO_KM, 1)} km`;
  return `${formatNumber(value, 0)} mi`;
}

export function formatPercent(value: number, decimals = 0): string {
  return `${formatNumber(value, decimals)}%`;
}

export function formatSmartPercent(value: number, decimals = 0): string {
  return `${formatSmartNumber(value, decimals)}%`;
}

export function formatKwh(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${formatNumber(value, 1)} kWh`;
}

export function formatMph(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const prefs = getUnitPreferences();
  if (prefs.speed_unit === 'kmh') return `${formatNumber(value * MPH_TO_KMH, 0)} km/h`;
  return `${formatNumber(value, 0)} mph`;
}

export function formatEfficiency(value: number | null | undefined): string {
  const formatted = formatEfficiencyValue(value);
  if (formatted === '-') return '-';
  return `${formatted} ${getEfficiencyUnitLabel()}`;
}

export function getEfficiencyUnitLabel(): string {
  const prefs = getUnitPreferences();
  if (prefs.efficiency_display === 'energy_per_distance') {
    return prefs.distance_unit === 'kilometers' ? 'Wh/km' : 'Wh/mi';
  }
  return prefs.distance_unit === 'kilometers' ? 'km/kWh' : 'mi/kWh';
}

export function formatEfficiencyValue(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const prefs = getUnitPreferences();
  if (prefs.efficiency_display === 'energy_per_distance') {
    if (prefs.distance_unit === 'kilometers') return formatNumber(value / MILES_TO_KM, 0);
    return formatNumber(value, 0);
  }
  if (prefs.distance_unit === 'kilometers') {
    const converted = whPerMileToKmPerKwh(value);
    return converted === null ? '-' : formatNumber(converted, 1);
  }
  const converted = whPerMileToMiPerKwh(value);
  return converted === null ? '-' : formatNumber(converted, 1);
}

export function formatEnergyPerDistance(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const prefs = getUnitPreferences();
  if (prefs.distance_unit === 'kilometers') return `${formatNumber(value / MILES_TO_KM, 0)} Wh/km`;
  return `${formatNumber(value, 0)} Wh/mi`;
}

export function whPerMileToMiPerKwh(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return 1000 / value;
}

export function whPerMileToKmPerKwh(value: number | null | undefined): number | null {
  const miPerKwh = whPerMileToMiPerKwh(value);
  return miPerKwh === null ? null : miPerKwh * MILES_TO_KM;
}

export function whPerMileToWhPerKm(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value / MILES_TO_KM;
}

export function formatPressure(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const prefs = getUnitPreferences();
  if (prefs.pressure_unit === 'kpa') return `${formatNumber(value * PSI_TO_KPA, 0)} kPa`;
  return `${formatNumber(value, 0)} psi`;
}

export function formatAltitude(valueMeters: number | null | undefined): string {
  if (valueMeters === null || valueMeters === undefined || Number.isNaN(valueMeters)) return '-';
  const prefs = getUnitPreferences();
  if (prefs.altitude_unit === 'meters') return `${formatNumber(valueMeters, 0)} m`;
  return `${formatNumber(valueMeters * METERS_TO_FEET, 0)} ft`;
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '-';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatTemp(celsius: number | null | undefined): string {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) return '-';
  const prefs = getUnitPreferences();
  if (prefs.temperature_unit === 'celsius') return `${Math.round(celsius)} C`;
  return `${Math.round(celsius * 9 / 5 + 32)} F`;
}
