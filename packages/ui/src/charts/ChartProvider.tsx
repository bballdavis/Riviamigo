/**
 * Shared chart configuration: consistent colours, font, tooltip styling.
 * Import CHART_COLORS and CHART_MARGINS wherever you build a Recharts chart.
 */

import { colors } from '../tokens/colors';

export const CHART_COLORS = {
  accent: colors.accent[500],
  success: colors.soc.high,
  warning: colors.soc.mid,
  danger: colors.soc.low,
  muted: colors.slate[400],
  grid: 'var(--rm-chart-grid)',
  ...colors.dataViz,
} as const;

export const CHART_COLOR_OPTIONS = [
  { value: 'accent', label: 'Theme Accent', color: 'var(--rm-accent)' },
  { value: 'emerald', label: 'Emerald', color: CHART_COLORS.emerald },
  { value: 'amber', label: 'Amber', color: CHART_COLORS.amber },
  { value: 'sky', label: 'Sky', color: CHART_COLORS.sky },
  { value: 'violet', label: 'Violet', color: CHART_COLORS.violet },
  { value: 'rose', label: 'Rose', color: CHART_COLORS.rose },
  { value: 'teal', label: 'Teal', color: CHART_COLORS.teal },
  { value: 'indigo', label: 'Indigo', color: CHART_COLORS.indigo },
] as const;

export type ChartColorKey = (typeof CHART_COLOR_OPTIONS)[number]['value'];

export function getChartColor(value: string | null | undefined) {
  return (
    CHART_COLOR_OPTIONS.find((option) => option.value === value)?.color ??
    CHART_COLOR_OPTIONS[0].color
  );
}

export const CHART_MARGINS = {
  default: { top: 12, right: 24, left: 8, bottom: 8 },
  withYAxis: { top: 12, right: 24, left: 8, bottom: 8 },
} as const;

export const CHART_FONT = {
  fontFamily: '"Inter Variable", Inter, system-ui, sans-serif',
  fontSize: 12,
  fontWeight: 600,
  fill: colors.slate[400],
} as const;

export const TICK_STYLE = {
  ...CHART_FONT,
  fill: colors.slate[400],
} as const;

export const TOOLTIP_CURSOR_STYLE = {
  stroke: 'var(--rm-chart-grid)',
  strokeWidth: 1,
  fill: 'var(--rm-chart-hover-bg)',
} as const;
