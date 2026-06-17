import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './useAuth';

export function useVehicleHealth(vehicleId: string | null) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['vehicles', 'health', vehicleId],
    queryFn: () => api.getVehicleHealth(vehicleId!),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
