import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TripTagAssignmentRequest } from '@riviamigo/types';
import { api } from './api';
import { useAuthReady } from './useAuthState';

const TRIPS_LIST_QUERY_VERSION = 'v2';

export interface TripTagFilters {
  tagIds?: string[];
  tagMatch?: 'all' | 'any';
  untagged?: boolean;
}

function normalizeTagFilters(filters?: TripTagFilters) {
  const tagIds = [...new Set(filters?.tagIds ?? [])].sort();
  return {
    tagIds,
    tagMatch: filters?.tagMatch === 'any' ? 'any' as const : 'all' as const,
    untagged: Boolean(filters?.untagged) && tagIds.length === 0,
  };
}

export function useTrips(vehicleId: string | null, from: string | null, to: string | null, page = 1, perPage = 25, search = '', filters?: TripTagFilters) {
  const normalizedSearch = search.trim();
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  const tagFilters = normalizeTagFilters(filters);
  return useQuery({
    // Version the key to avoid hydrating stale list payloads from older app builds.
    queryKey: ['trips', 'list', TRIPS_LIST_QUERY_VERSION, vehicleId, from, to, lifetime, page, perPage, normalizedSearch, tagFilters],
    queryFn: () => api.listTrips(vehicleId!, from, to, page, perPage, normalizedSearch, lifetime, tagFilters),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
  });
}

export function useTripMapRoutes(
  vehicleId: string | null,
  from: string | null,
  to: string | null,
  search = '',
  filters?: TripTagFilters,
) {
  const normalizedSearch = search.trim();
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  const tagFilters = normalizeTagFilters(filters);
  return useQuery({
    queryKey: ['trips', 'map', 'v1', vehicleId, from, to, lifetime, normalizedSearch, tagFilters],
    queryFn: () => api.getTripMap(vehicleId!, from, to, normalizedSearch, lifetime, tagFilters),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    meta: { persist: false },
  });
}

export function useTripTags(vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['trip-tags', vehicleId],
    queryFn: () => api.listTripTags(vehicleId!),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

function invalidateTripTags(queryClient: ReturnType<typeof useQueryClient>, vehicleId: string) {
  void queryClient.invalidateQueries({ queryKey: ['trip-tags', vehicleId] });
  void queryClient.invalidateQueries({ queryKey: ['trips'] });
}

export function useCreateTripTag(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) => api.createTripTag(vehicleId!, body),
    onSuccess: () => { if (vehicleId) invalidateTripTags(queryClient, vehicleId); },
  });
}

export function useUpdateTripTag(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tagId, ...body }: { tagId: string; name?: string }) => api.updateTripTag(vehicleId!, tagId, body),
    onSuccess: () => { if (vehicleId) invalidateTripTags(queryClient, vehicleId); },
  });
}

export function useDeleteTripTag(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) => api.deleteTripTag(vehicleId!, tagId),
    onSuccess: () => { if (vehicleId) invalidateTripTags(queryClient, vehicleId); },
  });
}

export function useUpdateTripTagAssignments(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TripTagAssignmentRequest) => api.updateTripTagAssignments(vehicleId!, body),
    onSuccess: () => { if (vehicleId) invalidateTripTags(queryClient, vehicleId); },
  });
}

export function useTrip(tripId: string | null, vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['trips', 'detail', tripId, vehicleId],
    queryFn: () => api.getTrip(tripId!, vehicleId!),
    enabled: authReady && !!tripId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
  });
}

export function useTripDetailData(tripId: string | null, vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['trips', 'detail-data', 'v1', tripId, vehicleId],
    queryFn: () => api.getTripDetailData(tripId!, vehicleId!),
    enabled: authReady && !!tripId && !!vehicleId,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
    meta: { persist: false },
  });
}

export function useTripTrack(tripId: string | null, vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['trips', 'track', tripId, vehicleId],
    queryFn: () => api.getTripTrack(tripId!, vehicleId!),
    enabled: authReady && !!tripId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
    meta: { persist: false },
  });
}

export function useSpeedProfile(tripId: string | null, vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['trips', 'speed', tripId, vehicleId],
    queryFn: () => api.getSpeedProfile(tripId!, vehicleId!),
    enabled: authReady && !!tripId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
    meta: { persist: false },
  });
}

export function useElevationProfile(tripId: string | null, vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['trips', 'elevation', tripId, vehicleId],
    queryFn: () => api.getElevationProfile(tripId!, vehicleId!),
    enabled: authReady && !!tripId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
    meta: { persist: false },
  });
}

export function useTripPowerProfile(tripId: string | null, vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['trips', 'power', tripId, vehicleId],
    queryFn: () => api.getTripPowerProfile(tripId!, vehicleId!),
    enabled: authReady && !!tripId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
    meta: { persist: false },
  });
}

export function useTripDetailSeries(tripId: string | null, vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['trips', 'series', tripId, vehicleId],
    queryFn: () => api.getTripDetailSeries(tripId!, vehicleId!),
    enabled: authReady && !!tripId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
    placeholderData: (previous) => previous,
    meta: { persist: false },
  });
}
