import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, themeClient, useAuth } from '@riviamigo/hooks';
import type { ThemeMode, ThemePreferencesResponse } from '@riviamigo/types';
import { applyThemePreferences, resolveThemeRuntimeResponse, useThemeRuntime } from '@riviamigo/ui/lib/theme';
import { emitToast } from '../components/feedback/toast';

/** Mode changes retain the server's exact theme selection, including custom revisions. */
export function useThemePreferenceController() {
  const queryClient = useQueryClient();
  const userId = useAuth((state) => state.userId);
  const runtime = useThemeRuntime();
  const pending = React.useRef<string | null>(null);
  const queryKey = queryKeys.themePreferences.forUser(userId ?? 'signed-out');
  const preference = useQuery({ queryKey, queryFn: () => themeClient.getPreferences(), enabled: !!userId });
  const mutation = useMutation({
    mutationFn: async ({ mode, owner }: { mode: ThemeMode; owner: string }) => {
      const key = queryKeys.themePreferences.forUser(owner);
      const current = queryClient.getQueryData<ThemePreferencesResponse>(key);
      if (!current?.etag) throw new Error('Appearance preferences are still loading.');
      if (useAuth.getState().userId !== owner) throw new Error('Account changed.');
      return themeClient.updatePreferences({ ...current.preferences, mode }, current.etag);
    },
    onSuccess: (response, { owner }) => {
      if (useAuth.getState().userId !== owner) return;
      queryClient.setQueryData(queryKeys.themePreferences.forUser(owner), response);
      const { preferences, resolvedTheme } = resolveThemeRuntimeResponse(response);
      if (preferences) applyThemePreferences(preferences, resolvedTheme);
      void queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences.current });
    },
    onError: (_error, { owner }) => {
      if (useAuth.getState().userId !== owner) return;
      emitToast({ title: 'Appearance could not be saved', message: 'Your previous appearance is unchanged. Please try again.', variant: 'error' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.themePreferences.forUser(owner) });
    },
  });

  const onModeChange = React.useCallback((mode: ThemeMode) => {
    if (!userId || pending.current === userId || !preference.data?.etag) return;
    pending.current = userId;
    mutation.mutate({ mode, owner: userId }, { onSettled: () => { if (pending.current === userId) pending.current = null; } });
  }, [userId, preference.data?.etag, mutation]);
  return { mode: preference.data?.preferences.mode ?? runtime.selectedMode, onModeChange, isPending: (mutation.isPending && mutation.variables?.owner === userId) || !preference.data?.etag, error: mutation.error };
}
