import type { UnitPreferences } from '@riviamigo/types';

export const IMPERIAL_UNITS: UnitPreferences = {
  mode: 'imperial',
  distance_unit: 'miles',
  speed_unit: 'mph',
  temperature_unit: 'fahrenheit',
  pressure_unit: 'psi',
  altitude_unit: 'feet',
  place_radius_unit: 'feet',
  efficiency_display: 'distance_per_energy',
};

export const METRIC_UNITS: UnitPreferences = {
  mode: 'metric',
  distance_unit: 'kilometers',
  speed_unit: 'kmh',
  temperature_unit: 'celsius',
  pressure_unit: 'kpa',
  altitude_unit: 'meters',
  place_radius_unit: 'meters',
  efficiency_display: 'distance_per_energy',
};

const UNIT_PREFERENCE_KEYS = Object.keys(IMPERIAL_UNITS) as Array<keyof UnitPreferences>;

export function sameUnitPreferences(left: UnitPreferences, right: UnitPreferences) {
  return UNIT_PREFERENCE_KEYS.every((key) => left[key] === right[key]);
}
