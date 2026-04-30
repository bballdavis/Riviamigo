import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useSummaryStats(vehicleId: string | null) {
  return useQuery({
    queryKey: ['stats', vehicleId],
    queryFn: () => api.getStats(vehicleId!),
    enabled: !!vehicleId,
    staleTime: 10 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
