import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useEfficiencySummary(vehicleId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['efficiency', 'summary', vehicleId, from, to],
    queryFn: () => api.getEfficiencySummary(vehicleId!, from, to),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEfficiencyByMode(vehicleId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['efficiency', 'by-mode', vehicleId, from, to],
    queryFn: () => api.getEfficiencyByMode(vehicleId!, from, to),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEfficiencyTrend(vehicleId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['efficiency', 'trend', vehicleId, from, to],
    queryFn: () => api.getEfficiencyTrend(vehicleId!, from, to),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEfficiencyVsTemp(vehicleId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['efficiency', 'vs-temp', vehicleId, from, to],
    queryFn: () => api.getEfficiencyVsTemp(vehicleId!, from, to),
    enabled: !!vehicleId,
    staleTime: 10 * 60 * 1000,
  });
}
