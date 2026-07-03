import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';

export function useSocHistory(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['battery', 'soc', vehicleId, from, to, lifetime],
    queryFn: () => api.getSoc(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useRangeHistory(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['battery', 'range', vehicleId, from, to, lifetime],
    queryFn: () => api.getRange(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function usePhantomDrain(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['battery', 'phantom', vehicleId, from, to, lifetime],
    queryFn: () => api.getPhantomDrain(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function usePhantomDrainPeriods(
  vehicleId: string | null,
  from: string | null,
  to: string | null,
  limit = 250,
  minDurationHours = 6,
) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['battery', 'phantom-periods', vehicleId, from, to, lifetime, limit, minDurationHours],
    queryFn: () => api.getIdleDrainPeriods(vehicleId!, from, to, limit, minDurationHours, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useDegradation(vehicleId: string | null, from: string | null = null, to: string | null = null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['battery', 'degradation', vehicleId, from, to, lifetime],
    queryFn: () => api.getDegradation(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useBatteryHealth(vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['battery', 'health', vehicleId],
    queryFn: () => api.getBatteryHealth(vehicleId!),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useBatteryMileage(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['battery', 'mileage', vehicleId, from, to, lifetime],
    queryFn: () => api.getBatteryMileage(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
