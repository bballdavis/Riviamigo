import { beforeAll, describe, expect, it } from 'vitest';

let CHART_COLORS!: typeof import('../../../../packages/ui/src/charts/ChartProvider').CHART_COLORS;
let buildRichTimeSeriesUPlotSeries!: typeof import('../../../../packages/ui/src/charts/RichTimeSeriesChart').buildRichTimeSeriesUPlotSeries;
let getUPlotBarRadius!: typeof import('../../../../packages/ui/src/charts/RichTimeSeriesChart').getUPlotBarRadius;

beforeAll(async () => {
  const provider = await import('../../../../packages/ui/src/charts/ChartProvider');
  const chart = await import('../../../../packages/ui/src/charts/RichTimeSeriesChart');
  CHART_COLORS = provider.CHART_COLORS;
  buildRichTimeSeriesUPlotSeries = chart.buildRichTimeSeriesUPlotSeries;
  getUPlotBarRadius = chart.getUPlotBarRadius;
});

describe('RichTimeSeriesChart bar rendering', () => {
  it('uses a filled color for bars while preserving line styling', () => {
    const options = buildRichTimeSeriesUPlotSeries(
      [
        { key: 'bars', label: 'Bars', values: [1, 2], mode: 'bar' },
        { key: 'line', label: 'Line', values: [2, 3], mode: 'line' },
      ],
      { barCount: 2 },
    );

    expect(options[1]).toMatchObject({
      fill: CHART_COLORS.accent,
      stroke: CHART_COLORS.accent,
      width: 1,
    });
    expect(options[1]?.fill).not.toBeUndefined();
    expect(options[2]).toMatchObject({
      stroke: CHART_COLORS.emerald,
      width: 2,
    });
    expect(options[2]?.fill).toBeUndefined();
  });

  it('uses the shared bar radius for uPlot bars while leaving their baseline square', () => {
    expect(getUPlotBarRadius(78)).toEqual([8 / 78, 0]);
    expect(getUPlotBarRadius(40)).toEqual([0.2, 0]);
  });
});
