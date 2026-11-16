/** Maintenance schedule math: which schedule applies, and when each item falls due. */
import type { OwnershipMaintenanceItem, OwnershipPowertrain, OwnershipResponse } from '@riviamigo/types';
import { OWN_SCHEDULE_KEY } from './modelConstants';
import { addMonths } from './modelDates';
import { normalizeOwnershipResponse } from './modelNormalize';
import type { ScheduleTarget } from './modelTypes';

/** The schedule the owner saved for a vehicle, or its built-in one. */
export function scheduleFor(
  data: OwnershipResponse,
  key: string,
  builtIn: OwnershipMaintenanceItem[],
): OwnershipMaintenanceItem[] {
  return data.settings.maintenance?.[key] ?? builtIn;
}

/** Built-in schedule of the tracked vehicle, with the owner's tire price applied. */
export function ownBuiltInSchedule(data: OwnershipResponse): OwnershipMaintenanceItem[] {
  const tirePrice = data.settings.tire_set_cost_usd;
  return data.own_defaults.maintenance.map((item) =>
    item.category === 'tires' && tirePrice != null ? { ...item, cost_usd: tirePrice } : item,
  );
}

/** Every vehicle whose maintenance schedule the owner can edit, tracked vehicle first. */
export function scheduleTargets(input: OwnershipResponse, ownLabel: string): ScheduleTarget[] {
  const data = normalizeOwnershipResponse(input);
  const target = (
    key: string,
    label: string,
    powertrain: OwnershipPowertrain,
    builtIn: OwnershipMaintenanceItem[],
  ): ScheduleTarget => ({
    key,
    label,
    powertrain,
    builtIn,
    schedule: scheduleFor(data, key, builtIn),
    edited: data.settings.maintenance?.[key] != null,
  });
  return [
    target(OWN_SCHEDULE_KEY, ownLabel, 'ev', ownBuiltInSchedule(data)),
    ...data.reference_vehicles.map((vehicle) =>
      target(vehicle.id, vehicle.label, vehicle.powertrain, vehicle.maintenance),
    ),
    ...data.settings.comparisons.custom.map((vehicle) =>
      target(vehicle.id, vehicle.label, vehicle.powertrain, data.class_defaults[vehicle.powertrain].maintenance),
    ),
  ];
}

/** How many times a recurring item falls due while a counter advances. */
export interface ScheduleState {
  item: OwnershipMaintenanceItem;
  /** Odometer and time when the item was last done; the purchase counts as done. */
  lastMiles: number;
  lastMs: number;
}

/**
 * Times each item falls due within one period. An item is due at its mileage
 * interval or its time interval since it was last done, whichever comes
 * first; miles are spread evenly across the period to place each event.
 */
export function dueInPeriod(
  states: ScheduleState[],
  period: { startMs: number; endMs: number; miles: number },
  milesBefore: number,
): Array<{ item: OwnershipMaintenanceItem; count: number }> {
  const span = Math.max(1, period.endMs - period.startMs);
  const milesAt = (ms: number) => milesBefore + period.miles * Math.min(1, Math.max(0, (ms - period.startMs) / span));
  const timeAtMiles = (miles: number) =>
    period.miles > 0 ? period.startMs + ((miles - milesBefore) / period.miles) * span : Number.POSITIVE_INFINITY;
  const due: Array<{ item: OwnershipMaintenanceItem; count: number }> = [];
  for (const state of states) {
    const { item } = state;
    let count = 0;
    // Bounded so a nonsense interval can never hang the page.
    for (let guard = 0; guard < 120; guard += 1) {
      const byMiles = item.interval_mi ? timeAtMiles(state.lastMiles + item.interval_mi) : Number.POSITIVE_INFINITY;
      const byTime = item.interval_months ? addMonths(state.lastMs, item.interval_months) : Number.POSITIVE_INFINITY;
      const at = Math.min(byMiles, byTime);
      if (!(at <= period.endMs)) break;
      const when = Math.max(at, period.startMs);
      state.lastMiles = byMiles <= byTime && item.interval_mi ? state.lastMiles + item.interval_mi : milesAt(when);
      state.lastMs = when;
      count += 1;
    }
    if (count > 0) due.push({ item, count });
  }
  return due;
}
