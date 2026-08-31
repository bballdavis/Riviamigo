export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePalette = 'classic' | 'rad';

export type ThemeRef =
  | { kind: 'builtin'; themeId: string }
  | { kind: 'custom'; themeId: string; revision: number };

export interface ThemePreferences {
  mode: ThemeMode;
  palette: ThemePalette;
}

export interface ThemePreferencesV2 {
  schemaVersion: 2;
  mode: ThemeMode;
  selection: ThemeRef;
}

export type ThemeTokenValue = string;

export interface ThemeTokenRecord {
  light: ThemeTokenValue;
  dark: ThemeTokenValue;
}

export interface ThemeRecord {
  id: ThemePalette;
  version: 1;
  name: string;
  definitionHash: string;
}

export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  mode: 'dark',
  palette: 'classic',
};
