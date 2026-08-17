import { useQuery } from '@tanstack/react-query';
import type { TelemetryLaneQuery } from '@riviamigo/types';
import { api } from './api';
import { useAuthReady } from './useAuthState';

export function useTelemetryLanes(
  vehicleId: string | null,
  query: TelemetryLaneQuery = {},
) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['vehicles', 'telemetry-lanes', vehicleId, query],
    queryFn: () => api.getTelemetryLanes(vehicleId!, query),
    enabled: authReady && !!vehicleId,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
