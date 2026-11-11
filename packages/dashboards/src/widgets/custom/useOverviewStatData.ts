import React from 'react';
import {
  useBatteryHealth,
  useChargingSummary,
  useEfficiencySummary,
  useMetricBatch,
  useMetricCatalog,
} from '@riviamigo/hooks';
import type { MetricValueResponse } from '@riviamigo/types';
import type { WidgetCtx } from '../../registry';
import {
  useDashboardDataAvailable,
  useDashboardDataSelector,
} from '../../dashboardData';
import { getOverviewStatNeeds, type OverviewStatData } from './overviewStatDisplay';

/**
 * Loads the extra data the selected overview rows read (metric values and the
 * battery, charging and efficiency summaries). Inside a dashboard it reads the
 * shared snapshot the widget declared through `dataRequirements`; on its own it
 * fetches what the rows need and nothing more.
 */
export function useOverviewStatData(
  statIds: readonly string[],
  ctx: WidgetCtx,
  vehicleId: string | null,
): OverviewStatData {
  const idKey = statIds.join('|');
  const needs = React.useMemo(() => getOverviewStatNeeds(idKey ? idKey.split('|') : []), [idKey]);
  const metricKey = needs.metrics.join('|');
  const requests = React.useMemo(
    () => needs.metrics.map((metric) => ({ metric, include_latest: true, include_series: false })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- metricKey is the stable identity of needs.metrics
    [metricKey],
  );

  const provided = useDashboardDataAvailable();
  const snapshotMetrics = useDashboardDataSelector((snapshot) => snapshot.metrics);
  const snapshotHealth = useDashboardDataSelector((snapshot) => snapshot.batteryHealth);
  const snapshotCharging = useDashboardDataSelector((snapshot) => snapshot.chargingSummary);
  const snapshotEfficiency = useDashboardDataSelector((snapshot) => snapshot.efficiencySummary);

  const lifetime = !ctx.from && !ctx.to;
  const batch = useMetricBatch(provided ? null : vehicleId, requests, ctx.from, ctx.to, lifetime, ctx.tripTagFilter);
  const health = useBatteryHealth(!provided && needs.batteryHealth ? vehicleId : null);
  const charging = useChargingSummary(!provided && needs.chargingSummary ? vehicleId : null, ctx.from, ctx.to);
  const efficiency = useEfficiencySummary(
    !provided && needs.efficiencySummary ? vehicleId : null,
    ctx.from,
    ctx.to,
    ctx.tripTagFilter,
  );
  const catalog = useMetricCatalog();

  return React.useMemo<OverviewStatData>(() => {
    const metrics = new Map<string, MetricValueResponse | undefined>();
    if (provided) {
      for (const metric of needs.metrics) metrics.set(metric, snapshotMetrics?.get(metric)?.value);
    } else {
      for (const value of batch.data?.values ?? []) metrics.set(value.metric, value);
    }
    return {
      metrics,
      metricLabels: new Map((catalog.data ?? []).map((entry) => [entry.id, entry.label])),
      batteryHealth: provided ? snapshotHealth : health.data,
      chargingSummary: provided ? snapshotCharging : charging.data,
      efficiencySummary: provided ? snapshotEfficiency : efficiency.data,
    };
  }, [
    provided,
    needs.metrics,
    snapshotMetrics,
    snapshotHealth,
    snapshotCharging,
    snapshotEfficiency,
    batch.data,
    health.data,
    charging.data,
    efficiency.data,
    catalog.data,
  ]);
}
