import { describe, expect, it } from 'vitest';
import { getChartColor } from '../../../../packages/ui/src/charts/ChartProvider';

describe('chart token colors', () => {
  it('resolves every saved token to a concrete color for canvas charts', () => {
    for (const token of ['accent', 'emerald', 'amber', 'sky', 'violet', 'rose', 'teal', 'indigo', 'success', 'warning', 'danger', 'muted']) {
      const color = getChartColor(token);
      expect(color, token).not.toContain('var(');
      expect(color, token).toMatch(/^#/);
    }
  });
});
