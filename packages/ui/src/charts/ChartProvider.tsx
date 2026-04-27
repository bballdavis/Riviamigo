/**
 * Shared chart configuration: consistent colours, font, tooltip styling.
 * Import CHART_COLORS and CHART_MARGINS wherever you build a Recharts chart.
 */

import { colors } from '../tokens/colors';

export const CHART_COLORS = {
  accent:  colors.accent[500],
  success: colors.soc.high,
  warning: colors.soc.mid,
  danger:  colors.soc.low,
  muted:   colors.slate[600],
  grid:    'rgba(255,255,255,0.06)',
  ...colors.dataViz,
} as const;

export const CHART_MARGINS = {
  default: { top: 8, right: 16, left: 0, bottom: 0 },
  withYAxis: { top: 8, right: 16, left: -16, bottom: 0 },
} as const;

export const CHART_FONT = {
  fontFamily: '"Inter Variable", Inter, system-ui, sans-serif',
  fontSize: 11,
  fill: colors.slate[500],
} as const;

export const TICK_STYLE = {
  ...CHART_FONT,
  fill: colors.slate[500],
} as const;

export const TOOLTIP_CURSOR_STYLE = {
  stroke: 'rgba(255,255,255,0.06)',
  strokeWidth: 1,
  fill: 'rgba(255,255,255,0.02)',
} as const;
