/** Which vehicles can be compared, and what each one is priced and driven as. */
import type { OwnershipCostAssumptions, OwnershipCustomVehicle, OwnershipResponse } from '@riviamigo/types';
import { normalizeOwnershipResponse } from './modelNormalize';
import { scheduleFor } from './modelSchedules';
import type { LedgerVehicle } from './modelTypes';

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

export function isComparisonEnabled(input: OwnershipResponse, id: string): boolean {
  const data = normalizeOwnershipResponse(input);
  const enabled = data.settings.comparisons.enabled;
  if (enabled) return enabled.includes(id);
  const reference = data.reference_vehicles.find((vehicle) => vehicle.id === id);
  // A vehicle the user added is on until they turn it off.
  return reference ? reference.default_enabled : true;
}

/** Ids currently enabled, in a form ready to store. */
export function enabledComparisonIds(input: OwnershipResponse): string[] {
  const data = normalizeOwnershipResponse(input);
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
export function comparisonVehicles(input: OwnershipResponse): LedgerVehicle[] {
  const data = normalizeOwnershipResponse(input);
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
    costs: { ...vehicle, maintenance: scheduleFor(data, vehicle.id, vehicle.maintenance) },
  }));
  const custom = data.settings.comparisons.custom.map((vehicle) => {
    const defaults = data.class_defaults[vehicle.powertrain];
    return customVehicle(vehicle, {
      ...defaults,
      maintenance: scheduleFor(data, vehicle.id, defaults.maintenance),
    });
  });
  return [...references, ...custom];
}
