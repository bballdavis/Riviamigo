import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys, themeClient, useAuth, useBasemapConfig, useUpdateMapStyle } from '@riviamigo/hooks';
import {
  DEFAULT_THEME_PREFERENCES,
  type MapStylePreference,
  type ThemeMode,
  type ThemePreferences,
  type ThemePreferencesResponse,
  type ThemePreferencesV2,
  type ThemePreferencesV2Selection,
  type ThemeRef,
  type UserPreferencesResponse,
} from '@riviamigo/types';
import type { ResolvedTheme } from '@riviamigo/themes';
import { applyThemePreferences, resolveThemeRuntimeResponse } from '@riviamigo/ui/lib/theme';
import { Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import { useSettingsDraft } from './drafts/SettingsDraftProvider';
import { useStagedValue } from './drafts/useStagedValue';
import { ThemeGallery, type ThemeGalleryChoice } from './ThemeGallery';
import { AppearanceSettings } from './AppearanceSettings';

interface PreferencesQuery {
  data: UserPreferencesResponse | undefined;
  isLoading: boolean;
}

/** A theme selection plus the resolved definition needed to preview it. */
interface ThemeChoice {
  ref: ThemeRef;
  resolved: ResolvedTheme | null;
}

/** The appearance values as the server last reported them. */
interface SavedAppearance {
  mode: ThemeMode;
  palette: ThemePreferences['palette'];
  choice: ThemeChoice | null;
  mapStyle: MapStylePreference;
}

function toThemeRef(selection: ThemePreferencesV2Selection): ThemeRef {
  return selection.kind === 'custom'
    ? { kind: 'custom', themeId: selection.themeId, revision: selection.revision }
    : { kind: 'builtin', themeId: selection.themeId };
}

function sameRef(left: ThemeRef, right: ThemeRef) {
  if (left.kind !== right.kind || left.themeId !== right.themeId) return false;
  return left.kind === 'builtin' || (right.kind === 'custom' && left.revision === right.revision);
}

function sameChoice(left: ThemeChoice | null, right: ThemeChoice | null) {
  if (left === null || right === null) return left === right;
  return sameRef(left.ref, right.ref);
}

/** The runtime to show for a mode and theme choice. Without a loaded selection, the legacy palette stands in. */
function runtimeFor(mode: ThemeMode, palette: ThemePreferences['palette'], choice: ThemeChoice | null): { preferences: ThemePreferences | ThemePreferencesV2; resolved: ResolvedTheme | null } {
  if (!choice) return { preferences: { mode, palette }, resolved: null };
  return { preferences: { schemaVersion: 2, mode, selection: choice.ref }, resolved: choice.resolved };
}

/**
 * Appearance mode, theme, and map style are one staged draft. Edits preview
 * live on the document root; Save persists the changed parts, and Discard or
 * leaving the section restores the saved theme.
 */
export function AppearanceSection({ preferencesQuery }: { preferencesQuery: PreferencesQuery }) {
  const queryClient = useQueryClient();
  const basemapConfig = useBasemapConfig();
  const userId = useAuth((state) => state.userId);
  const preferenceKey = queryKeys.themePreferences.forUser(userId ?? 'signed-out');
  const preference = useQuery({ queryKey: preferenceKey, queryFn: () => themeClient.getPreferences(), enabled: !!userId });
  const updateMapStyle = useUpdateMapStyle();
  const [applying, setApplying] = React.useState(false);

  const updateThemeMode = useMutation({
    mutationFn: (theme: ThemePreferences) => api.updateThemePreferences(theme),
    scope: { id: 'settings-theme-preferences' },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.unitPreferences.current, result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.themePreferences.all });
    },
  });

  const selectTheme = useMutation({
    mutationFn: ({ mode, selection, etag }: { mode: ThemeMode; selection: ThemeRef; etag: string }) =>
      themeClient.updatePreferences({ schemaVersion: 2, mode, selection }, etag),
    onSuccess: (response: ThemePreferencesResponse) => {
      queryClient.setQueryData(preferenceKey, response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences.current });
    },
  });

  const savedPreference = preference.data;
  const savedChoice = React.useMemo<ThemeChoice | null>(() => {
    if (!savedPreference) return null;
    const { preferences, resolvedTheme } = resolveThemeRuntimeResponse(savedPreference);
    return preferences ? { ref: toThemeRef(preferences.selection), resolved: resolvedTheme } : null;
  }, [savedPreference]);

  const server = React.useMemo<SavedAppearance>(() => ({
    mode: preferencesQuery.data?.theme?.mode ?? DEFAULT_THEME_PREFERENCES.mode,
    palette: preferencesQuery.data?.theme?.palette ?? DEFAULT_THEME_PREFERENCES.palette,
    choice: savedChoice,
    mapStyle: preferencesQuery.data?.map_style ?? 'follow-theme',
  }), [preferencesQuery.data, savedChoice]);

  // Saved values only move between saves. The map-style hook writes its value into the
  // preference cache optimistically and rolls it back on failure; a baseline that followed
  // the cache mid-save would hide the bar or drop staged edits. Hold it until the save ends.
  const [settled, setSettled] = React.useState(server);
  React.useEffect(() => {
    if (!applying) setSettled(server);
  }, [applying, server]);

  const mode = useStagedValue<ThemeMode>(settled.mode);
  const choice = useStagedValue<ThemeChoice | null>(settled.choice, sameChoice);
  const mapStyle = useStagedValue<MapStylePreference>(settled.mapStyle);
  const themeDirty = mode.isDirty || choice.isDirty;

  const savedRuntime = React.useMemo(() => runtimeFor(server.mode, server.palette, server.choice), [server]);
  const stagedRuntime = React.useMemo(() => runtimeFor(mode.value, server.palette, choice.value), [mode.value, choice.value, server.palette]);
  const previewing = React.useRef(false);
  const revertPreview = React.useCallback(() => {
    if (!previewing.current) return;
    previewing.current = false;
    applyThemePreferences(savedRuntime.preferences, savedRuntime.resolved);
  }, [savedRuntime]);

  React.useEffect(() => {
    if (themeDirty) {
      previewing.current = true;
      applyThemePreferences(stagedRuntime.preferences, stagedRuntime.resolved);
    } else if (!applying) {
      revertPreview();
    }
  }, [applying, revertPreview, stagedRuntime, themeDirty]);

  // Leaving the section with a previewed theme still staged restores the saved one.
  const revertRef = React.useRef(revertPreview);
  revertRef.current = revertPreview;
  React.useEffect(() => () => revertRef.current(), []);

  async function saveAppearance() {
    setApplying(true);
    try {
      if (choice.isDirty && choice.value) {
        const staged = choice.value;
        const current = queryClient.getQueryData<ThemePreferencesResponse>(preferenceKey) ?? savedPreference;
        if (!current?.etag) throw new Error('Appearance preferences are still loading.');
        try {
          await selectTheme.mutateAsync({
            mode: mode.isDirty ? mode.value : current.preferences.mode,
            selection: staged.ref,
            etag: current.etag,
          });
        } catch {
          // The saved theme may have changed elsewhere; refresh so the next save carries the current etag.
          void queryClient.invalidateQueries({ queryKey: preferenceKey });
          throw new Error('The theme changed elsewhere or could not be saved. Refresh and try again.');
        }
        choice.commit(staged);
      }
      if (mode.isDirty) {
        const staged = mode.value;
        try {
          await updateThemeMode.mutateAsync({ mode: staged, palette: server.palette });
        } catch {
          throw new Error('Unable to save appearance mode. Try again or discard your changes.');
        }
        mode.commit(staged);
      }
      if (mapStyle.isDirty) {
        const staged = mapStyle.value;
        try {
          await updateMapStyle.mutateAsync(staged);
        } catch {
          throw new Error('Unable to save map style.');
        }
        mapStyle.commit(staged);
      }
    } finally {
      setApplying(false);
    }
  }

  function discard() {
    mode.reset();
    choice.reset();
    mapStyle.reset();
    revertPreview();
  }

  useSettingsDraft('appearance', {
    isDirty: themeDirty || mapStyle.isDirty,
    save: saveAppearance,
    discard,
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
            value={mode.value}
            onChange={(value) => mode.setValue(value as ThemeMode)}
            aria-label="Appearance mode"
            disabled={preferencesQuery.isLoading || applying}
            options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]}
          />
        </div>

        <div className="grid gap-3 rounded-xl border border-border bg-bg-elevated/35 p-4">
          <div>
            <p className="text-sm font-medium text-fg">Theme</p>
            <p className="mt-0.5 text-xs text-fg-tertiary">Choose a built-in theme or create a private theme with its own interface, chart, and brand colors.</p>
          </div>
          <ThemeGallery
            selected={choice.value?.ref}
            loading={preference.isLoading}
            disabled={applying}
            onSelect={(next: ThemeGalleryChoice) => choice.setValue({ ref: next.selection, resolved: next.resolvedTheme })}
          />
        </div>

        {basemapConfig.data?.resolved_provider === 'openfreemap' ? <AppearanceSettings mapStyle={mapStyle.value} onChange={mapStyle.setValue} disabled={applying} /> : null}
      </CardContent>
    </Card>
  );
}
