import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './useAuth';

export function useSummaryStats(vehicleId: string | null) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['stats', vehicleId],
    queryFn: () => api.getStats(vehicleId!),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 10 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
