/** Cost-table columns and the maintenance subset, shared by the desktop table and the maintenance tile. */
import type { VehicleLedger } from './model';

export interface CostColumn {
  key: string;
  label: string;
  value: (entry: VehicleLedger) => number;
  count?: (entry: VehicleLedger) => number;
  /** Hidden from a vehicle's chips when it never applies, such as oil for an EV. */
  optional?: boolean;
}

export const COST_COLUMNS: CostColumn[] = [
  { key: 'depreciation', label: 'Depreciation', value: (entry) => entry.totals.depreciation },
  { key: 'fuel', label: 'Fuel or energy', value: (entry) => entry.totals.fuel },
  {
    key: 'oil',
    label: 'Oil changes',
    value: (entry) => entry.totals.oil,
    count: (entry) => entry.totals.oilCount,
    optional: true,
  },
  { key: 'brakes', label: 'Brakes', value: (entry) => entry.totals.brakes, count: (entry) => entry.totals.brakeCount },
  { key: 'tires', label: 'Tires', value: (entry) => entry.totals.tires, count: (entry) => entry.totals.tireCount },
  { key: 'service', label: 'Service', value: (entry) => entry.totals.service },
  { key: 'insurance', label: 'Insurance', value: (entry) => entry.totals.insurance },
];

export const MAINTENANCE_ITEMS = COST_COLUMNS.filter((column) => ['oil', 'brakes', 'tires', 'service'].includes(column.key));
