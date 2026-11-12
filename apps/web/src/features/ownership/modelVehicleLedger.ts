/** Per-vehicle cost ledger: running costs by period, one-time maintenance jumps, depreciation, and totals. */
import { DAYS_PER_MONTH, DAY_MS, YEAR_MS } from './modelConstants';
import { dueInPeriod, type ScheduleState } from './modelSchedules';
import type {
  LedgerMonth,
  LedgerPeriod,
  LedgerPoint,
  LedgerVehicle,
  OneTimeKind,
  VehicleLedger,
} from './modelTypes';

const ONE_TIME_ORDER: OneTimeKind[] = ['oil', 'brakes', 'tires', 'service'];

export function buildVehicleLedger(
  vehicle: LedgerVehicle,
  periods: LedgerPeriod[],
  startMs: number,
  /** What a rated kWh costs a comparison EV: the owner's rate, raised for real-world consumption. */
  electricityUsdPerKwh: number,
  ownEnergy: number[],
): VehicleLedger {
  const { costs } = vehicle;
  const anchor = vehicle.resaleAnchor ?? null;
  const valueAt = (ms: number) => {
    if (!anchor) {
      return vehicle.priceUsd * Math.pow(costs.annual_retention, (ms - startMs) / YEAR_MS);
    }
    // Past the entered value, keep depreciating from it.
    if (ms >= anchor.ms || anchor.ms <= startMs) {
      return anchor.valueUsd * Math.pow(costs.annual_retention, Math.max(0, ms - anchor.ms) / YEAR_MS);
    }
    // Before it, run from the purchase price to the entered value.
    const share = (ms - startMs) / (anchor.ms - startMs);
    return anchor.valueUsd > 0
      ? vehicle.priceUsd * Math.pow(anchor.valueUsd / vehicle.priceUsd, share)
      : vehicle.priceUsd * (1 - share);
  };
  const totals = {
    miles: 0,
    fuel: 0,
    oil: 0,
    oilCount: 0,
    brakes: 0,
    brakeCount: 0,
    tires: 0,
    tireCount: 0,
    service: 0,
    insurance: 0,
  };
  let running = 0;
  const point = (t: number): LedgerPoint => ({
    t,
    spent: vehicle.priceUsd + running,
    net: vehicle.priceUsd - valueAt(t) + running,
  });
  const points: LedgerPoint[] = [point(startMs)];
  const atPeriodEnd: LedgerPoint[] = [point(startMs)];
  const months: LedgerMonth[] = [];
  const schedule: ScheduleState[] = costs.maintenance.map((item) => ({ item, lastMiles: 0, lastMs: startMs }));

  periods.forEach((period, index) => {
    const milesBefore = totals.miles;
    const milesAfter = milesBefore + period.miles;

    let fuel: number;
    if (vehicle.isOwn) {
      fuel = ownEnergy[index] ?? 0;
    } else if (vehicle.powertrain === 'ev') {
      fuel = period.miles * (vehicle.kwhPerMi ?? 0) * electricityUsdPerKwh;
    } else {
      const price = vehicle.premiumFuel ? period.gasPremiumUsd : period.gasRegularUsd;
      fuel = vehicle.mpg ? (period.miles / vehicle.mpg) * price : 0;
    }
    const insurance =
      costs.insurance_monthly_usd * ((period.endMs - period.startMs) / DAY_MS / DAYS_PER_MONTH);

    // Costs that accrue across the period.
    totals.miles = milesAfter;
    totals.fuel += fuel;
    totals.insurance += insurance;
    running += fuel + insurance;
    points.push(point(period.endMs));

    // Costs that land all at once, grouped by breakdown column.
    const byKind = new Map<OneTimeKind, LedgerMonth['oneTime'][number]>();
    for (const { item, count } of dueInPeriod(schedule, period, milesBefore)) {
      const entry = byKind.get(item.category) ?? { kind: item.category, count: 0, usd: 0, labels: [] };
      entry.count += count;
      entry.usd += count * item.cost_usd;
      entry.labels.push(count > 1 ? `${item.label} ×${count}` : item.label);
      byKind.set(item.category, entry);
    }
    const oneTime = ONE_TIME_ORDER.flatMap((kind) => {
      const entry = byKind.get(kind);
      return entry && entry.usd > 0 ? [entry] : [];
    });
    const events = oneTime.reduce((sum, entry) => sum + entry.usd, 0);
    months.push({ fuel, insurance, oneTime });
    for (const entry of oneTime) {
      if (entry.kind === 'oil') {
        totals.oil += entry.usd;
        totals.oilCount += entry.count;
      } else if (entry.kind === 'brakes') {
        totals.brakes += entry.usd;
        totals.brakeCount += entry.count;
      } else if (entry.kind === 'tires') {
        totals.tires += entry.usd;
        totals.tireCount += entry.count;
      } else {
        totals.service += entry.usd;
      }
    }
    if (events > 0) {
      running += events;
      points.push(point(period.endMs));
    }
    atPeriodEnd.push(point(period.endMs));
  });

  const last = atPeriodEnd[atPeriodEnd.length - 1] as LedgerPoint;
  const resaleValue = vehicle.priceUsd + running - last.net;
  return {
    vehicle,
    months,
    points,
    atPeriodEnd,
    totals: {
      ...totals,
      depreciation: vehicle.priceUsd - resaleValue,
      spent: last.spent,
      net: last.net,
      resaleValue,
      netPerMile: totals.miles > 0 ? last.net / totals.miles : null,
    },
  };
}
