import { describe, expect, it } from 'vitest';
import { CHART_COLOR_TOKENS, CHART_PALETTES, getChartColor } from '../../../../packages/ui/src/charts/ChartProvider';

describe('chart token colors', () => {
  it('provides concrete classic and RAD values for every saved token', () => {
    for (const token of CHART_COLOR_TOKENS) {
      for (const palette of ['classic', 'rad'] as const) {
        const color = getChartColor(token, palette);
        expect(color, `${palette}:${token}`).not.toContain('var(');
        expect(color, `${palette}:${token}`).toMatch(/^#/);
        expect(CHART_PALETTES[palette][token], `${palette}:${token}`).toBe(color);
      }
    }
  });

  it('keeps the default runtime lookup palette-aware through CSS variables', () => {
    expect(getChartColor('accent')).toBe('var(--rm-chart-accent)');
  });
});
