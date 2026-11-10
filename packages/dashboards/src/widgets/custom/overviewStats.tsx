import React from 'react';
import { Compass, Cpu, Gauge, MapPin, Power, Route, Thermometer, Car, CircleGauge, BatteryCharging } from 'lucide-react';
import { formatDriveMode } from '@riviamigo/ui/lib/driveMode';
import { formatAltitude, formatMiles, formatMph, formatTemp } from '@riviamigo/ui/lib/utils';
import { formatTireLabel } from '@riviamigo/ui/lib/vehicleTires';
import type { VehicleStatus } from '@riviamigo/types';

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
];

export const DEFAULT_OVERVIEW_STAT_IDS: readonly string[] = [
  'driver_mode',
  'altitude',
  'cabin_temp',
  'speed',
  'software',
];

const DEFINITIONS_BY_ID = new Map(OVERVIEW_STAT_DEFINITIONS.map((definition) => [definition.id, definition]));

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
    const id = typeof candidate === 'string' && DEFINITIONS_BY_ID.has(candidate) && !used.has(candidate)
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
