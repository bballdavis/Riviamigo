import React from 'react';
import { useBatteryHealth } from '@riviamigo/hooks';
import { useDashboardDataAvailable, useDashboardDataSelector } from '../../dashboardData';
import { overviewStatsNeedBatteryHealth, type OverviewStatData } from './overviewStatDisplay';

/**
 * Loads the extra data the selected overview rows read (currently the battery
 * health summary). Inside a dashboard it reads the shared snapshot the widget
 * declared through `dataRequirements`; on its own it fetches only what the rows need.
 */
export function useOverviewStatData(statIds: readonly string[], vehicleId: string | null): OverviewStatData {
  const needsHealth = overviewStatsNeedBatteryHealth(statIds);
  const provided = useDashboardDataAvailable();
  const snapshotHealth = useDashboardDataSelector((snapshot) => snapshot.batteryHealth);
  const health = useBatteryHealth(!provided && needsHealth ? vehicleId : null);
  const batteryHealth = provided ? snapshotHealth : health.data;
  return React.useMemo(() => ({ batteryHealth }), [batteryHealth]);
}

export { useUnitPreferencesVersion } from '@riviamigo/ui/lib/useUnitPreferencesVersion';
