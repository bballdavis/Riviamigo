import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';

const TRIPS_LIST_QUERY_VERSION = 'v2';

export function useTrips(vehicleId: string | null, from: string | null, to: string | null, page = 1, perPage = 25, search = '') {
  const normalizedSearch = search.trim();
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    // Version the key to avoid hydrating stale list payloads from older app builds.
    queryKey: ['trips', 'list', TRIPS_LIST_QUERY_VERSION, vehicleId, from, to, lifetime, page, perPage, normalizedSearch],
    queryFn: () => api.listTrips(vehicleId!, from, to, page, perPage, normalizedSearch, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
}

export function useTripMapRoutes(
  vehicleId: string | null,
  from: string | null,
  to: string | null,
  search = '',
) {
  const normalizedSearch = search.trim();
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['trips', 'map', 'v1', vehicleId, from, to, lifetime, normalizedSearch],
    queryFn: () => api.getTripMap(vehicleId!, from, to, normalizedSearch, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    meta: { persist: false },
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
    refetchOnMount: false,
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
    refetchOnMount: false,
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
    refetchOnMount: false,
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
    refetchOnMount: false,
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
    refetchOnMount: false,
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
    refetchOnMount: false,
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
    refetchOnMount: false,
    placeholderData: (previous) => previous,
    meta: { persist: false },
  });
}
