import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './useAuth';

export function useSocHistory(vehicleId: string | null, from: string, to: string) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['battery', 'soc', vehicleId, from, to],
    queryFn: () => api.getSoc(vehicleId!, from, to),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useRangeHistory(vehicleId: string | null, from: string, to: string) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['battery', 'range', vehicleId, from, to],
    queryFn: () => api.getRange(vehicleId!, from, to),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function usePhantomDrain(vehicleId: string | null, from: string, to: string) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['battery', 'phantom', vehicleId, from, to],
    queryFn: () => api.getPhantomDrain(vehicleId!, from, to),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function usePhantomDrainPeriods(
  vehicleId: string | null,
  from: string,
  to: string,
  limit = 250,
  minDurationHours = 6,
) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['battery', 'phantom-periods', vehicleId, from, to, limit, minDurationHours],
    queryFn: () => api.getIdleDrainPeriods(vehicleId!, from, to, limit, minDurationHours),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useDegradation(vehicleId: string | null) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['battery', 'degradation', vehicleId],
    queryFn: () => api.getDegradation(vehicleId!),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useBatteryHealth(vehicleId: string | null) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['battery', 'health', vehicleId],
    queryFn: () => api.getBatteryHealth(vehicleId!),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useBatteryMileage(vehicleId: string | null, from: string, to: string) {
  const accessToken = useAuth((state) => state.accessToken);
  return useQuery({
    queryKey: ['battery', 'mileage', vehicleId, from, to],
    queryFn: () => api.getBatteryMileage(vehicleId!, from, to),
    enabled: !!vehicleId && !!accessToken,
    staleTime: 60 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
