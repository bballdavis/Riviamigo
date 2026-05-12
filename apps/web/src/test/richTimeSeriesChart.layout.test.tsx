import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichTimeSeriesChart } from '@riviamigo/ui/charts';

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
      />
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
