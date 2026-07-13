import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { DepartureScheduleInput, ChargingScheduleInput } from './api';
import type { ChargeSession, Place } from '@riviamigo/types';
import { useAuthReady } from './useAuthState';

type PlaceQueryKey = readonly ['places'];

type UpdateChargeSessionLocationPayload = {
  sessionId: string;
  placeId: string | null;
  placeName: string | null;
};

type UpdateChargeSessionLocationResponse = {
  session?: {
    location_name?: string | null;
  };
};

type UpdateChargeSessionLocationContext = {
  previousSession: ChargeSession | undefined;
  queryKey: readonly ['charging', 'detail', string, string | null];
};

export function useChargeSessions(
  vehicleId: string | null,
  from: string | null,
  to: string | null,
  page = 1,
  perPage = 25,
  search = '',
  chargeSessionDayLocal: string | null = null,
) {
  const normalizedSearch = search.trim();
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['charging', 'list', vehicleId, from, to, lifetime, page, perPage, normalizedSearch, chargeSessionDayLocal],
    queryFn: () => api.listChargeSessions(
      vehicleId!,
      from,
      to,
      page,
      perPage,
      normalizedSearch,
      lifetime,
      chargeSessionDayLocal,
    ),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

export function useChargeSession(sessionId: string | null, vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['charging', 'detail', sessionId, vehicleId],
    queryFn: () => api.getChargeSession(sessionId!, vehicleId!),
    enabled: authReady && !!sessionId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

export function useSavedPlaces() {
  const authReady = useAuthReady();
  return useQuery<Place[]>({
    queryKey: ['places'] as PlaceQueryKey,
    queryFn: () => api.listPlaces(),
    enabled: authReady,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
}

export function useUpdateChargeSessionLocation(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<UpdateChargeSessionLocationResponse, Error, UpdateChargeSessionLocationPayload, UpdateChargeSessionLocationContext>({
    mutationFn: ({ sessionId, placeId }: { sessionId: string; placeId: string | null }) => {
      if (!vehicleId) throw new Error('vehicle_id is required');
      return api.apiFetch<unknown>(
        'PATCH',
        `/v1/charging/${sessionId}?vehicle_id=${vehicleId}`,
        { place_id: placeId },
      ) as Promise<UpdateChargeSessionLocationResponse>;
    },
    onMutate: async ({ sessionId, placeName }) => {
      const queryKey: UpdateChargeSessionLocationContext['queryKey'] = ['charging', 'detail', sessionId, vehicleId];
      await queryClient.cancelQueries({ queryKey: ['charging', 'detail', sessionId, vehicleId] });
      const previousSession = queryClient.getQueryData<ChargeSession>(queryKey);
      queryClient.setQueryData<ChargeSession>(queryKey, (current) => {
        if (!current) return current;
        return { ...current, location_name: placeName };
      });
      return { previousSession, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData(context.queryKey, context.previousSession);
    },
    onSuccess: (_data, variables) => {
      const updatedSession = _data?.session;
      if (updatedSession && typeof updatedSession.location_name !== 'undefined') {
        const updatedLocationName = typeof updatedSession.location_name === 'string' ? updatedSession.location_name : null;
        queryClient.setQueryData(
          ['charging', 'detail', variables.sessionId, vehicleId],
          (current: ChargeSession | undefined) => {
            if (!current) return current;
            return { ...current, location_name: updatedLocationName };
          },
        );
      }

      void queryClient.invalidateQueries({ queryKey: ['charging', 'detail', variables.sessionId, vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['charging', 'list', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['charging', 'summary', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['charging', 'chart-series', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['metrics', 'batch', vehicleId] });
    },
  });
}

export function useChargeCurve(sessionId: string | null, vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['charging', 'curve', sessionId, vehicleId],
    queryFn: () => api.getChargeCurve(sessionId!, vehicleId!),
    enabled: authReady && !!sessionId && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

export function useChargeCurveAnalysis(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['charging', 'curve-analysis', vehicleId, from, to, lifetime],
    queryFn: () => api.getChargeCurveAnalysis(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

export function useChargingSummary(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['charging', 'summary', vehicleId, from, to, lifetime],
    queryFn: () => api.getChargingSummary(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

export function useChargingChartSeries(vehicleId: string | null, from: string | null, to: string | null) {
  const authReady = useAuthReady();
  const lifetime = !from && !to;
  return useQuery({
    queryKey: ['charging', 'chart-series', vehicleId, from, to, lifetime],
    queryFn: () => api.getChargingChartSeries(vehicleId!, from, to, lifetime),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (previous) => previous,
  });
}

export function useChargingSchedule(vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['schedules', 'charging', vehicleId],
    queryFn: () => api.getChargingSchedule(vehicleId!),
    enabled: authReady && !!vehicleId,
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

export function useDepartureSchedules(vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['schedules', 'departure', vehicleId],
    queryFn: () => api.listDepartureSchedules(vehicleId!),
    enabled: authReady && !!vehicleId,
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

export function useLiveSession(vehicleId: string | null, active = true) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ['live-session', vehicleId],
    queryFn: () => api.getLiveSession(vehicleId!),
    enabled: authReady && !!vehicleId && active,
    refetchInterval: active ? 30 * 1000 : false,
    staleTime: 0,
  });
}

