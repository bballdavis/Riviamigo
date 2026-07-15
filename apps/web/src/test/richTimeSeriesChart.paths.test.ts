import { describe, expect, it } from 'vitest';
import { buildRichTimeSeriesUPlotSeries } from '../../../../packages/ui/src/charts/RichTimeSeriesChart';

describe('RichTimeSeriesChart paths', () => {
  it('uses a native path for Straight and the same native spline for both curved settings', () => {
    const item = { key: 'history', label: 'History', values: [10, 15, 12] };
    const straight = buildRichTimeSeriesUPlotSeries([item], { smoothness: 'straight' })[1]!;
    const gentle = buildRichTimeSeriesUPlotSeries([item], { smoothness: 'gentle' })[1]!;
    const smooth = buildRichTimeSeriesUPlotSeries([item], { smoothness: 'smooth' })[1]!;

    expect(straight.paths).toBeUndefined();
    expect(gentle.paths).toBeDefined();
    expect(smooth.paths).toBe(gentle.paths);
  });

  it('keeps stepped paths and non-smoothable supporting series native', () => {
    const stepped = buildRichTimeSeriesUPlotSeries(
      [{ key: 'history', label: 'History', values: [10, 15, 12] }],
      { smoothness: 'smooth', stepInterpolation: true },
    )[1]!;
    const supporting = buildRichTimeSeriesUPlotSeries(
      [{ key: 'supporting', label: 'Supporting', values: [10, 15, 12], smoothable: false }],
      { smoothness: 'smooth' },
    )[1]!;

    expect(stepped.paths).toBeDefined();
    expect(supporting.paths).toBeUndefined();
  });

  it('configures dense curved data without inspecting every point during path selection', () => {
    const denseValues = Array.from({ length: 50_000 }, (_, index) => index % 97);
    const series = buildRichTimeSeriesUPlotSeries(
      [{ key: 'dense', label: 'Dense history', values: denseValues }],
      { smoothness: 'smooth' },
    )[1]!;

    expect(series.paths).toBeDefined();
    expect(series.paths).toBe(buildRichTimeSeriesUPlotSeries(
      [{ key: 'small', label: 'Small history', values: [1, 2, 3] }],
      { smoothness: 'gentle' },
    )[1]!.paths);
  });
});
