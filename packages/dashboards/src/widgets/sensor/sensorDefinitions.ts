import type { MiniSparklineType } from '@riviamigo/ui/charts';

export type SensorIconKey =
  | 'activity'
  | 'battery'
  | 'bolt'
  | 'calendar'
  | 'clock'
  | 'gauge'
  | 'map'
  | 'route'
  | 'thermometer'
  | 'zap';

export interface SensorDefinition {
  id: string;
  title: string;
  metric: string;
  icon: SensorIconKey;
  chartType: MiniSparklineType;
  valueMode: 'latest' | 'sum' | 'avg' | 'count';
  accent?: boolean;
}

export const SENSOR_DEFINITIONS: SensorDefinition[] = [
  { id: 'total_miles', title: 'Total Miles', metric: 'total_miles', icon: 'route', chartType: 'line', valueMode: 'latest', accent: true },
  { id: 'total_trips', title: 'Total Trips', metric: 'total_trips', icon: 'calendar', chartType: 'bar', valueMode: 'latest' },
  { id: 'energy_charged', title: 'Energy Charged', metric: 'energy_charged', icon: 'bolt', chartType: 'bar', valueMode: 'latest' },
  { id: 'avg_efficiency', title: 'Avg Efficiency', metric: 'avg_efficiency', icon: 'gauge', chartType: 'line', valueMode: 'latest' },
  { id: 'trip_miles', title: 'Miles Driven', metric: 'trip_miles', icon: 'map', chartType: 'line', valueMode: 'latest', accent: true },
  { id: 'avg_trip_duration', title: 'Avg Duration', metric: 'avg_trip_duration', icon: 'clock', chartType: 'bar', valueMode: 'latest' },
  { id: 'battery_level', title: 'Current SOC', metric: 'battery_level', icon: 'battery', chartType: 'area', valueMode: 'latest', accent: true },
  { id: 'range_miles', title: 'Estimated Range', metric: 'range_miles', icon: 'route', chartType: 'area', valueMode: 'latest' },
  { id: 'odometer_miles', title: 'Odometer', metric: 'odometer_miles', icon: 'route', chartType: 'line', valueMode: 'latest' },
  { id: 'outside_temp_c', title: 'Outside Temp', metric: 'outside_temp_c', icon: 'thermometer', chartType: 'line', valueMode: 'latest' },
  { id: 'speed_mph', title: 'Speed', metric: 'speed_mph', icon: 'gauge', chartType: 'line', valueMode: 'latest' },
  { id: 'power_kw', title: 'Power', metric: 'power_kw', icon: 'zap', chartType: 'line', valueMode: 'latest' },
  { id: 'charging_sessions', title: 'Charging Sessions', metric: 'charging_sessions', icon: 'calendar', chartType: 'bar', valueMode: 'latest' },
  { id: 'total_cost', title: 'Total Cost', metric: 'total_cost', icon: 'activity', chartType: 'bar', valueMode: 'latest' },
  { id: 'avg_session_energy', title: 'Avg Session', metric: 'avg_session_energy', icon: 'bolt', chartType: 'bar', valueMode: 'latest' },
];

const definitionById = new Map(SENSOR_DEFINITIONS.map((definition) => [definition.id, definition]));

export function getSensorDefinition(id: string | null | undefined) {
  return id ? definitionById.get(id) : undefined;
}
