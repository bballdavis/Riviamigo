import type { MapStylePreference } from '@riviamigo/types';
import { MAP_STYLE_PREFERENCE_OPTIONS } from '@riviamigo/ui/lib/mapStyles';

/** Which panel the Vehicle Overview's center stage shows. */
export type OverviewView = 'cluster' | 'map';

/** `auto` follows the app's light/dark appearance. */
export type OverviewMapMode = 'auto' | 'light' | 'dark';

/** `app` uses the map style chosen in Settings > Appearance. */
export type OverviewMapStyle = 'app' | MapStylePreference;

export interface OverviewMapOptions {
  /** Whether the cluster/map toggle is offered at all. */
  enabled: boolean;
  mode: OverviewMapMode;
  style: OverviewMapStyle;
}

export const DEFAULT_OVERVIEW_MAP_OPTIONS: OverviewMapOptions = {
  enabled: true,
  mode: 'auto',
  style: 'app',
};

export const OVERVIEW_MAP_MODE_OPTIONS: ReadonlyArray<{ value: OverviewMapMode; label: string }> = [
  { value: 'auto', label: 'Follow appearance' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export const OVERVIEW_MAP_STYLE_OPTIONS: ReadonlyArray<{ value: OverviewMapStyle; label: string }> = [
  { value: 'app', label: 'App setting' },
  // "Follow appearance" here would read as a light/dark control, which the
  // mode picker above already owns; the remaining styles are all real choices.
  ...MAP_STYLE_PREFERENCE_OPTIONS.filter((option) => option.value !== 'follow-theme'),
];

const MODE_VALUES = new Set<string>(OVERVIEW_MAP_MODE_OPTIONS.map((option) => option.value));
const STYLE_VALUES = new Set<string>(OVERVIEW_MAP_STYLE_OPTIONS.map((option) => option.value));

/** Reads the saved widget options, falling back to defaults for anything absent or unknown. */
export function resolveOverviewMapOptions(options: Record<string, unknown> | undefined): OverviewMapOptions {
  const mode = options?.mapMode;
  const style = options?.mapStyle;
  return {
    enabled: options?.locationMap !== false,
    mode: typeof mode === 'string' && MODE_VALUES.has(mode) ? (mode as OverviewMapMode) : DEFAULT_OVERVIEW_MAP_OPTIONS.mode,
    style: typeof style === 'string' && STYLE_VALUES.has(style) ? (style as OverviewMapStyle) : DEFAULT_OVERVIEW_MAP_OPTIONS.style,
  };
}
