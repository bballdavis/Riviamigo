import React from 'react';
import {
  useBatteryHealth,
  useChargingSummary,
  useCurrentVehicleStatus,
  useEfficiencySummary,
  useMetricBatch,
} from '@riviamigo/hooks';
import type {
  BatteryHealthSummary,
  ChargingSummary,
  EfficiencySummary,
  MetricBatchMetricRequest,
  MetricSeriesPoint,
  MetricValueResponse,
  VehicleStatus,
} from '@riviamigo/types';
import { getWidgetForInstance } from './registry';
import type { WidgetInstance, WidgetCtx } from './registry';

export interface DashboardDataRequirements {
  metrics?: MetricBatchMetricRequest[];
  status?: boolean;
  batteryHealth?: boolean;
  chargingSummary?: boolean;
  efficiencySummary?: boolean;
}

export interface DashboardMetricData {
  value?: MetricValueResponse;
  series: MetricSeriesPoint[];
}

export interface DashboardDataSnapshot {
  hasProvider: true;
  values: ReadonlyMap<string, MetricValueResponse>;
  series: ReadonlyMap<string, MetricSeriesPoint[]>;
  metrics: ReadonlyMap<string, DashboardMetricData>;
  status?: VehicleStatus | null;
  batteryHealth?: BatteryHealthSummary;
  chargingSummary?: ChargingSummary;
  efficiencySummary?: EfficiencySummary;
  isRefreshing: boolean;
}

class DashboardDataStore {
  private snapshot: DashboardDataSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.snapshot = {
      hasProvider: true,
      values: new Map(),
      series: new Map(),
      metrics: new Map(),
      isRefreshing: false,
    };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setSnapshot(snapshot: DashboardDataSnapshot) {
    this.snapshot = snapshot;
  }

  notify() {
    this.listeners.forEach((listener) => listener());
  }
}

const DashboardDataContext = React.createContext<DashboardDataStore | null>(null);

export function collectDashboardDataRequirements(widgets: readonly WidgetInstance[]): DashboardDataRequirements {
  const metricRequests = new Map<string, MetricBatchMetricRequest>();
  const result: DashboardDataRequirements = {};

  for (const instance of widgets) {
    const definition = getWidgetForInstance(instance);
    const requirements = definition?.dataRequirements?.(instance);
    if (!requirements) continue;

    result.status ||= requirements.status === true;
    result.batteryHealth ||= requirements.batteryHealth === true;
    result.chargingSummary ||= requirements.chargingSummary === true;
    result.efficiencySummary ||= requirements.efficiencySummary === true;
    for (const request of requirements.metrics ?? []) {
      const current = metricRequests.get(request.metric);
      metricRequests.set(request.metric, {
        metric: request.metric,
        include_latest: current
          ? current.include_latest !== false || request.include_latest !== false
          : request.include_latest !== false,
        include_series: current
          ? current.include_series === true || request.include_series === true
          : request.include_series === true,
      });
    }
  }

  const metrics = [...metricRequests.values()].sort((left, right) => left.metric.localeCompare(right.metric));
  return metrics.length > 0 ? { ...result, metrics } : result;
}

export function DashboardDataProvider({
  ctx,
  requirements,
  children,
}: {
  ctx: WidgetCtx;
  requirements: DashboardDataRequirements;
  children: React.ReactNode;
}) {
  const storeRef = React.useRef<DashboardDataStore | undefined>(undefined);
  if (!storeRef.current) storeRef.current = new DashboardDataStore();
  const store = storeRef.current;
  const metrics = requirements.metrics ?? [];
  const lifetime = !ctx.from && !ctx.to;
  const batch = useMetricBatch(ctx.vehicleId, metrics, ctx.from, ctx.to, lifetime);
  const status = useCurrentVehicleStatus(requirements.status ? ctx.vehicleId : null);
  const batteryHealth = useBatteryHealth(requirements.batteryHealth ? ctx.vehicleId : null);
  const chargingSummary = useChargingSummary(
    requirements.chargingSummary ? ctx.vehicleId : null,
    ctx.from,
    ctx.to,
  );
  const efficiencySummary = useEfficiencySummary(
    requirements.efficiencySummary ? ctx.vehicleId : null,
    ctx.from,
    ctx.to,
  );

  const snapshot = React.useMemo<DashboardDataSnapshot>(() => {
    const values = new Map((batch.data?.values ?? []).map((value) => [value.metric, value]));
    const series = new Map((batch.data?.series ?? []).map((entry) => [entry.metric, entry.points]));
    const metrics = new Map<string, DashboardMetricData>();
    for (const metric of new Set([...values.keys(), ...series.keys()])) {
      const value = values.get(metric);
      metrics.set(metric, { ...(value ? { value } : {}), series: series.get(metric) ?? [] });
    }
    return {
    hasProvider: true,
    values,
    series,
    metrics,
    ...(requirements.status && status.data ? { status: status.data } : {}),
    ...(requirements.batteryHealth && batteryHealth.data ? { batteryHealth: batteryHealth.data } : {}),
    ...(requirements.chargingSummary && chargingSummary.data ? { chargingSummary: chargingSummary.data } : {}),
    ...(requirements.efficiencySummary && efficiencySummary.data ? { efficiencySummary: efficiencySummary.data } : {}),
    isRefreshing: batch.isFetching || status.isFetching || batteryHealth.isFetching
      || chargingSummary.isFetching || efficiencySummary.isFetching,
    };
  }, [
    batch.data,
    batch.isFetching,
    status.data,
    status.isFetching,
    batteryHealth.data,
    batteryHealth.isFetching,
    chargingSummary.data,
    chargingSummary.isFetching,
    efficiencySummary.data,
    efficiencySummary.isFetching,
    requirements.status,
    requirements.batteryHealth,
    requirements.chargingSummary,
    requirements.efficiencySummary,
  ]);

  store.setSnapshot(snapshot);
  React.useEffect(() => {
    store.notify();
  }, [snapshot, store]);

  return <DashboardDataContext.Provider value={store}>{children}</DashboardDataContext.Provider>;
}

export function useDashboardDataSelector<T>(selector: (snapshot: DashboardDataSnapshot) => T): T | undefined {
  const store = React.useContext(DashboardDataContext);
  const selectorRef = React.useRef(selector);
  selectorRef.current = selector;
  const subscribe = React.useCallback((listener: () => void) => store?.subscribe(listener) ?? (() => {}), [store]);
  const getSnapshot = React.useCallback(
    () => (store ? selectorRef.current(store.getSnapshot()) : undefined),
    [store],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useDashboardMetric(metric: string | null) {
  return useDashboardDataSelector((snapshot) => metric ? snapshot.metrics.get(metric) : undefined);
}

export function useDashboardDataAvailable() {
  return React.useContext(DashboardDataContext) !== null;
}
