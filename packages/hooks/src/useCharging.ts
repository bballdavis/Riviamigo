import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function useChargeSessions(vehicleId: string | null, from: string, to: string, page = 1) {
  return useQuery({
    queryKey: ['charging', 'list', vehicleId, from, to, page],
    queryFn: () => api.listChargeSessions(vehicleId!, from, to, page),
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useChargeSession(sessionId: string | null, vehicleId: string | null) {
  return useQuery({
    queryKey: ['charging', 'detail', sessionId, vehicleId],
    queryFn: () => api.getChargeSession(sessionId!, vehicleId!),
    enabled: !!sessionId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useChargeCurve(sessionId: string | null, vehicleId: string | null) {
  return useQuery({
    queryKey: ['charging', 'curve', sessionId, vehicleId],
    queryFn: () => api.getChargeCurve(sessionId!, vehicleId!),
    enabled: !!sessionId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useChargingSummary(vehicleId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['charging', 'summary', vehicleId, from, to],
    queryFn: () => api.getChargingSummary(vehicleId!, from, to),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}
