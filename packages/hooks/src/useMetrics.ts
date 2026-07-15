import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { MetricBatchMetricRequest } from '@riviamigo/types';
import { useAuthReady } from './useAuthState';

export type MetricSeriesBucket = 'auto' | 'raw' | 'minute' | '5min' | '15min' | 'hour' | 'day';

export function chooseMetricSeriesBucket(from: string | null, to: string | null): MetricSeriesBucket {
  if (!from || !to) return 'day';
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 'day';
  const minutes = (toMs - fromMs) / 60000;
  if (minutes <= 60) return 'minute';
  if (minutes <= 6 * 60) return '5min';
  if (minutes <= 24 * 60) return '15min';
  if (minutes <= 7 * 24 * 60) return 'hour';
  return 'day';
}

export function useMetricCatalog() {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['metrics', 'catalog'],
    queryFn: () => api.getMetricCatalog(),
    enabled: authReady,
    staleTime: 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useMetricValue(
  vehicleId: string | null,
  metric: string | null,
  from: string | null = null,
  to: string | null = null,
) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['metrics', 'value', vehicleId, metric, from, to, lifetime],
    queryFn: () => api.getMetricValue(vehicleId!, metric!, from, to, lifetime),
    enabled: authReady && !!vehicleId && !!metric,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useMetricSeries(
  vehicleId: string | null,
  metric: string | null,
  from: string | null,
  to: string | null,
  bucket: MetricSeriesBucket = 'auto',
) {
  const lifetime = !from && !to;
  const resolvedBucket = bucket === 'auto' ? chooseMetricSeriesBucket(from, to) : bucket;
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['metrics', 'series', vehicleId, metric, from, to, lifetime, resolvedBucket],
    queryFn: () => api.getMetricSeries(vehicleId!, metric!, from, to, resolvedBucket, lifetime),
    enabled: authReady && !!vehicleId && !!metric,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

/**
 * Fetches the compact metric payload used by dashboard chips in one request.
 * It intentionally does not persist: the page-level provider already keeps
 * it warm in memory and a multi-dashboard localStorage cache is counterproductive.
 */
export function useMetricBatch(
  vehicleId: string | null,
  metrics: readonly MetricBatchMetricRequest[],
  from: string | null,
  to: string | null,
  lifetime = false,
) {
  const authReady = useAuthReady();
  const stableMetrics = metrics.map((metric) => ({
    metric: metric.metric,
    include_latest: metric.include_latest !== false,
    include_series: metric.include_series !== false,
  }));
  const metricKey = stableMetrics.map((metric) => `${metric.metric}:${Number(metric.include_latest)}:${Number(metric.include_series)}`).join('|');
  return useQuery({
    queryKey: ['metrics', 'batch', vehicleId, from, to, lifetime, metricKey],
    queryFn: () => api.getMetricBatch({
      vehicle_id: vehicleId!,
      metrics: stableMetrics,
      from,
      to,
      lifetime,
      density: 'full',
      bucket: 'raw',
    }),
    enabled: authReady && !!vehicleId && stableMetrics.length > 0,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
    meta: { persist: false },
  });
}
