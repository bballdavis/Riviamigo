import * as React from 'react';
import {
  DEFAULT_THEME_PREFERENCES,
  type ThemeMode,
  type ThemePalette,
  type ThemePreferences,
  type ThemePreferencesV2,
} from '@riviamigo/types';
import { applyLegacyThemePreferences, applyThemeRuntime, resetThemeRuntime } from './themeRuntime';

export type { ThemeMode, ThemePalette, ThemePreferences } from '@riviamigo/types';
export type { ThemePreferencesV2 } from '@riviamigo/types';
export { resolveTheme } from '@riviamigo/themes';

const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function isThemePalette(value: unknown): value is ThemePalette {
  return value === 'classic' || value === 'rad';
}

export function normalizeThemePreferences(value: unknown): ThemePreferences {
  const candidate = value as Partial<ThemePreferences> | null | undefined;
  return {
    mode: isThemeMode(candidate?.mode) ? candidate.mode : DEFAULT_THEME_PREFERENCES.mode,
    palette: isThemePalette(candidate?.palette) ? candidate.palette : DEFAULT_THEME_PREFERENCES.palette,
  };
}

function getThemeMediaQueryList() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }

  return window.matchMedia(THEME_MEDIA_QUERY);
}

export function getSystemThemeMode(): Exclude<ThemeMode, 'system'> {
  const mediaQuery = getThemeMediaQueryList();
  return mediaQuery?.matches ? 'dark' : 'light';
}

export function resolveThemeMode(mode: ThemeMode): Exclude<ThemeMode, 'system'> {
  return mode === 'system' ? getSystemThemeMode() : mode;
}

/** Apply the account-backed visual preference to the document root. */
export function applyThemePreferences(preferences: ThemePreferences | ThemePreferencesV2, resolvedTheme?: import('@riviamigo/themes').ResolvedTheme | null) {
  if ('selection' in preferences) return applyThemeRuntime(preferences, resolvedTheme);
  return applyLegacyThemePreferences(normalizeThemePreferences(preferences));
}

/** Compatibility helper for callers that only need to apply an appearance mode. */
export function applyThemeMode(mode: ThemeMode) {
  applyThemePreferences({ mode, palette: 'classic' });
}

/** Reset to the safe pre-authentication state without reading browser storage. */
export function resetThemePreferences() {
  resetThemeRuntime();
}

/**
 * Retained as a safe bootstrap component for non-authenticated consumers.
 * Account-aware app roots should apply their server response instead.
 */
export { ThemeRuntimeProvider } from './themeRuntime';
export { getThemeRuntimeSnapshot, subscribeThemeRuntime, useThemeRuntime, useThemeRevision, applyThemeRuntime, resolveThemeRuntimeResponse } from './themeRuntime';
export type { ThemeRuntimeSnapshot, ThemeRuntimeProviderProps } from './themeRuntime';

export function ThemeModeSync() { React.useEffect(() => { resetThemePreferences(); }, []); return null; }
