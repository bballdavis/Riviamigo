import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys, useBasemapConfig } from '@riviamigo/hooks';
import { DEFAULT_THEME_PREFERENCES, type ThemeMode, type ThemePreferences, type UserPreferencesResponse } from '@riviamigo/types';
import { applyThemePreferences } from '@riviamigo/ui/lib/theme';
import { Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import { ThemeGallery } from './ThemeGallery';
import { AppearanceSettings } from './AppearanceSettings';

interface PreferencesQuery {
  data: UserPreferencesResponse | undefined;
  isLoading: boolean;
}

export function AppearanceSection({ preferencesQuery }: { preferencesQuery: PreferencesQuery }) {
  const queryClient = useQueryClient();
  const basemapConfig = useBasemapConfig();
  const [themePreferences, setThemePreferences] = React.useState<ThemePreferences>(DEFAULT_THEME_PREFERENCES);

  React.useEffect(() => {
    const next = preferencesQuery.data?.theme;
    if (next) setThemePreferences(next);
  }, [preferencesQuery.data?.theme]);

  const updateThemePreferences = useMutation({
    mutationFn: (theme: ThemePreferences) => api.updateThemePreferences(theme),
    scope: { id: 'settings-theme-preferences' },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.unitPreferences.current });
      const previous = queryClient.getQueryData<UserPreferencesResponse>(queryKeys.unitPreferences.current);
      setThemePreferences(next);
      applyThemePreferences(next);
      return { previous };
    },
    onSuccess: (result) => {
      setThemePreferences(result.theme);
      applyThemePreferences(result.theme);
      queryClient.setQueryData(queryKeys.unitPreferences.current, result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.themePreferences.all });
    },
    onError: (_error, _next, context) => {
      const previous = context?.previous?.theme ?? DEFAULT_THEME_PREFERENCES;
      setThemePreferences(previous);
      applyThemePreferences(previous);
      if (context?.previous) queryClient.setQueryData(queryKeys.unitPreferences.current, context.previous);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 rounded-xl border border-border bg-bg-elevated/35 p-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center">
          <div>
            <p className="text-sm font-medium text-fg">Appearance mode</p>
            <p className="mt-0.5 text-xs text-fg-tertiary">Choose light, dark, or follow your device. This setting follows your account across browsers.</p>
          </div>
          <SelectPicker
            className="w-full"
            value={themePreferences.mode}
            onChange={(value) => updateThemePreferences.mutate({ ...themePreferences, mode: value as ThemeMode })}
            aria-label="Appearance mode"
            disabled={preferencesQuery.isLoading || updateThemePreferences.isPending}
            options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]}
          />
        </div>

        <div className="grid gap-3 rounded-xl border border-border bg-bg-elevated/35 p-4">
          <div>
            <p className="text-sm font-medium text-fg">Theme</p>
            <p className="mt-0.5 text-xs text-fg-tertiary">Choose a built-in theme or create a private theme with its own interface, chart, and brand colors.</p>
          </div>
          <ThemeGallery />
        </div>

        {basemapConfig.data?.resolved_provider === 'openfreemap' ? <AppearanceSettings mapStyle={preferencesQuery.data?.map_style ?? 'follow-theme'} /> : null}

        {updateThemePreferences.isPending ? <p className="text-xs text-fg-tertiary" role="status">Saving appearance preferences...</p> : null}
        {updateThemePreferences.isError ? <p className="text-xs text-status-danger" role="alert">Unable to save appearance preferences. Your previous selection has been restored.</p> : null}
      </CardContent>
    </Card>
  );
}
