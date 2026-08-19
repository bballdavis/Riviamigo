import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';
import type { TripTagFilters } from './useTrips';

function normalizeTagFilters(filters?: TripTagFilters) {
  const tagIds = [...new Set(filters?.tagIds ?? [])].sort();
  return {
    tagIds,
    tagMatch: filters?.tagMatch === 'any' ? 'any' as const : 'all' as const,
    untagged: Boolean(filters?.untagged) && tagIds.length === 0,
  };
}

export function useEfficiencySummary(vehicleId: string | null, from: string | null, to: string | null, filters?: TripTagFilters) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  const tagFilters = normalizeTagFilters(filters);
  return useQuery({
    queryKey: ['efficiency', 'summary', vehicleId, from, to, lifetime, tagFilters],
    queryFn: () => api.getEfficiencySummary(vehicleId!, from, to, lifetime, tagFilters),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
  });
}

export function useEfficiencyByMode(vehicleId: string | null, from: string | null, to: string | null, filters?: TripTagFilters) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  const tagFilters = normalizeTagFilters(filters);
  return useQuery({
    queryKey: ['efficiency', 'by-mode', vehicleId, from, to, lifetime, tagFilters],
    queryFn: () => api.getEfficiencyByMode(vehicleId!, from, to, lifetime, tagFilters),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
  });
}

export function useEfficiencyTrend(vehicleId: string | null, from: string | null, to: string | null, filters?: TripTagFilters) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  const tagFilters = normalizeTagFilters(filters);
  return useQuery({
    queryKey: ['efficiency', 'trend', vehicleId, from, to, lifetime, tagFilters],
    queryFn: () => api.getEfficiencyTrend(vehicleId!, from, to, lifetime, tagFilters),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
  });
}

export function useEfficiencyVsTemp(vehicleId: string | null, from: string | null, to: string | null, filters?: TripTagFilters) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  const tagFilters = normalizeTagFilters(filters);
  return useQuery({
    queryKey: ['efficiency', 'vs-temp', vehicleId, from, to, lifetime, tagFilters],
    queryFn: () => api.getEfficiencyVsTemp(vehicleId!, from, to, lifetime, tagFilters),
    enabled: authReady && !!vehicleId,
    staleTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
  });
}

export function useEfficiencyByTag(vehicleId: string | null, from: string | null, to: string | null, filters?: TripTagFilters) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  const tagFilters = normalizeTagFilters(filters);
  return useQuery({
    queryKey: ['efficiency', 'by-tag', vehicleId, from, to, lifetime, tagFilters],
    queryFn: () => api.getEfficiencyByTag(vehicleId!, from, to, lifetime, tagFilters),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
  });
}
