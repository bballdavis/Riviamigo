import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';

export function useEfficiencySummary(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['efficiency', 'summary', vehicleId, from, to, lifetime],
    queryFn: () => api.getEfficiencySummary(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useEfficiencyByMode(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['efficiency', 'by-mode', vehicleId, from, to, lifetime],
    queryFn: () => api.getEfficiencyByMode(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useEfficiencyTrend(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['efficiency', 'trend', vehicleId, from, to, lifetime],
    queryFn: () => api.getEfficiencyTrend(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useEfficiencyVsTemp(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['efficiency', 'vs-temp', vehicleId, from, to, lifetime],
    queryFn: () => api.getEfficiencyVsTemp(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 10 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
