import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EfficiencyPillBarChart } from '@riviamigo/ui/charts';

describe('EfficiencyPillBarChart mobile layout', () => {
  it('keeps every segmented bar in a shrinkable full-width mobile row', () => {
    const { container } = render(
      <EfficiencyPillBarChart
        height={260}
        valueUnit="Wh/mi"
        data={[
          { label: '50°', value: 300, count: 4, distance: 28, speed: 36 },
          { label: '40°', value: 340, count: 2, distance: 14, speed: 29 },
        ]}
      />,
    );

    const category = screen.getByRole('button', { name: /50°.*300 Wh\/mi.*4 trips/i });
    expect(category).toBeTruthy();
    fireEvent.click(category);
    expect(category.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('[data-efficiency-pill-bar="true"]')).toHaveLength(4);
    expect(container.querySelector('[data-efficiency-pill-bar="true"]')?.className).toContain('min-w-0');
    expect(container.firstElementChild?.className).toContain('overflow-y-auto');
  });

  it('exposes coverage alongside distance in the accessible mobile summary', () => {
    render(
      <EfficiencyPillBarChart
        height={260}
        valueUnit="Wh/mi"
        data={[{ label: 'Bike rack', value: 325, count: 4, distance: 68, coverage: 0.75 }]}
      />,
    );

    expect(screen.getByRole('button', { name: /Bike rack.*75% coverage/i })).toBeTruthy();
  });

  it('keeps compact labels by default and makes neutral tag rows opt-in', () => {
    const compact = render(
      <EfficiencyPillBarChart height={260} valueUnit="Wh/mi" data={[{ label: '50°', value: 300 }]} />,
    );
    const compactHeader = [...compact.container.querySelectorAll('div')].find((node) => node.className.includes('grid-cols'));
    expect(compactHeader?.className).not.toContain('minmax(7rem,1.25fr)');
    compact.unmount();

    const tags = render(
      <EfficiencyPillBarChart height={260} valueUnit="Wh/mi" wideLabels data={[{ label: 'Very long equipment setup label', value: 300, tone: 'neutral' }]} />,
    );
    const tagHeader = [...tags.container.querySelectorAll('div')].find((node) => node.className.includes('grid-cols'));
    expect(tagHeader?.className).toContain('minmax(7rem,1.25fr)');
    expect(tags.container.querySelector('[data-efficiency-pill-tone="neutral"]')).toBeTruthy();
    expect(tags.container.querySelector('[data-efficiency-pill-tone="neutral"] span')?.className).toContain('bg-fg-tertiary/70');
  });
});
