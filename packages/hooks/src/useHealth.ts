import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';

export function useVehicleHealth(vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['vehicles', 'health', vehicleId],
    queryFn: () => api.getVehicleHealth(vehicleId!),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
