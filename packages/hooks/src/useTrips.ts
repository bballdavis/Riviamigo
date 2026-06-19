import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';

const TRIPS_LIST_QUERY_VERSION = 'v2';

export function useTrips(vehicleId: string | null, from: string, to: string, page = 1, perPage = 25, search = '') {
  const normalizedSearch = search.trim();
  const authReady = useAuthReady();
  return useQuery({
    // Version the key to avoid hydrating stale list payloads from older app builds.
    queryKey: ['trips', 'list', TRIPS_LIST_QUERY_VERSION, vehicleId, from, to, page, perPage, normalizedSearch],
    queryFn: () => api.listTrips(vehicleId!, from, to, page, perPage, normalizedSearch),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
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
  });
}
