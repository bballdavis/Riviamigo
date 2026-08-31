import type { ThemePalette } from '@riviamigo/types';

export type BrandAssetKind = 'wordmark' | 'logo' | 'icon' | 'favicon';

export interface BrandAssetOptions {
  palette?: ThemePalette;
  dark?: boolean;
}

const CLASSIC_ASSETS: Record<BrandAssetKind, { dark: string; light: string }> = {
  wordmark: { dark: '/text_white.svg', light: '/text_black.svg' },
  logo: { dark: '/logo_color_lighter.svg', light: '/logo_color_lighter.svg' },
  icon: { dark: '/icon_color_lighter.svg', light: '/icon_color_lighter.svg' },
  favicon: { dark: '/favicon.svg', light: '/favicon.svg' },
};

const RAD_ASSETS: Record<BrandAssetKind, { dark: string; light: string }> = {
  wordmark: { dark: '/rad-text_white.svg', light: '/rad-text_black.svg' },
  logo: { dark: '/rad-logo.svg', light: '/rad-logo.svg' },
  icon: { dark: '/rad-icon.svg', light: '/rad-icon.svg' },
  favicon: { dark: '/rad-favicon.svg', light: '/rad-favicon.svg' },
};

/** Single source of truth for app brand assets; docs keep their static classic assets. */
export function getBrandAsset(kind: BrandAssetKind, options: BrandAssetOptions = {}): string {
  const assets = options.palette === 'rad' ? RAD_ASSETS : CLASSIC_ASSETS;
  return assets[kind][options.dark === false ? 'light' : 'dark'];
}
