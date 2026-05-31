import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { ChargingScheduleInput, DepartureScheduleInput } from './api';

export function useChargeSessions(vehicleId: string | null, from: string, to: string, page = 1, perPage = 25, search = '') {
  const normalizedSearch = search.trim();
  return useQuery({
    queryKey: ['charging', 'list', vehicleId, from, to, page, perPage, normalizedSearch],
    queryFn: () => api.listChargeSessions(vehicleId!, from, to, page, perPage, normalizedSearch),
    enabled: !!vehicleId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

export function useChargeSession(sessionId: string | null, vehicleId: string | null) {
  return useQuery({
    queryKey: ['charging', 'detail', sessionId, vehicleId],
    queryFn: () => api.getChargeSession(sessionId!, vehicleId!),
    enabled: !!sessionId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

export function useChargeCurve(sessionId: string | null, vehicleId: string | null) {
  return useQuery({
    queryKey: ['charging', 'curve', sessionId, vehicleId],
    queryFn: () => api.getChargeCurve(sessionId!, vehicleId!),
    enabled: !!sessionId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

export function useChargeCurveAnalysis(vehicleId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['charging', 'curve-analysis', vehicleId, from, to],
    queryFn: () => api.getChargeCurveAnalysis(vehicleId!, from, to),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

export function useChargingSummary(vehicleId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: ['charging', 'summary', vehicleId, from, to],
    queryFn: () => api.getChargingSummary(vehicleId!, from, to),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

// ── Charging schedule ─────────────────────────────────────────────────────────

export function useChargingSchedule(vehicleId: string | null) {
  return useQuery({
    queryKey: ['schedules', 'charging', vehicleId],
    queryFn: () => api.getChargingSchedule(vehicleId!),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateChargingSchedule(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ChargingScheduleInput) => api.putChargingSchedule(vehicleId!, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedules', 'charging', vehicleId] });
    },
  });
}

// ── Departure schedules ───────────────────────────────────────────────────────

export function useDepartureSchedules(vehicleId: string | null) {
  return useQuery({
    queryKey: ['schedules', 'departure', vehicleId],
    queryFn: () => api.listDepartureSchedules(vehicleId!),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateDepartureSchedule(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DepartureScheduleInput) => api.createDepartureSchedule(vehicleId!, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedules', 'departure', vehicleId] });
    },
  });
}

export function useUpdateDepartureSchedule(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scheduleId, body }: { scheduleId: string; body: DepartureScheduleInput }) =>
      api.updateDepartureSchedule(vehicleId!, scheduleId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedules', 'departure', vehicleId] });
    },
  });
}

export function useDeleteDepartureSchedule(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scheduleId: string) => api.deleteDepartureSchedule(vehicleId!, scheduleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedules', 'departure', vehicleId] });
    },
  });
}

// ── Live charging session ─────────────────────────────────────────────────────

export function useLiveSession(vehicleId: string | null, active = true) {
  return useQuery({
    queryKey: ['live-session', vehicleId],
    queryFn: () => api.getLiveSession(vehicleId!),
    enabled: !!vehicleId && active,
    refetchInterval: active ? 30 * 1000 : false,
    staleTime: 0,
  });
}
