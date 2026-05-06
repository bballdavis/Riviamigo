import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useMetricCatalog() {
  return useQuery({
    queryKey: ['metrics', 'catalog'],
    queryFn: () => api.getMetricCatalog(),
    staleTime: 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useMetricValue(vehicleId: string | null, metric: string | null) {
  return useQuery({
    queryKey: ['metrics', 'value', vehicleId, metric],
    queryFn: () => api.getMetricValue(vehicleId!, metric!),
    enabled: !!vehicleId && !!metric,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useMetricSeries(
  vehicleId: string | null,
  metric: string | null,
  from: string,
  to: string,
  bucket = 'day',
) {
  return useQuery({
    queryKey: ['metrics', 'series', vehicleId, metric, from, to, bucket],
    queryFn: () => api.getMetricSeries(vehicleId!, metric!, from, to, bucket),
    enabled: !!vehicleId && !!metric,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
