import * as React from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'rm-theme';
const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
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

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyThemeMode(mode: ThemeMode, options: { persist?: boolean } = {}) {
  if (typeof window === 'undefined') return;

  const resolved = resolveThemeMode(mode);
  const html = document.documentElement;

  html.classList.remove('light', 'dark');
  html.classList.add(resolved);
  html.style.colorScheme = resolved;

  if (options.persist !== false) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Ignore storage failures.
    }
  }
}

export function syncDocumentTheme() {
  applyThemeMode(getStoredThemeMode(), { persist: false });
}

export function ThemeModeSync() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = () => {
      syncDocumentTheme();
    };

    sync();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        sync();
      }
    };

    const mediaQuery = getThemeMediaQueryList();
    const handleMediaChange = () => {
      if (getStoredThemeMode() === 'system') {
        sync();
      }
    };

    window.addEventListener('storage', handleStorage);
    mediaQuery?.addEventListener?.('change', handleMediaChange);
    mediaQuery?.addListener?.(handleMediaChange);

    return () => {
      window.removeEventListener('storage', handleStorage);
      mediaQuery?.removeEventListener?.('change', handleMediaChange);
      mediaQuery?.removeListener?.(handleMediaChange);
    };
  }, []);

  return null;
}
