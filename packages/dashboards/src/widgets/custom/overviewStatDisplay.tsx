import React from 'react';
import { Icon } from '@iconify/react';
import { Activity } from 'lucide-react';
import type {
  BatteryHealthSummary,
  ChargingSummary,
  EfficiencySummary,
  MetricValueResponse,
  VehicleStatus,
} from '@riviamigo/types';
import { getChartColor } from '@riviamigo/ui/charts';
import { presentVehicleStatusDefinition } from '@riviamigo/ui/lib/vehicleStatus';
import type { DashboardDataRequirements } from '../../registry';
import { resolveIconId } from '../../editor/iconMigration';
import { getSensorDataAccent, type SensorDefinition } from '../sensor/sensorDefinitions';
import {
  buildSourceValues,
  formatMetricValue,
  resolveConfiguredValue,
} from '../sensor/sensorValueResolution';
import {
  getOverviewSensorDefinition,
  getOverviewStatDefinition,
  METRIC_STAT_PREFIX,
} from './overviewStats';

/** Everything beyond live vehicle status that a row may need to show its value. */
export interface OverviewStatData {
  /** Latest value per metric id. */
  metrics?: ReadonlyMap<string, MetricValueResponse | undefined> | undefined;
  /** Display names for backend metrics that no sensor presents. */
  metricLabels?: ReadonlyMap<string, string> | undefined;
  batteryHealth?: BatteryHealthSummary | undefined;
  chargingSummary?: ChargingSummary | undefined;
  efficiencySummary?: EfficiencySummary | undefined;
}

export interface PresentedOverviewStat {
  label: string;
  value: React.ReactNode;
  icon: React.ReactElement;
}

export interface OverviewStatNeeds {
  metrics: string[];
  batteryHealth: boolean;
  chargingSummary: boolean;
  efficiencySummary: boolean;
}

function metricIdFor(id: string, sensor: SensorDefinition | undefined): string | null {
  if (id.startsWith(METRIC_STAT_PREFIX)) return id.slice(METRIC_STAT_PREFIX.length);
  if (sensor && (sensor.dataSource ?? 'metric') === 'metric' && sensor.metric) return sensor.metric;
  return null;
}

/** Which shared data the selected rows read, beyond the live vehicle status. */
export function getOverviewStatNeeds(ids: readonly string[]): OverviewStatNeeds {
  const metrics = new Set<string>();
  const needs: OverviewStatNeeds = { metrics: [], batteryHealth: false, chargingSummary: false, efficiencySummary: false };
  for (const id of ids) {
    if (getOverviewStatDefinition(id)) continue;
    const sensor = getOverviewSensorDefinition(id);
    const metric = metricIdFor(id, sensor);
    if (metric) {
      metrics.add(metric);
      if (metric === 'avg_efficiency') needs.efficiencySummary = true;
    }
    const source = sensor?.dataSource ?? 'metric';
    if (source === 'batteryHealth') needs.batteryHealth = true;
    if (source === 'chargingSummary') needs.chargingSummary = true;
    if (source === 'efficiencySummary') needs.efficiencySummary = true;
  }
  needs.metrics = [...metrics].sort();
  return needs;
}

export function getOverviewStatRequirements(ids: readonly string[]): DashboardDataRequirements {
  const needs = getOverviewStatNeeds(ids);
  return {
    status: true,
    ...(needs.metrics.length > 0
      ? { metrics: needs.metrics.map((metric) => ({ metric, include_latest: true, include_series: false })) }
      : {}),
    ...(needs.batteryHealth ? { batteryHealth: true } : {}),
    ...(needs.chargingSummary ? { chargingSummary: true } : {}),
    ...(needs.efficiencySummary ? { efficiencySummary: true } : {}),
  };
}

function sensorIcon(sensor: SensorDefinition | undefined) {
  const accent = getSensorDataAccent(sensor?.metric, sensor);
  return (
    <Icon
      icon={resolveIconId(sensor?.icon)}
      className="h-3.5 w-3.5"
      style={{ color: accent ? getChartColor(accent) : 'var(--rm-accent)' }}
    />
  );
}

function presentSensor(
  sensor: SensorDefinition,
  status: VehicleStatus | null | undefined,
  data: OverviewStatData,
): React.ReactNode {
  const source = sensor.dataSource ?? 'metric';
  if (source === 'vehicleStatus') return presentVehicleStatusDefinition(sensor.id, status).label;
  if (source === 'metric') {
    const metric = sensor.metric ?? '';
    const value = data.metrics?.get(metric);
    const resolved = metric === 'avg_efficiency'
      ? data.efficiencySummary?.avg ?? value?.value
      : value?.value;
    return formatMetricValue(resolved, value?.unit ?? sensor.unit);
  }
  const values = buildSourceValues(source, data.batteryHealth, data.chargingSummary, data.efficiencySummary, status);
  return formatMetricValue(
    resolveConfiguredValue(
      {
        valuePath: sensor.valuePath ?? '',
        fallbackValuePath: sensor.fallbackValuePath ?? '',
        valueFormula: sensor.valueFormula ?? '',
      },
      values,
    ),
    sensor.unit,
  );
}

/** Resolve one overview row id to the label, value and icon it displays. */
export function presentOverviewStat(
  id: string,
  status: VehicleStatus | null | undefined,
  data: OverviewStatData = {},
): PresentedOverviewStat {
  const legacy = getOverviewStatDefinition(id);
  if (legacy) {
    const StatIcon = legacy.icon;
    return { label: legacy.label, value: legacy.format(status), icon: <StatIcon /> };
  }

  const sensor = getOverviewSensorDefinition(id);
  if (sensor) {
    return { label: sensor.title, value: presentSensor(sensor, status, data), icon: sensorIcon(sensor) };
  }

  const metric = id.slice(METRIC_STAT_PREFIX.length);
  const value = data.metrics?.get(metric);
  return {
    label: value?.label ?? data.metricLabels?.get(metric) ?? metric,
    value: formatMetricValue(value?.value, value?.unit),
    icon: <Activity className="h-3.5 w-3.5" style={{ color: 'var(--rm-accent)' }} />,
  };
}
