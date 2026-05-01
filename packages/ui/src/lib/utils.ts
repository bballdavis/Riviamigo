import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type UnitSystem = 'imperial' | 'metric';

const UNIT_SYSTEM_STORAGE_KEY = 'rm-units';
const MILES_TO_KM = 1.609344;
const MPH_TO_KMH = 1.609344;
const METERS_TO_FEET = 3.28084;
const PSI_TO_KPA = 6.894757293168361;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getUnitSystem(): UnitSystem {
  if (typeof window === 'undefined') return 'imperial';

  try {
    const stored = window.localStorage.getItem(UNIT_SYSTEM_STORAGE_KEY);
    return stored === 'metric' ? 'metric' : 'imperial';
  } catch {
    return 'imperial';
  }
}

export function setUnitSystem(system: UnitSystem) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(UNIT_SYSTEM_STORAGE_KEY, system);
    window.dispatchEvent(new Event('rm-units-change'));
  } catch {
    // Ignore storage errors; formatting still falls back to imperial.
  }
}

export function formatNumber(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';

  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatMiles(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';

  if (getUnitSystem() === 'metric') {
    return `${formatNumber(value * MILES_TO_KM, 1)} km`;
  }
  return `${formatNumber(value, 0)} mi`;
}

export function formatPercent(value: number, decimals = 0): string {
  return `${formatNumber(value, decimals)}%`;
}

export function formatKwh(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';

  return `${formatNumber(value, 1)} kWh`;
}

export function formatMph(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';

  if (getUnitSystem() === 'metric') {
    return `${formatNumber(value * MPH_TO_KMH, 0)} km/h`;
  }
  return `${formatNumber(value, 0)} mph`;
}

export function formatEfficiency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';

  if (getUnitSystem() === 'metric') {
    return `${formatNumber(value / MILES_TO_KM, 0)} Wh/km`;
  }
  return `${formatNumber(value, 0)} Wh/mi`;
}

export function formatPressure(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';

  if (getUnitSystem() === 'metric') {
    return `${formatNumber(value * PSI_TO_KPA, 0)} kPa`;
  }
  return `${formatNumber(value, 0)} psi`;
}

export function formatAltitude(valueMeters: number | null | undefined): string {
  if (valueMeters === null || valueMeters === undefined || Number.isNaN(valueMeters)) return '-';

  if (getUnitSystem() === 'metric') {
    return `${formatNumber(valueMeters, 0)} m`;
  }
  return `${formatNumber(valueMeters * METERS_TO_FEET, 0)} ft`;
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';

  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatTemp(celsius: number | null | undefined): string {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) return '-';

  if (getUnitSystem() === 'metric') {
    return `${Math.round(celsius)} C`;
  }
  return `${Math.round(celsius * 9 / 5 + 32)} F`;
}
