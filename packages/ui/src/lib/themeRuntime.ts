import * as React from 'react';
import {
  BUILT_IN_THEMES,
  resolveTheme,
  type ResolvedTheme,
  type ThemeDefinition,
} from '@riviamigo/themes';
import {
  DEFAULT_THEME_PREFERENCES,
  type ThemeMode,
  type ThemePalette,
  type ThemePreferences,
  type ThemePreferencesV2,
  type ThemeRef,
  type ThemePreferencesResponse,
} from '@riviamigo/types';
import { getBrandAsset, type BrandAssetKind } from './brandAssets';

export type ThemeSelection = ThemePreferences | ThemePreferencesV2;
export type ResolvedCustomTheme = ResolvedTheme;

export function resolveThemeRuntimeResponse(response: ThemePreferencesResponse | null | undefined) {
  const preferences = response?.preferences;
  const selection = preferences?.selection;
  const resolvedTheme = selection?.kind === 'custom'
    ? resolveTheme({ theme: selection.baseThemeId, ...selection.definition } as Parameters<typeof resolveTheme>[0])
    : null;
  return { preferences: preferences ?? null, resolvedTheme };
}
export interface ThemeRuntimeSnapshot {
  selectedMode: ThemeMode;
  effectiveMode: Exclude<ThemeMode, 'system'>;
  themeRef: ThemeRef;
  revision: number;
  legacyPalette: ThemePalette;
  cssVariables: Readonly<Record<string, string>>;
  chartColors: Readonly<Record<string, string>>;
  brandAssets: Readonly<Record<BrandAssetKind, string>>;
}

const MEDIA = '(prefers-color-scheme: dark)';
const CHART_KEYS = ['accent','success','warning','danger','muted','emerald','amber','sky','violet','rose','teal','indigo','yellow','orange'] as const;
const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;
let snapshot = makeSnapshot(DEFAULT_THEME_PREFERENCES);
let activeSelection: ThemeSelection = DEFAULT_THEME_PREFERENCES;
let activeCustom: ResolvedTheme | null | undefined;

function systemMode(): 'light' | 'dark' {
  return typeof window !== 'undefined' && window.matchMedia?.(MEDIA).matches ? 'dark' : 'light';
}

function isV2(value: ThemeSelection): value is ThemePreferencesV2 {
  return 'selection' in value;
}

function definitionFor(selection: ThemeSelection, custom?: ResolvedTheme | null): { definition: ThemeDefinition; ref: ThemeRef; palette: ThemePalette } {
  if (isV2(selection)) {
    const ref = selection.selection;
    if (!ref || typeof ref !== 'object') return { definition: BUILT_IN_THEMES.classic, ref: { kind: 'builtin', themeId: 'classic' }, palette: 'classic' };
    if (ref.kind === 'custom' && custom) return { definition: custom, ref, palette: custom.sourceTheme };
    const palette = ref.kind === 'builtin' && ref.themeId === 'rad' ? 'rad' : 'classic';
    return { definition: BUILT_IN_THEMES[palette], ref: { kind: 'builtin', themeId: palette }, palette };
  }
  const palette = selection.palette;
  return { definition: BUILT_IN_THEMES[palette], ref: { kind: 'builtin', themeId: palette }, palette };
}

function normalizeSelection(value: ThemeSelection): ThemeSelection {
  if (isV2(value)) return { schemaVersion: 2, mode: value.mode === 'light' || value.mode === 'system' ? value.mode : 'dark', selection: value.selection };
  return { mode: value.mode === 'light' || value.mode === 'system' ? value.mode : 'dark', palette: value.palette === 'rad' ? 'rad' : 'classic' };
}

function makeSnapshot(input: ThemeSelection, custom?: ResolvedTheme | null): ThemeRuntimeSnapshot {
  const selection = normalizeSelection(input);
  const mode = selection.mode;
  const { definition, ref, palette } = definitionFor(selection, custom);
  const effectiveMode = mode === 'system' ? systemMode() : mode;
  const values = definition.tokens[effectiveMode];
  const cssVariables: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) cssVariables[`--rm-${key}`] = value;
  for (const key of CHART_KEYS) {
    const alias = definition.chartAliases[key];
    cssVariables[`--rm-chart-${key}`] = typeof alias === 'string' ? definition.tokens[effectiveMode][alias as keyof typeof values] ?? definition.series['series-01']![effectiveMode] : alias?.[effectiveMode] ?? definition.series['series-01']![effectiveMode];
  }
  for (let i = 0; i < 6; i += 1) {
    const seriesKey = `series-${String(i + 1).padStart(2, '0')}` as keyof typeof definition.series;
    cssVariables[`--rm-map-route-${i}`] = definition.tokens[effectiveMode][`map-route-${i}` as keyof typeof values] ?? definition.series[seriesKey]![effectiveMode];
  }
  const chartColors = Object.fromEntries(CHART_KEYS.map((key) => [key, cssVariables[`--rm-chart-${key}`]!])) as Record<string, string>;
  const brandAssets = Object.fromEntries((['wordmark','logo','icon','favicon'] as const).map((kind) => [kind, definition.brandAssets[kind][effectiveMode]])) as Record<BrandAssetKind, string>;
  return { selectedMode: mode, effectiveMode, themeRef: ref, revision: ref.kind === 'custom' ? ref.revision : 0, legacyPalette: palette, cssVariables, chartColors, brandAssets };
}

function applySnapshot(next: ThemeRuntimeSnapshot) {
  snapshot = next;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.remove('light', 'dark'); root.classList.add(next.effectiveMode);
    root.dataset.rmPalette = next.legacyPalette;
    root.dataset.rmThemeId = next.themeRef.themeId;
    root.dataset.rmThemeKind = next.themeRef.kind;
    root.dataset.rmThemeRevision = String(next.revision);
    root.style.colorScheme = next.effectiveMode;
    for (const [name, value] of Object.entries(next.cssVariables)) root.style.setProperty(name, value);
    const favicon = document.querySelector<HTMLLinkElement>('link[data-rm-favicon]');
    if (favicon) favicon.href = next.brandAssets.favicon || getBrandAsset('favicon', { palette: next.legacyPalette, dark: next.effectiveMode === 'dark' });
  }
  listeners.forEach((listener) => listener());
}

function watchSystem() {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  mediaQuery?.removeEventListener?.('change', onSystemChange); mediaQuery?.removeListener?.(onSystemChange);
  mediaQuery = window.matchMedia(MEDIA);
  mediaQuery.addEventListener?.('change', onSystemChange); mediaQuery.addListener?.(onSystemChange);
}
function onSystemChange() { if (snapshot.selectedMode === 'system') applySnapshot(makeSnapshot(activeSelection, activeCustom)); }

export function getThemeRuntimeSnapshot() { return snapshot; }
export function subscribeThemeRuntime(listener: () => void) { listeners.add(listener); watchSystem(); return () => listeners.delete(listener); }
export function applyThemeRuntime(selection: ThemeSelection, custom?: ResolvedTheme | null) { activeSelection = selection; activeCustom = custom; applySnapshot(makeSnapshot(selection, custom)); watchSystem(); return snapshot; }
export function applyLegacyThemePreferences(preferences: ThemePreferences) {
  if (
    isV2(activeSelection)
    && activeSelection.selection?.kind === 'custom'
    && preferences.palette === activeCustom?.sourceTheme
  ) {
    return applyThemeRuntime({ ...activeSelection, mode: preferences.mode }, activeCustom);
  }
  return applyThemeRuntime(preferences);
}
export function resetThemeRuntime() { return applyThemeRuntime(DEFAULT_THEME_PREFERENCES); }
export function useThemeRuntime() { return React.useSyncExternalStore(subscribeThemeRuntime, getThemeRuntimeSnapshot, getThemeRuntimeSnapshot); }
export function useThemeRevision() { return useThemeRuntime().revision; }

export interface ThemeRuntimeProviderProps { preferences?: ThemeSelection | null; resolvedTheme?: ResolvedTheme | null; children: React.ReactNode; }
export function ThemeRuntimeProvider({ preferences, resolvedTheme, children }: ThemeRuntimeProviderProps) {
  React.useEffect(() => { if (preferences) applyThemeRuntime(preferences, resolvedTheme); else resetThemeRuntime(); }, [preferences, resolvedTheme]);
  return React.createElement(React.Fragment, null, children);
}
