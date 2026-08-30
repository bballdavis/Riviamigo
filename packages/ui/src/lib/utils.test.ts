// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatDistanceKm,
  formatEfficiencyFromWhPerKm,
  formatMassKg,
  setEfficiencyDisplay,
  setUnitPreferences,
} from './utils';

const imperialPreferences = {
  mode: 'imperial' as const,
  distance_unit: 'miles' as const,
  speed_unit: 'mph' as const,
  temperature_unit: 'fahrenheit' as const,
  pressure_unit: 'psi' as const,
  altitude_unit: 'feet' as const,
  place_radius_unit: 'feet' as const,
  efficiency_display: 'distance_per_energy' as const,
};

beforeEach(() => {
  window.localStorage.clear();
  setUnitPreferences(imperialPreferences, { suppressEvent: true });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('formatDistanceKm', () => {
  it('formats stored kilometer values in miles for imperial preferences', () => {
    expect(formatDistanceKm(88.4)).toBe('55 mi');
  });

  it('formats stored kilometer values in kilometers for metric preferences', () => {
    setUnitPreferences({ ...imperialPreferences, mode: 'metric', distance_unit: 'kilometers' }, { suppressEvent: true });
    expect(formatDistanceKm(88.4)).toBe('88.4 km');
  });

  it('returns a placeholder for missing or invalid values', () => {
    expect(formatDistanceKm(null)).toBe('-');
    expect(formatDistanceKm(undefined)).toBe('-');
    expect(formatDistanceKm(Number.NaN)).toBe('-');
  });
});

describe('extended telemetry unit formatting', () => {
  it('formats Wh/km using the selected efficiency display', () => {
    expect(formatEfficiencyFromWhPerKm(248)).toBe('2.5 mi/kWh');

    setEfficiencyDisplay('energy_per_distance');
    expect(formatEfficiencyFromWhPerKm(248)).toBe('399 Wh/mi');

    setUnitPreferences({ ...imperialPreferences, mode: 'metric', distance_unit: 'kilometers' }, { suppressEvent: true });
    setEfficiencyDisplay('distance_per_energy');
    expect(formatEfficiencyFromWhPerKm(248)).toBe('4.0 km/kWh');
  });

  it('formats vehicle mass using the selected unit system', () => {
    expect(formatMassKg(3160)).toBe('6,967 lb');

    setUnitPreferences({ ...imperialPreferences, mode: 'metric', distance_unit: 'kilometers' }, { suppressEvent: true });
    expect(formatMassKg(3160)).toBe('3,160 kg');
  });
});
