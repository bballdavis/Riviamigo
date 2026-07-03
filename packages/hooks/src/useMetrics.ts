import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';

export type MetricSeriesBucket = 'auto' | 'minute' | '5min' | '15min' | 'hour' | 'day';

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

export function useMetricValue(vehicleId: string | null, metric: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['metrics', 'value', vehicleId, metric],
    queryFn: () => api.getMetricValue(vehicleId!, metric!),
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
