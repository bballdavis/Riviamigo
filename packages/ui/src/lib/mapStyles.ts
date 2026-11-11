import type { MapStylePreference } from '@riviamigo/types';

/** User-facing names for every basemap style preference, in picker order. */
export const MAP_STYLE_PREFERENCE_OPTIONS: ReadonlyArray<{ value: MapStylePreference; label: string }> = [
  { value: 'follow-theme', label: 'Follow appearance' },
  { value: 'positron', label: 'Positron' },
  { value: 'bright', label: 'Bright' },
  { value: 'liberty', label: 'Liberty' },
  { value: 'dark', label: 'Dark' },
  { value: 'fiord', label: 'Fiord' },
  { value: '3d', label: '3D (Liberty)' },
];
