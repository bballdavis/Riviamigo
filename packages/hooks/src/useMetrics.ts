import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './useAuth';

export type MetricSeriesBucket = 'auto' | 'minute' | '5min' | '15min' | 'hour' | 'day';

export function chooseMetricSeriesBucket(from: string, to: string): MetricSeriesBucket {
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
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['metrics', 'catalog'],
    queryFn: () => api.getMetricCatalog(),
    enabled: !!accessToken,
    staleTime: 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useMetricValue(vehicleId: string | null, metric: string | null) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['metrics', 'value', vehicleId, metric],
    queryFn: () => api.getMetricValue(vehicleId!, metric!),
    enabled: !!vehicleId && !!metric && !!accessToken,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useMetricSeries(
  vehicleId: string | null,
  metric: string | null,
  from: string,
  to: string,
  bucket: MetricSeriesBucket = 'auto',
) {
  const resolvedBucket = bucket === 'auto' ? chooseMetricSeriesBucket(from, to) : bucket;
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['metrics', 'series', vehicleId, metric, from, to, resolvedBucket],
    queryFn: () => api.getMetricSeries(vehicleId!, metric!, from, to, resolvedBucket),
    enabled: !!vehicleId && !!metric && !!accessToken,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
