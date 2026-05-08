import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useTrips(vehicleId: string | null, from: string, to: string, page = 1, perPage = 25, search = '') {
  return useQuery({
    queryKey: ['trips', 'list', vehicleId, from, to, page, perPage, search],
    queryFn: () => api.listTrips(vehicleId!, from, to, page, perPage, search),
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useTrip(tripId: string | null, vehicleId: string | null) {
  return useQuery({
    queryKey: ['trips', 'detail', tripId, vehicleId],
    queryFn: () => api.getTrip(tripId!, vehicleId!),
    enabled: !!tripId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useTripTrack(tripId: string | null, vehicleId: string | null) {
  return useQuery({
    queryKey: ['trips', 'track', tripId, vehicleId],
    queryFn: () => api.getTripTrack(tripId!, vehicleId!),
    enabled: !!tripId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useSpeedProfile(tripId: string | null, vehicleId: string | null) {
  return useQuery({
    queryKey: ['trips', 'speed', tripId, vehicleId],
    queryFn: () => api.getSpeedProfile(tripId!, vehicleId!),
    enabled: !!tripId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useElevationProfile(tripId: string | null, vehicleId: string | null) {
  return useQuery({
    queryKey: ['trips', 'elevation', tripId, vehicleId],
    queryFn: () => api.getElevationProfile(tripId!, vehicleId!),
    enabled: !!tripId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
