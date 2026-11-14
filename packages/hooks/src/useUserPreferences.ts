import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MapStylePreference, OverviewViewPreference, UserPreferencesResponse } from '@riviamigo/types';
import { api } from './api';
import { useAuthReady } from './useAuthState';
import { queryKeys } from './queryKeys';

/**
 * The combined preference endpoint deliberately shares the long-standing
 * unit-preference key so existing callers continue to receive fresh data.
 */
export function useUserPreferences() {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.unitPreferences.current,
    queryFn: (): Promise<UserPreferencesResponse> => api.apiFetch('GET', '/v1/auth/preferences'),
    enabled: authReady,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateMapStyle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mapStyle: MapStylePreference) => api.apiFetch<{ map_style: MapStylePreference }>('PUT', '/v1/auth/preferences/map-style', { map_style: mapStyle }),
    onMutate: async (mapStyle) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.unitPreferences.current });
      const previous = queryClient.getQueryData<UserPreferencesResponse>(queryKeys.unitPreferences.current);
      if (previous) queryClient.setQueryData(queryKeys.unitPreferences.current, { ...previous, map_style: mapStyle });
      return { previous };
    },
    onError: (_error, _mapStyle, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.unitPreferences.current, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences.current });
    },
  });
}

/** Show or hide the Ownership dashboard for the signed-in user. */
export function useUpdateOwnershipPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.apiFetch<{ ownership_enabled: boolean }>('PUT', '/v1/auth/preferences/ownership', {
        ownership_enabled: enabled,
      }),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.unitPreferences.current });
      const previous = queryClient.getQueryData<UserPreferencesResponse>(queryKeys.unitPreferences.current);
      if (previous) {
        queryClient.setQueryData(queryKeys.unitPreferences.current, { ...previous, ownership_enabled: enabled });
      }
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.unitPreferences.current, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences.current });
    },
  });
}

/** Remember the Vehicle Overview view (cluster or map) for the signed-in user. */
export function useUpdateOverviewView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (view: OverviewViewPreference) =>
      api.apiFetch<{ overview_view: OverviewViewPreference }>('PUT', '/v1/auth/preferences/overview-view', {
        overview_view: view,
      }),
    onMutate: async (view) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.unitPreferences.current });
      const previous = queryClient.getQueryData<UserPreferencesResponse>(queryKeys.unitPreferences.current);
      if (previous) {
        queryClient.setQueryData(queryKeys.unitPreferences.current, { ...previous, overview_view: view });
      }
      return { previous };
    },
    onError: (_error, _view, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.unitPreferences.current, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences.current });
    },
  });
}

/** Remember whether the Vehicle Overview's location map is expanded for the signed-in user. */
export function useUpdateOverviewMapExpanded() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expanded: boolean) =>
      api.apiFetch<{ overview_map_expanded: boolean }>('PUT', '/v1/auth/preferences/overview-map-expanded', {
        overview_map_expanded: expanded,
      }),
    onMutate: async (expanded) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.unitPreferences.current });
      const previous = queryClient.getQueryData<UserPreferencesResponse>(queryKeys.unitPreferences.current);
      if (previous) {
        queryClient.setQueryData(queryKeys.unitPreferences.current, { ...previous, overview_map_expanded: expanded });
      }
      return { previous };
    },
    onError: (_error, _expanded, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.unitPreferences.current, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences.current });
    },
  });
}

/** Whether the signed-in user shows the Ownership dashboard. Off until they turn it on, while it is in preview. */
export function useOwnershipEnabled(): boolean {
  return useUserPreferences().data?.ownership_enabled === true;
}
