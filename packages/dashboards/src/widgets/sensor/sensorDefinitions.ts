import type { MiniSparklineType } from '@riviamigo/ui/charts';

/** Iconify-style id (e.g. "lucide:battery") OR legacy short key (resolved at render time). */
export type SensorIconKey = string;

/** Background-graph mode. `daily_delta` renders per-day change for cumulative metrics. */
export type SensorChartType = MiniSparklineType | 'daily_delta';

export interface SensorDefinition {
  id: string;
  title: string;
  metric: string;
  icon: SensorIconKey;
  chartType: SensorChartType;
  valueMode: 'latest' | 'sum' | 'avg' | 'count';
  accent?: boolean;
  /** Cumulative metrics (always-rising) auto-default to daily-delta sprite. */
  cumulative?: boolean;
}

export const SENSOR_DEFINITIONS: SensorDefinition[] = [
  { id: 'total_miles', title: 'Total Miles', metric: 'total_miles', icon: 'lucide:route', chartType: 'daily_delta', valueMode: 'latest', accent: true, cumulative: true },
  { id: 'total_trips', title: 'Total Trips', metric: 'total_trips', icon: 'lucide:calendar-days', chartType: 'daily_delta', valueMode: 'latest', cumulative: true },
  { id: 'energy_charged', title: 'Energy Charged', metric: 'energy_charged', icon: 'lucide:bolt', chartType: 'daily_delta', valueMode: 'latest', cumulative: true },
  { id: 'avg_efficiency', title: 'Avg Efficiency', metric: 'avg_efficiency', icon: 'lucide:gauge', chartType: 'line', valueMode: 'latest' },
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
];

const definitionById = new Map(SENSOR_DEFINITIONS.map((definition) => [definition.id, definition]));

export function getSensorDefinition(id: string | null | undefined) {
  return id ? definitionById.get(id) : undefined;
}
