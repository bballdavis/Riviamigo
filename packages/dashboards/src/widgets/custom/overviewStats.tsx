import React from 'react';
import { Compass, Cpu, Gauge, MapPin, Power, Route, Thermometer, Car, CircleGauge, BatteryCharging, BatteryFull, Plug, Timer, Lock, DoorOpen } from 'lucide-react';
import { formatDriveMode } from '@riviamigo/ui/lib/driveMode';
import { formatAltitude, formatDuration, formatMiles, formatMph, formatTemp } from '@riviamigo/ui/lib/utils';
import { formatTireLabel } from '@riviamigo/ui/lib/vehicleTires';
import type { MetricCatalogEntry, VehicleStatus } from '@riviamigo/types';
import { SENSOR_DEFINITIONS, type SensorDefinition } from '../sensor/sensorDefinitions';

/** Number of stat rows the Vehicle Overview widget shows beside the vehicle art. */
export const OVERVIEW_STAT_SLOT_COUNT = 5;

export interface OverviewStatDefinition {
  id: string;
  label: string;
  /** Longer name used in the editor picker. */
  description: string;
  icon: (props: { className?: string; style?: React.CSSProperties }) => React.ReactElement;
  format: (status: VehicleStatus | null | undefined) => React.ReactNode;
}

function icon(Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>, color: string) {
  return function StatIcon({ className = 'h-3.5 w-3.5', style }: { className?: string; style?: React.CSSProperties }) {
    return <Icon className={className} style={{ color, ...style }} />;
  };
}

export const OVERVIEW_STAT_DEFINITIONS: readonly OverviewStatDefinition[] = [
  { id: 'driver_mode', label: 'Driver mode', description: 'Driver mode', icon: icon(Car, 'var(--rm-dm-everyday)'), format: (s) => renderDriverMode(s?.drive_mode, s?.gear_status) },
  { id: 'altitude', label: 'Altitude', description: 'Altitude', icon: icon(MapPin, 'var(--rm-chart-teal)'), format: (s) => formatAltitude(s?.altitude_m) },
  { id: 'cabin_temp', label: 'Cabin', description: 'Cabin temperature', icon: icon(Thermometer, 'var(--rm-chart-sky)'), format: (s) => formatTemp(s?.cabin_temp_c) },
  { id: 'speed', label: 'Speed', description: 'Speed', icon: icon(Gauge, 'var(--rm-chart-sky)'), format: (s) => formatMph(s?.speed_mph) },
  { id: 'software', label: 'Software', description: 'Software update status', icon: icon(Cpu, 'var(--rm-status-positive)'), format: (s) => formatSoftware(s) },
  { id: 'outside_temp', label: 'Outside', description: 'Outside temperature', icon: icon(Thermometer, 'var(--rm-chart-amber)'), format: (s) => formatTemp(s?.outside_temp_c) },
  { id: 'driver_temp', label: 'Driver zone', description: 'Driver zone temperature', icon: icon(Thermometer, 'var(--rm-chart-orange)'), format: (s) => formatTemp(s?.driver_temp_c) },
  { id: 'odometer', label: 'Odometer', description: 'Odometer', icon: icon(Route, 'var(--rm-chart-violet)'), format: (s) => formatMiles(s?.odometer_miles) },
  { id: 'power_state', label: 'Power', description: 'Power state', icon: icon(Power, 'var(--rm-chart-emerald)'), format: (s) => prettify(s?.power_state) },
  { id: 'heading', label: 'Heading', description: 'Compass heading', icon: icon(Compass, 'var(--rm-chart-teal)'), format: (s) => formatHeading(s?.heading_deg) },
  { id: 'tire_min', label: 'Lowest tire', description: 'Lowest tire pressure', icon: icon(CircleGauge, 'var(--rm-chart-amber)'), format: (s) => formatTireLabel(s?.tire_min_psi) },
  { id: 'twelve_volt', label: '12V battery', description: '12V battery health', icon: icon(BatteryCharging, 'var(--rm-chart-rose)'), format: (s) => prettify(s?.twelve_volt_health) },
  { id: 'charge_limit', label: 'Charge limit', description: 'Charge limit', icon: icon(BatteryFull, 'var(--rm-chart-emerald)'), format: (s) => formatPercentValue(s?.battery_limit) },
  { id: 'charger_state', label: 'Charger', description: 'Charger state', icon: icon(Plug, 'var(--rm-chart-sky)'), format: (s) => prettify(s?.charger_state ?? s?.charger_status) },
  { id: 'time_to_full', label: 'Time to full', description: 'Time to end of charge', icon: icon(Timer, 'var(--rm-chart-amber)'), format: (s) => formatDuration(s?.time_to_end_of_charge_min) },
  { id: 'doors_locked', label: 'Doors', description: 'Door lock state', icon: icon(Lock, 'var(--rm-status-positive)'), format: (s) => formatDoorsLocked(s?.doors_locked) },
  { id: 'open_closures', label: 'Open', description: 'Open doors and closures', icon: icon(DoorOpen, 'var(--rm-chart-orange)'), format: (s) => formatOpenClosures(s?.open_closures) },
];

export const DEFAULT_OVERVIEW_STAT_IDS: readonly string[] = [
  'driver_mode',
  'altitude',
  'cabin_temp',
  'speed',
  'software',
];

const DEFINITIONS_BY_ID = new Map(OVERVIEW_STAT_DEFINITIONS.map((definition) => [definition.id, definition]));

/** Prefix for a stat row backed directly by a backend metric catalog entry. */
export const METRIC_STAT_PREFIX = 'metric:';

/**
 * Sensors whose reading the live-status rows above already present, so the
 * picker lists each of these once.
 */
const DUPLICATE_SENSOR_IDS: ReadonlySet<string> = new Set([
  'odometer_miles',
  'speed_mph',
  'outside_temp_c',
  'twelve_volt_health',
]);

const SENSORS_BY_ID = new Map<string, SensorDefinition>(
  SENSOR_DEFINITIONS.filter((definition) => !DUPLICATE_SENSOR_IDS.has(definition.id)).map((definition) => [definition.id, definition]),
);

/** Metric ids a sensor definition already presents, so the catalog does not list them twice. */
const SENSOR_METRIC_IDS: ReadonlySet<string> = new Set(
  SENSOR_DEFINITIONS.flatMap((definition) => (definition.metric ? [definition.metric] : [])),
);

export function metricStatId(metric: string) {
  return `${METRIC_STAT_PREFIX}${metric}`;
}

export function getOverviewSensorDefinition(id: string): SensorDefinition | undefined {
  return SENSORS_BY_ID.get(id);
}

/**
 * Whether `id` can fill a row: a live-status stat, any sensor, or a backend metric.
 * Metric ids are accepted by prefix because the metric catalog loads asynchronously;
 * one the backend no longer serves simply shows "-".
 */
export function isKnownOverviewStatId(id: string) {
  return DEFINITIONS_BY_ID.has(id)
    || SENSORS_BY_ID.has(id)
    || (id.startsWith(METRIC_STAT_PREFIX) && id.length > METRIC_STAT_PREFIX.length);
}

export interface OverviewStatOption {
  id: string;
  label: string;
  /** Section heading the picker lists this stat under. */
  group: string;
  /** Extra lowercase text the picker search matches against. */
  keywords: string;
}

const SENSOR_GROUP_BY_SOURCE: Record<NonNullable<SensorDefinition['dataSource']>, string> = {
  metric: 'Metrics',
  batteryHealth: 'Battery health',
  chargingSummary: 'Charging',
  efficiencySummary: 'Efficiency',
  vehicleStatus: 'Vehicle systems',
};

/**
 * Every stat that can fill an overview row: live vehicle state, every sensor chip,
 * and any metric the backend catalog serves that no sensor presents yet. New
 * sensors and backend metrics appear here without further wiring.
 */
export function getOverviewStatOptions(metricCatalog: readonly MetricCatalogEntry[] = []): OverviewStatOption[] {
  const options: OverviewStatOption[] = [];
  for (const definition of OVERVIEW_STAT_DEFINITIONS) {
    options.push({ id: definition.id, label: definition.description, group: 'Vehicle state', keywords: `${definition.label} ${definition.id}`.toLowerCase() });
  }
  for (const definition of SENSORS_BY_ID.values()) {
    options.push({
      id: definition.id,
      label: definition.title,
      group: SENSOR_GROUP_BY_SOURCE[definition.dataSource ?? 'metric'],
      keywords: `${definition.id} ${definition.metric ?? ''} ${definition.labelSuffix ?? ''}`.toLowerCase(),
    });
  }
  for (const entry of metricCatalog) {
    if (SENSOR_METRIC_IDS.has(entry.id)) continue;
    options.push({
      id: metricStatId(entry.id),
      label: entry.label,
      group: 'Metrics',
      keywords: `${entry.id} ${entry.kind} ${entry.source} ${entry.unit ?? ''}`.toLowerCase(),
    });
  }
  return options;
}

export function getOverviewStatDefinition(id: string): OverviewStatDefinition | undefined {
  return DEFINITIONS_BY_ID.get(id);
}

/**
 * Resolve the saved `stats` option to exactly {@link OVERVIEW_STAT_SLOT_COUNT} known,
 * unique stat ids. Unknown or duplicate entries fall back to the default for their slot
 * (or the next unused default), so a stale or hand-edited config can never blank a row.
 */
export function resolveOverviewStatIds(value: unknown): string[] {
  const saved = Array.isArray(value) ? value : [];
  const used = new Set<string>();
  const result: string[] = [];
  for (let slot = 0; slot < OVERVIEW_STAT_SLOT_COUNT; slot += 1) {
    const candidate = saved[slot];
    const id = typeof candidate === 'string' && isKnownOverviewStatId(candidate) && !used.has(candidate)
      ? candidate
      : undefined;
    if (id) {
      used.add(id);
      result[slot] = id;
    }
  }
  const fallbacks = [
    ...DEFAULT_OVERVIEW_STAT_IDS,
    ...OVERVIEW_STAT_DEFINITIONS.map((definition) => definition.id),
  ].filter((id) => !used.has(id));
  for (let slot = 0; slot < OVERVIEW_STAT_SLOT_COUNT; slot += 1) {
    if (result[slot]) continue;
    const preferred = DEFAULT_OVERVIEW_STAT_IDS[slot];
    const id = preferred && !used.has(preferred) ? preferred : fallbacks.find((entry) => !used.has(entry))!;
    used.add(id);
    result[slot] = id;
  }
  return result;
}

function formatPercentValue(value: number | null | undefined) {
  return value === null || value === undefined || Number.isNaN(value) ? '-' : `${Math.round(value)}%`;
}

function formatDoorsLocked(locked: boolean | null | undefined) {
  if (locked === null || locked === undefined) return '-';
  return locked ? 'Locked' : 'Unlocked';
}

function formatOpenClosures(closures: string[] | null | undefined) {
  if (!closures) return '-';
  if (closures.length === 0) return 'All closed';
  return closures.map((closure) => prettify(closure)).join(', ');
}

function renderDriverMode(driveMode: string | null | undefined, gearStatus: string | null | undefined) {
  const rawValue = driveMode ?? gearStatus;
  if (!rawValue) return '-';

  return formatDriveMode(rawValue);
}

function formatSoftware(status: VehicleStatus | null | undefined) {
  const otaStatus = status?.ota_status ?? status?.software_update_status ?? status?.ota_current_status;
  const available = status?.ota_available_version;
  const current = status?.ota_current_version;
  if (!otaStatus && !available && !current) return '-';
  if (!available || available === '0.0.0' || available === current) return 'Up to date';
  if (otaStatus && !['idle', 'unknown'].includes(otaStatus.toLowerCase())) return prettify(otaStatus);
  return `Available ${available}`;
}

function formatHeading(degrees: number | null | undefined) {
  if (degrees === null || degrees === undefined || Number.isNaN(degrees)) return '-';
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normalized = ((degrees % 360) + 360) % 360;
  return `${points[Math.round(normalized / 45) % 8]} ${Math.round(normalized)}°`;
}

function prettify(value: string | null | undefined) {
  if (!value) return '-';
  return value.replace(/^chrgr_sts_/, '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
