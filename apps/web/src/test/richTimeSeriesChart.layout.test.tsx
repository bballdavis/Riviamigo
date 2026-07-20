import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { carryForwardTooltipValues, formatAxisDateForSpan, formatChartNumber, getAdaptiveDecimalPrecision, getCalendarDateSplits, isZoomedXRange, RichTimeSeriesChart } from '@riviamigo/ui/charts';

describe('RichTimeSeriesChart layout safety', () => {
  it('keeps a left gutter so y-axis labels are not clipped', async () => {
    const { container } = render(
      <RichTimeSeriesChart
        points={[
          { ts: '2024-01-01T00:00:00Z' },
          { ts: '2024-01-02T00:00:00Z' },
        ]}
        series={[{ key: 'soc', label: 'State of Charge', values: [79, 80] }]}
        yUnit="%"
        height={240}
        loading={false}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.uplot')).toBeTruthy();
    });

    const axisNodes = Array.from(container.querySelectorAll('.u-axis'));
    const yAxisNode = axisNodes.at(-1) as HTMLElement | undefined;
    expect(yAxisNode).toBeTruthy();
    expect(yAxisNode?.style.left).not.toBe('0px');
  });
});

describe('RichTimeSeriesChart numeric precision', () => {
  it('uses enough decimals to keep adjacent tick labels distinct', () => {
    expect(getAdaptiveDecimalPrecision([111.7, 111.8, 111.9, 112.0])).toBe(1);
  });

  it('keeps trailing zeros when a decimal tick precision is required', () => {
    expect(formatChartNumber(112, 'kWh', 1)).toBe('112.0 kWh');
  });

  it('keeps whole numbers whole when precision is not needed', () => {
    expect(formatChartNumber(112, 'kWh', 0)).toBe('112 kWh');
  });
});

describe('RichTimeSeriesChart gap handling', () => {
  it('carries the last finite reading through gaps without inventing a leading value', () => {
    expect(carryForwardTooltipValues([null, 12, null, null, 15, null])).toEqual([null, 12, 12, 12, 15, 15]);
  });
});

describe('RichTimeSeriesChart zoom state', () => {
  it('only treats a changed x-range as zoomed', () => {
    expect(isZoomedXRange([0, 100], [0, 100])).toBe(false);
    expect(isZoomedXRange([20, 80], [0, 100])).toBe(true);
  });
});

describe('RichTimeSeriesChart multi-day time axes', () => {
  it('uses concise dates on the axis while retaining calendar-aligned splits', () => {
    const start = Date.parse('2024-07-17T12:00:00Z') / 1000;
    const end = Date.parse('2024-07-20T12:00:00Z') / 1000;
    const splits = getCalendarDateSplits(start, end);
    expect(formatAxisDateForSpan(start, end - start)).not.toMatch(/AM|PM|:/);
    expect(splits).toBeDefined();
    expect(new Set(splits).size).toBe(splits?.length);
  });
});
