import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useVehicleHealth(vehicleId: string | null) {
  return useQuery({
    queryKey: ['vehicles', 'health', vehicleId],
    queryFn: () => api.getVehicleHealth(vehicleId!),
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
