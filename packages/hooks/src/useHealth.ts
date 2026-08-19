import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';
import { queryKeys } from './queryKeys';

export function useVehicleHealth(vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.vehicle.health(vehicleId),
    queryFn: () => api.getVehicleHealth(vehicleId!),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
  });
}
