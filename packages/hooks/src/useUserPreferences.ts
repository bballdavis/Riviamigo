import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MapStylePreference, UserPreferencesResponse } from '@riviamigo/types';
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
