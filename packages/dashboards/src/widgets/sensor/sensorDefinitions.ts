import type { MiniSparklineType } from '@riviamigo/ui/charts';
import type { TimeframeScope } from '@riviamigo/types';

/** Iconify-style id (e.g. "lucide:battery") OR legacy short key (resolved at render time). */
export type SensorIconKey = string;

/** Background-graph mode. `daily_delta` renders per-day change for cumulative metrics. */
export type SensorChartType = MiniSparklineType | 'daily_delta' | 'none';
export type SensorDataSource = 'metric' | 'batteryHealth' | 'chargingSummary' | 'efficiencySummary' | 'vehicleStatus';
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
  helpText?: string;
  labelSuffix?: string;
  valueColor?: SensorValueColor;
  accent?: boolean;
  timeframeScope?: TimeframeScope;
  /** Cumulative metrics (always-rising) auto-default to daily-delta sprite. */
  cumulative?: boolean;
}

export const SENSOR_DEFINITIONS: SensorDefinition[] = [
  { id: 'total_miles', title: 'Total Miles', metric: 'total_miles', icon: 'lucide:route', chartType: 'daily_delta', valueMode: 'latest', accent: true, cumulative: true },
  { id: 'total_trips', title: 'Total Trips', metric: 'total_trips', icon: 'lucide:calendar-days', chartType: 'daily_delta', valueMode: 'latest', cumulative: true },
  { id: 'energy_charged', title: 'Energy Charged', metric: 'energy_charged', icon: 'lucide:bolt', chartType: 'daily_delta', valueMode: 'latest', cumulative: true },
  { id: 'avg_efficiency', title: 'Avg Consumption', metric: 'avg_efficiency', icon: 'lucide:gauge', chartType: 'line', valueMode: 'latest', helpText: 'Total estimated battery energy used ÷ miles driven, distance-weighted for the selected range.' },
  { id: 'avg_gross_efficiency', title: 'Avg Consumption (gross)', metric: 'avg_gross_efficiency', icon: 'lucide:zap', chartType: 'line', valueMode: 'latest' },
  { id: 'efficiency_coverage', title: 'Consumption Data Coverage', dataSource: 'efficiencySummary', valuePath: 'coverage_percent', unit: '%', inlineSecondaryTemplate: '[efficiency_miles:mi] / [total_miles:mi]', icon: 'lucide:database-zap', chartType: 'none', valueMode: 'latest', valueColor: 'default', helpText: 'Share of miles in this range with enough battery data to calculate average consumption. Trips without a consumption estimate are excluded from that average.' },
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
  { id: 'battery_health_pct', title: 'Battery Health', dataSource: 'batteryHealth', valuePath: 'battery_health_pct', unit: '%', icon: 'lucide:shield-check', chartType: 'none', valueMode: 'latest', accent: true, valueColor: 'accent', timeframeScope: 'current' },
  { id: 'estimated_degradation_pct', title: 'Estimated Degradation', dataSource: 'batteryHealth', valuePath: 'estimated_degradation_pct', unit: '%', icon: 'lucide:trending-down', chartType: 'none', valueMode: 'latest', valueColor: 'default', timeframeScope: 'current' },
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
    timeframeScope: 'current',
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
    timeframeScope: 'current',
  },
  { id: 'charge_count', title: 'Charges', dataSource: 'batteryHealth', valuePath: 'charge_count', inlineSecondaryTemplate: '([charging_cycles:int] cycles)', icon: 'lucide:refresh-cw', chartType: 'none', valueMode: 'latest', valueColor: 'default', timeframeScope: 'lifetime' },
  { id: 'charging_cycles_health', title: 'Charging Cycles', dataSource: 'batteryHealth', valuePath: 'charging_cycles', fallbackValuePath: 'charge_count', icon: 'lucide:refresh-ccw', chartType: 'none', valueMode: 'latest', valueColor: 'default', timeframeScope: 'lifetime' },
  { id: 'battery_energy_added', title: 'Energy Added', dataSource: 'batteryHealth', valuePath: 'total_energy_added_kwh', unit: 'kWh', icon: 'lucide:bolt', chartType: 'none', valueMode: 'latest', valueColor: 'default', timeframeScope: 'lifetime' },
  { id: 'battery_charge_efficiency', title: 'Charge Efficiency', dataSource: 'batteryHealth', valuePath: 'charging_efficiency_pct', unit: '%', icon: 'lucide:zap', chartType: 'none', valueMode: 'latest', valueColor: 'default', timeframeScope: 'lifetime' },
  { id: 'charging_sessions_summary', title: 'Sessions', dataSource: 'chargingSummary', valuePath: 'session_count', icon: 'lucide:calendar-days', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_total_energy', title: 'Total Energy', dataSource: 'chargingSummary', valuePath: 'total_energy_kwh', unit: 'kWh', icon: 'lucide:bolt', chartType: 'none', valueMode: 'latest', accent: true, valueColor: 'accent' },
  { id: 'charging_total_cost', title: 'Total Cost', dataSource: 'chargingSummary', valuePath: 'total_cost_usd', unit: 'USD', icon: 'lucide:dollar-sign', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_avg_session', title: 'Avg / Session', dataSource: 'chargingSummary', valueFormula: '[total_energy_kwh] / [session_count]', unit: 'kWh', icon: 'lucide:zap', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_cycles_summary', title: 'Charges', dataSource: 'chargingSummary', valuePath: 'session_count', secondaryTemplate: '[charging_cycles:int] cycles', icon: 'lucide:refresh-cw', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_efficiency_summary', title: 'Charge Efficiency', dataSource: 'chargingSummary', valuePath: 'charging_efficiency_pct', unit: '%', icon: 'lucide:activity', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_max_rate', title: 'Max Charge Rate', dataSource: 'chargingSummary', valuePath: 'max_charge_rate_kw', unit: 'kW', icon: 'lucide:gauge', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_max_limit', title: 'Max Charge Limit', dataSource: 'chargingSummary', valuePath: 'max_charge_limit_pct', unit: '%', icon: 'lucide:battery', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  // Enrichment sensors (require Rivian API backfill — from migration 0024)
  { id: 'charging_free_sessions', title: 'Free Sessions', dataSource: 'chargingSummary', valuePath: 'free_session_count', icon: 'lucide:gift', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_range_added', title: 'Range Added', dataSource: 'chargingSummary', valuePath: 'total_range_added_km', unit: 'km', icon: 'lucide:route', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charging_rivian_billed', title: 'Rivian Billed', dataSource: 'chargingSummary', valuePath: 'rivian_paid_total_usd', unit: 'USD', icon: 'lucide:receipt', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  {
    id: 'charging_home_share',
    title: 'Home Charging',
    dataSource: 'chargingSummary',
    valueFormula: '([home_kwh] / ([home_kwh] + [away_kwh_including_unknown])) * 100',
    unit: '%',
    secondaryTemplate: 'Home [home_kwh:kWh] / Away [away_kwh_including_unknown:kWh]',
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

  // ── Vehicle status sensors sourced from telemetry (warnings / OTA) ─────────
  { id: 'hv_thermal', title: 'HV Thermal', dataSource: 'vehicleStatus', valuePath: 'hv_thermal_event', icon: 'lucide:flame', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'twelve_volt_health', title: '12V Health', dataSource: 'vehicleStatus', valuePath: 'twelve_volt_health', icon: 'lucide:battery-low', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'ota_current_version', title: 'Current SW', dataSource: 'vehicleStatus', valuePath: 'ota_current_version', icon: 'lucide:cpu', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'ota_available_version', title: 'Available Update', dataSource: 'vehicleStatus', valuePath: 'ota_available_version', icon: 'lucide:download', chartType: 'none', valueMode: 'latest', valueColor: 'default' },

  // ── Extended vehicle state sensors (all dataSource: 'vehicleStatus') ──────
  { id: 'charge_port_open', title: 'Charge Port', dataSource: 'vehicleStatus', valuePath: 'charge_port_open', icon: 'lucide:plug', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'charger_derate_active', title: 'Charger Derate', dataSource: 'vehicleStatus', valuePath: 'charger_derate_active', icon: 'lucide:thermometer', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  {
    id: 'cabin_precon',
    title: 'Cabin Precon',
    dataSource: 'vehicleStatus',
    valuePath: 'cabin_precon_status',
    secondaryTemplate: '[cabin_precon_type]',
    icon: 'lucide:wind',
    chartType: 'none',
    valueMode: 'latest',
    valueColor: 'default',
  },
  { id: 'defrost_active', title: 'Defrost', dataSource: 'vehicleStatus', valuePath: 'defrost_active', icon: 'lucide:snowflake', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'pet_mode', title: 'Pet Mode', dataSource: 'vehicleStatus', valuePath: 'pet_mode_active', secondaryTemplate: 'temp ok: [pet_mode_temp_ok]', icon: 'lucide:paw-print', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'seat_fl_heat', title: 'Seat FL Heat', dataSource: 'vehicleStatus', valuePath: 'seat_fl_heat', icon: 'lucide:armchair', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'seat_fr_heat', title: 'Seat FR Heat', dataSource: 'vehicleStatus', valuePath: 'seat_fr_heat', icon: 'lucide:armchair', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'seat_rl_heat', title: 'Seat RL Heat', dataSource: 'vehicleStatus', valuePath: 'seat_rl_heat', icon: 'lucide:armchair', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'seat_rr_heat', title: 'Seat RR Heat', dataSource: 'vehicleStatus', valuePath: 'seat_rr_heat', icon: 'lucide:armchair', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'seat_fl_vent', title: 'Seat FL Vent', dataSource: 'vehicleStatus', valuePath: 'seat_fl_vent', icon: 'lucide:wind', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'seat_fr_vent', title: 'Seat FR Vent', dataSource: 'vehicleStatus', valuePath: 'seat_fr_vent', icon: 'lucide:wind', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'steering_wheel_heat', title: 'Wheel Heat', dataSource: 'vehicleStatus', valuePath: 'steering_wheel_heat', icon: 'lucide:circle-dot', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'tonneau_status', title: 'Tonneau', dataSource: 'vehicleStatus', valuePath: 'tonneau_closed', secondaryTemplate: 'locked: [tonneau_locked]', icon: 'lucide:package', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'gear_guard_locked', title: 'Gear Guard', dataSource: 'vehicleStatus', valuePath: 'gear_guard_locked', secondaryTemplate: '[gear_guard_video_status]', icon: 'lucide:shield', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'brake_fluid_warning', title: 'Brake Fluid', dataSource: 'vehicleStatus', valuePath: 'brake_fluid_low', icon: 'lucide:alert-triangle', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'wiper_fluid_warning', title: 'Wiper Fluid', dataSource: 'vehicleStatus', valuePath: 'wiper_fluid_low', icon: 'lucide:droplets', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'alarm_status', title: 'Alarm', dataSource: 'vehicleStatus', valuePath: 'alarm_active', icon: 'lucide:bell', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  { id: 'service_mode', title: 'Service Mode', dataSource: 'vehicleStatus', valuePath: 'service_mode', icon: 'lucide:wrench', chartType: 'none', valueMode: 'latest', valueColor: 'default' },
  {
    id: 'window_status',
    title: 'Windows',
    dataSource: 'vehicleStatus',
    valuePath: 'window_fl_closed',
    secondaryTemplate: 'FR: [window_fr_closed] RL: [window_rl_closed] RR: [window_rr_closed]',
    icon: 'lucide:square',
    chartType: 'none',
    valueMode: 'latest',
    valueColor: 'default',
  },
];

const definitionById = new Map(SENSOR_DEFINITIONS.map((definition) => [definition.id, definition]));

export function getSensorDefinition(id: string | null | undefined) {
  return id ? definitionById.get(id) : undefined;
}
