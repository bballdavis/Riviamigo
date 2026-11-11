import React from 'react';
import { useBatteryHealth } from '@riviamigo/hooks';
import { getUnitPreferences } from '@riviamigo/ui/lib/utils';
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

function subscribeToUnits(onChange: () => void) {
  window.addEventListener('rm-units-change', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener('rm-units-change', onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Re-renders when the user changes their unit preferences (including a custom
 * mix such as metric distance with Fahrenheit), so every row is re-formatted
 * and converted to match.
 */
export function useUnitPreferencesVersion() {
  return React.useSyncExternalStore(
    subscribeToUnits,
    () => JSON.stringify(getUnitPreferences()),
    () => '',
  );
}
