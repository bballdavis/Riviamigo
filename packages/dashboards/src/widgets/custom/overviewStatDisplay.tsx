import React from 'react';
import { AppIcon as Icon } from '../../icons/AppIcon';
import type { BatteryHealthSummary, VehicleStatus } from '@riviamigo/types';
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
import { getOverviewSensorDefinition, getOverviewStatDefinition } from './overviewStats';

/**
 * Overview rows show current values. Live vehicle state comes from the status;
 * battery-health sensors read the current battery health. Distances, speeds,
 * temperatures and pressures all pass through the shared formatters, so they
 * follow the user's unit preferences.
 */
export interface OverviewStatData {
  batteryHealth?: BatteryHealthSummary | undefined;
}

export interface PresentedOverviewStat {
  label: string;
  value: React.ReactNode;
  icon: React.ReactElement;
}

/** Whether any chosen row reads the battery health summary. */
export function overviewStatsNeedBatteryHealth(ids: readonly string[]) {
  return ids.some((id) => getOverviewSensorDefinition(id)?.dataSource === 'batteryHealth');
}

export function getOverviewStatRequirements(ids: readonly string[]): DashboardDataRequirements {
  return {
    status: true,
    ...(overviewStatsNeedBatteryHealth(ids) ? { batteryHealth: true } : {}),
  };
}

function sensorIcon(sensor: SensorDefinition) {
  const accent = getSensorDataAccent(sensor.metric, sensor);
  return (
    <Icon
      icon={resolveIconId(sensor.icon)}
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
  if (sensor.dataSource === 'vehicleStatus') return presentVehicleStatusDefinition(sensor.id, status).label;
  const values = buildSourceValues('batteryHealth', data.batteryHealth, undefined, undefined, status);
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

  const sensor = getOverviewSensorDefinition(id)!;
  return { label: sensor.title, value: presentSensor(sensor, status, data), icon: sensorIcon(sensor) };
}
