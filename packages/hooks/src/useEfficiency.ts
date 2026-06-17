import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './useAuth';

export function useEfficiencySummary(vehicleId: string | null, from: string, to: string) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['efficiency', 'summary', vehicleId, from, to],
    queryFn: () => api.getEfficiencySummary(vehicleId!, from, to),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useEfficiencyByMode(vehicleId: string | null, from: string, to: string) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['efficiency', 'by-mode', vehicleId, from, to],
    queryFn: () => api.getEfficiencyByMode(vehicleId!, from, to),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useEfficiencyTrend(vehicleId: string | null, from: string, to: string) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['efficiency', 'trend', vehicleId, from, to],
    queryFn: () => api.getEfficiencyTrend(vehicleId!, from, to),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useEfficiencyVsTemp(vehicleId: string | null, from: string, to: string) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['efficiency', 'vs-temp', vehicleId, from, to],
    queryFn: () => api.getEfficiencyVsTemp(vehicleId!, from, to),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 10 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
