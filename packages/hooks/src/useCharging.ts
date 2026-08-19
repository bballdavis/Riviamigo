import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { DepartureScheduleInput, ChargingScheduleInput } from './api';
import type { ChargeSession, ChargeSessionUpdate, ChargingNetworkPreference, Place } from '@riviamigo/types';
import { useAuthReady } from './useAuthState';

type PlaceQueryKey = readonly ['places'];

type UpdateChargeSessionLocationPayload = {
  sessionId: string;
  placeId: string | null;
  placeName: string | null;
};

export type UpdateChargeSessionPayload = ChargeSessionUpdate & { sessionId: string };

type UpdateChargeSessionLocationResponse = {
  session?: {
    location_name?: string | null;
  };
};

type UpdateChargeSessionLocationContext = {
  previousSession: ChargeSession | undefined;
  queryKey: readonly ['charging', 'detail', string, string | null];
};

/**
 * Invalidate all data that can change when a saved place or charge-session
 * location changes. Keep this seam shared by charging mutations and the
 * Settings > Places mutations so stale derived data cannot survive a save.
 */
export function invalidateChargingData(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['charging'] });
  void queryClient.invalidateQueries({ queryKey: ['metrics', 'batch'] });
  void queryClient.invalidateQueries({ queryKey: ['trips'] });
}

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
    refetchOnMount: 'always',
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
    refetchOnMount: 'always',
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
    refetchOnMount: 'always',
  });
}

export function useUpdateChargeSessionLocation(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<UpdateChargeSessionLocationResponse, Error, UpdateChargeSessionLocationPayload, UpdateChargeSessionLocationContext>({
    mutationFn: async ({ sessionId, placeId }) => {
      if (!vehicleId) throw new Error('vehicle_id is required');
      const session = await api.updateChargeSession(vehicleId, sessionId, { place_id: placeId });
      return { session };
    },
    onMutate: async ({ sessionId, placeName }) => {
      const queryKey: UpdateChargeSessionLocationContext['queryKey'] = ['charging', 'detail', sessionId, vehicleId];
      await queryClient.cancelQueries({ queryKey });
      const previousSession = queryClient.getQueryData<ChargeSession>(queryKey);
      queryClient.setQueryData<ChargeSession>(queryKey, (current) => current ? { ...current, location_name: placeName } : current);
      return { previousSession, queryKey };
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(context.queryKey, context.previousSession);
    },
    onSuccess: (_data, variables) => {
      const updatedLocationName = _data.session?.location_name ?? null;
      queryClient.setQueryData(
        ['charging', 'detail', variables.sessionId, vehicleId],
        (current: ChargeSession | undefined) => current ? { ...current, location_name: updatedLocationName } : current,
      );
      invalidateChargingData(queryClient);
    },
  });
}

export function useUpdateChargeSession(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<ChargeSession, Error, UpdateChargeSessionPayload>({
    mutationFn: ({ sessionId, ...body }) => {
      if (!vehicleId) throw new Error('vehicle_id is required');
      return api.updateChargeSession(vehicleId, sessionId, body);
    },
    onSuccess: (session, variables) => {
      queryClient.setQueryData(['charging', 'detail', variables.sessionId, vehicleId], session);
      invalidateChargingData(queryClient);
    },
  });
}

export function useChargingNetworkPreferences(vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery<ChargingNetworkPreference[]>({
    queryKey: ['charging', 'network-preferences', vehicleId],
    queryFn: () => api.listChargingNetworkPreferences(vehicleId!),
    enabled: authReady && !!vehicleId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
  });
}

export function useUpdateChargingNetworkPreference(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<Pick<ChargingNetworkPreference, 'network_vendor' | 'cost_mode'>, Error, { networkVendor: string; costMode: ChargingNetworkPreference['cost_mode'] }>({
    mutationFn: ({ networkVendor, costMode }) => {
      if (!vehicleId) throw new Error('vehicle_id is required');
      return api.updateChargingNetworkPreference(vehicleId, networkVendor, costMode);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['charging', 'network-preferences', vehicleId] });
      invalidateChargingData(queryClient);
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
    refetchOnMount: 'always',
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
    refetchOnMount: 'always',
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
    refetchOnMount: 'always',
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
    refetchOnMount: 'always',
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
