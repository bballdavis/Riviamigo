/**
 * Shared chart configuration: consistent colours, font, tooltip styling.
 * Import CHART_COLORS and CHART_MARGINS wherever you build a Recharts chart.
 *
 * Chart colors intentionally resolve through CSS variables. Recharts and SVG
 * can consume those values directly, while Canvas/uPlot callers use
 * resolveChartColor at their concrete-color boundary.
 */

import { BUILT_IN_THEMES } from '@riviamigo/themes';
import type { ThemePalette } from '@riviamigo/types';
import { colors } from '../tokens/colors';

export type ChartPaletteKey =
  | 'accent'
  | 'emerald'
  | 'amber'
  | 'sky'
  | 'violet'
  | 'rose'
  | 'teal'
  | 'indigo'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted'
  | 'yellow'
  | 'orange';

export const CHART_COLOR_TOKENS = [
  'accent',
  'emerald',
  'amber',
  'sky',
  'violet',
  'rose',
  'teal',
  'indigo',
  'success',
  'warning',
  'danger',
  'muted',
] as const satisfies readonly ChartPaletteKey[];

function chartPalette(palette: ThemePalette): Record<ChartPaletteKey, string> {
  const definition = BUILT_IN_THEMES[palette];
  const keys: ChartPaletteKey[] = [...CHART_COLOR_TOKENS, 'yellow', 'orange'];
  return Object.fromEntries(keys.map((key) => {
    const alias = definition.chartAliases[key];
    const value = typeof alias === 'string' ? definition.tokens.dark[alias as keyof typeof definition.tokens.dark] : alias?.dark ?? definition.tokens.dark.accent;
    return [key, value];
  })) as Record<ChartPaletteKey, string>;
}

export const CHART_PALETTES: Record<ThemePalette, Record<ChartPaletteKey, string>> = {
  classic: chartPalette('classic'),
  rad: chartPalette('rad'),
};

export const CHART_COLORS = {
  accent: 'var(--rm-chart-accent)',
  success: 'var(--rm-chart-success)',
  warning: 'var(--rm-chart-warning)',
  danger: 'var(--rm-chart-danger)',
  muted: 'var(--rm-chart-muted)',
  grid: 'var(--rm-chart-grid)',
  ...colors.dataViz,
} as const;

export const CHART_COLOR_OPTIONS = [
  { value: 'accent', label: 'Theme Accent', color: CHART_COLORS.accent },
  { value: 'emerald', label: 'Emerald', color: CHART_COLORS.emerald },
  { value: 'amber', label: 'Amber', color: CHART_COLORS.amber },
  { value: 'sky', label: 'Sky', color: CHART_COLORS.sky },
  { value: 'violet', label: 'Violet', color: CHART_COLORS.violet },
  { value: 'rose', label: 'Rose', color: CHART_COLORS.rose },
  { value: 'teal', label: 'Teal', color: CHART_COLORS.teal },
  { value: 'indigo', label: 'Indigo', color: CHART_COLORS.indigo },
] as const;

export type ChartColorKey = (typeof CHART_COLOR_OPTIONS)[number]['value'];

function chartVariable(value: string) {
  return `var(--rm-chart-${value})`;
}

export function getChartColor(
  value: string | null | undefined,
  palette?: ThemePalette,
) {
  const key = value as ChartPaletteKey;
  if (palette && key in CHART_PALETTES[palette]) {
    return CHART_PALETTES[palette][key];
  }
  if (key in CHART_PALETTES.classic) return chartVariable(key);
  return chartVariable('accent');
}

export function resolveChartColor(
  value: string,
  element?: Element | null,
    fallback = CHART_PALETTES.classic.accent,
) {
  const variable = value.match(/^var\((--[^,)]+)\)$/)?.[1];
  if (!variable || typeof window === 'undefined') return value;
  const scope = element ?? document.documentElement;
  return window.getComputedStyle(scope).getPropertyValue(variable).trim() || fallback;
}

export const CHART_MARGINS = {
  default: { top: 12, right: 24, left: 8, bottom: 8 },
  withYAxis: { top: 12, right: 24, left: 8, bottom: 8 },
} as const;

export const CHART_FONT = {
  fontFamily: '"Inter Variable", Inter, system-ui, sans-serif',
  fontSize: 12,
  fontWeight: 600,
  fill: 'var(--rm-text-secondary)',
} as const;

/** Shared visual contract for ordinary quantitative bars across dashboard charts. */
export const CHART_BAR_STYLE = {
  slotRatio: 0.66,
  maxWidth: 78,
  radius: 8,
  fillOpacity: 0.96,
  activeOpacity: 1,
} as const;

export const CHART_X_AXIS_DEFAULTS = {
  interval: 'preserveStartEnd',
  minTickGap: 40,
} as const;

export const TICK_STYLE = {
  ...CHART_FONT,
  fill: 'var(--rm-text-secondary)',
} as const;

export const TOOLTIP_CURSOR_STYLE = {
  stroke: 'var(--rm-chart-grid)',
  strokeWidth: 1,
  fill: 'var(--rm-chart-hover-bg)',
} as const;
