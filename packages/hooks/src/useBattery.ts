import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useSocHistory(vehicleId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['battery', 'soc', vehicleId, from, to],
    queryFn: () => api.getSoc(vehicleId!, from, to),
    enabled: !!vehicleId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useRangeHistory(vehicleId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['battery', 'range', vehicleId, from, to],
    queryFn: () => api.getRange(vehicleId!, from, to),
    enabled: !!vehicleId,
    staleTime: 2 * 60 * 1000,
  });
}

export function usePhantomDrain(vehicleId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['battery', 'phantom', vehicleId, from, to],
    queryFn: () => api.getPhantomDrain(vehicleId!, from, to),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
}
