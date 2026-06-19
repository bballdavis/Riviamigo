import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';

export function useSummaryStats(vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['stats', vehicleId],
    queryFn: () => api.getStats(vehicleId!),
    enabled: authReady && !!vehicleId,
    staleTime: 10 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
