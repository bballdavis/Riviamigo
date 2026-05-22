import type { MiniSparklineType } from '@riviamigo/ui/charts';

/** Iconify-style id (e.g. "lucide:battery") OR legacy short key (resolved at render time). */
export type SensorIconKey = string;

/** Background-graph mode. `daily_delta` renders per-day change for cumulative metrics. */
export type SensorChartType = MiniSparklineType | 'daily_delta' | 'none';
export type SensorDataSource = 'metric' | 'batteryHealth' | 'chargingSummary' | 'vehicleStatus';
export type SensorValueColor = 'accent' | 'default';

export interface SensorDefinition {
  id: string;
  title: string;
  metric?: string;
  icon: SensorIconKey;
  chartType: SensorChartType;
  valueMode: 'latest' | 'sum' | 'avg' | 'count';
  dataSource?: SensorDataSource;
  valuePath?: string;
  fallbackValuePath?: string;
  valueFormula?: string;
  unit?: string | null;
  inlineSecondaryPath?: string;
  inlineSecondaryFormula?: string;
  inlineSecondaryTemplate?: string;
  inlineSecondaryUnit?: string | null;
  inlineSecondaryPrefix?: string;
  secondaryTemplate?: string;
  labelSuffix?: string;
  valueColor?: SensorValueColor;
  accent?: boolean;
  /** Cumulative metrics (always-rising) auto-default to daily-delta sprite. */
  cumulative?: boolean;
}

export const SENSOR_DEFINITIONS: SensorDefinition[] = [
  { id: 'total_miles', title: 'Total Miles', metric: 'total_miles', icon: 'lucide:route', chartType: 'daily_delta', valueMode: 'latest', accent: true, cumulative: true },
  { id: 'total_trips', title: 'Total Trips', metric: 'total_trips', icon: 'lucide:calendar-days', chartType: 'daily_delta', valueMode: 'latest', cumulative: true },
  { id: 'energy_charged', title: 'Energy Charged', metric: 'energy_charged', icon: 'lucide:bolt', chartType: 'daily_delta', valueMode: 'latest', cumulative: true },
  { id: 'avg_efficiency', title: 'Avg Efficiency', metric: 'avg_efficiency', icon: 'lucide:gauge', chartType: 'line', valueMode: 'latest' },
  { id: 'avg_gross_efficiency', title: 'Avg Consumption (gross)', metric: 'avg_gross_efficiency', icon: 'lucide:zap', chartType: 'line', valueMode: 'latest' },
  { id: 'avg_outside_temp_c', title: 'Avg Outside Temp', metric: 'avg_outside_temp_c', icon: 'lucide:thermometer', chartType: 'line', valueMode: 'latest' },
  { id: 'trip_miles', title: 'Miles Driven', metric: 'trip_miles', icon: 'lucide:map', chartType: 'line', valueMode: 'latest', accent: true },
  { id: 'avg_trip_duration', title: 'Avg Duration', metric: 'avg_trip_duration', icon: 'lucide:clock-3', chartType: 'bar', valueMode: 'latest' },
  { id: 'battery_level', title: 'Current SOC', metric: 'battery_level', icon: 'lucide:battery', chartType: 'area', valueMode: 'latest', accent: true },
  { id: 'range_miles', title: 'Estimated Range', metric: 'range_miles', icon: 'lucide:route', chartType: 'area', valueMode: 'latest' },
  { id: 'odometer_miles', title: 'Odometer', metric: 'odometer_miles', icon: 'lucide:route', chartType: 'daily_delta', valueMode: 'latest', cumulative: true },
  { id: 'outside_temp_c', title: 'Outside Temp', metric: 'outside_temp_c', icon: 'lucide:thermometer', chartType: 'line', valueMode: 'latest' },
  { id: 'speed_mph', title: 'Speed', metric: 'speed_mph', icon: 'lucide:gauge', chartType: 'line', valueMode: 'latest' },
  { id: 'power_kw', title: 'Power', metric: 'power_kw', icon: 'lucide:zap', chartType: 'line', valueMode: 'latest' },
  { id: 'charging_sessions', title: 'Charging Sessions', metric: 'charging_sessions', icon: 'lucide:calendar-days', chartType: 'bar', valueMode: 'latest' },
  { id: 'total_cost', title: 'Total Cost', metric: 'total_cost', icon: 'lucide:activity', chartType: 'daily_delta', valueMode: 'latest', cumulative: true },
  { id: 'avg_session_energy', title: 'Avg Session', metric: 'avg_session_energy', icon: 'lucide:bolt', chartType: 'bar', valueMode: 'latest' },
  { id: 'battery_health_pct', title: 'Battery Health', dataSource: 'batteryHealth', valuePath: 'battery_health_pct', unit: '%', icon: 'lucide:shield-check', chartType: 'none', valueMode: 'latest', accent: true, valueColor: 'accent' },
  { id: 'estimated_degradation_pct', title: 'Estimated Degradation', dataSource: 'batteryHealth', valuePath: 'estimated_degradation_pct', unit: '%', icon: 'lucide:trending-down', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  {
    id: 'usable_capacity',
    title: 'Usable Capacity',
    dataSource: 'batteryHealth',
    valuePath: 'usable_now_kwh',
    unit: 'kWh',
    inlineSecondaryPath: 'usable_new_kwh',
    inlineSecondaryUnit: 'kWh',
    inlineSecondaryPrefix: '/',
    labelSuffix: 'now/new',
    icon: 'lucide:battery',
    chartType: 'none',
    valueMode: 'latest',
    valueColor: 'default',
  },
  {
    id: 'max_range',
    title: 'Max Range',
    dataSource: 'batteryHealth',
    valueFormula: '([status.range_miles] / [status.battery_level]) * 100',
    unit: 'mi',
    inlineSecondaryFormula: '(([status.range_miles] / [status.battery_level]) * 100 / [battery_health_pct]) * 100',
    inlineSecondaryUnit: 'mi',
    inlineSecondaryPrefix: '/',
    labelSuffix: 'now/new',
    icon: 'lucide:route',
    chartType: 'none',
    valueMode: 'latest',
    valueColor: 'default',
  },
  { id: 'charge_count', title: 'Charges', dataSource: 'batteryHealth', valuePath: 'charge_count', secondaryTemplate: '[charging_cycles:int] cycles', icon: 'lucide:refresh-cw', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_cycles_health', title: 'Charging Cycles', dataSource: 'batteryHealth', valuePath: 'charging_cycles', fallbackValuePath: 'charge_count', icon: 'lucide:refresh-ccw', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'battery_energy_added', title: 'Energy Added', dataSource: 'batteryHealth', valuePath: 'total_energy_added_kwh', unit: 'kWh', icon: 'lucide:bolt', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'battery_charge_efficiency', title: 'Charge Efficiency', dataSource: 'batteryHealth', valuePath: 'charging_efficiency_pct', unit: '%', icon: 'lucide:zap', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_sessions_summary', title: 'Sessions', dataSource: 'chargingSummary', valuePath: 'session_count', icon: 'lucide:calendar-days', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_total_energy', title: 'Total Energy', dataSource: 'chargingSummary', valuePath: 'total_energy_kwh', unit: 'kWh', icon: 'lucide:bolt', chartType: 'none', valueMode: 'latest', accent: true, valueColor: 'accent' },
  { id: 'charging_total_cost', title: 'Total Cost', dataSource: 'chargingSummary', valuePath: 'total_cost_usd', unit: 'USD', icon: 'lucide:dollar-sign', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_avg_session', title: 'Avg / Session', dataSource: 'chargingSummary', valueFormula: '[total_energy_kwh] / [session_count]', unit: 'kWh', icon: 'lucide:zap', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_cycles_summary', title: 'Charges', dataSource: 'chargingSummary', valuePath: 'session_count', secondaryTemplate: '[charging_cycles:int] cycles', icon: 'lucide:refresh-cw', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_efficiency_summary', title: 'Charge Efficiency', dataSource: 'chargingSummary', valuePath: 'charging_efficiency_pct', unit: '%', icon: 'lucide:activity', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_max_rate', title: 'Max Charge Rate', dataSource: 'chargingSummary', valuePath: 'max_charge_rate_kw', unit: 'kW', icon: 'lucide:gauge', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_max_limit', title: 'Max Charge Limit', dataSource: 'chargingSummary', valuePath: 'max_charge_limit_pct', unit: '%', icon: 'lucide:battery', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  {
    id: 'charging_home_share',
    title: 'Home Charging',
    dataSource: 'chargingSummary',
    valueFormula: '([home_kwh] / [total_energy_kwh]) * 100',
    unit: '%',
    secondaryTemplate: 'Home [home_kwh:kWh] / Away [away_kwh:kWh]',
    icon: 'lucide:home',
    chartType: 'none',
    valueMode: 'latest',
    valueColor: 'default',
  },
  {
    id: 'charging_dc_share',
    title: 'DC Fast Charging',
    dataSource: 'chargingSummary',
    valueFormula: '([dc_kwh] / [total_energy_kwh]) * 100',
    unit: '%',
    secondaryTemplate: 'AC [ac_kwh:kWh] / DC [dc_kwh:kWh]',
    icon: 'lucide:plug-zap',
    chartType: 'none',
    valueMode: 'latest',
    valueColor: 'default',
  },
];

const definitionById = new Map(SENSOR_DEFINITIONS.map((definition) => [definition.id, definition]));

export function getSensorDefinition(id: string | null | undefined) {
  return id ? definitionById.get(id) : undefined;
}
