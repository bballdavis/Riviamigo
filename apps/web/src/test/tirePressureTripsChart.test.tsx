import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { packRichTimeIntervals, RichTimeSeriesChart } from '@riviamigo/ui/charts';

describe('tire pressure trip interval lanes', () => {
  it('spatially stacks only overlapping intervals and preserves source order for ties', () => {
    const packed = packRichTimeIntervals([
      { id: 'a', start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', label: 'A' },
      { id: 'b', start: '2026-01-01T00:30:00Z', end: '2026-01-01T01:30:00Z', label: 'B' },
      { id: 'c', start: '2026-01-01T01:30:00Z', end: '2026-01-01T02:00:00Z', label: 'C' },
    ]);

    expect(packed.map(({ id, lane }) => [id, lane])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ]);
  });

  it('drops malformed or zero-width intervals instead of fabricating a duration', () => {
    expect(packRichTimeIntervals([
      { id: 'bad', start: 'not-a-date', end: '2026-01-01T01:00:00Z', label: 'Bad' },
      { id: 'zero', start: '2026-01-01T01:00:00Z', end: '2026-01-01T01:00:00Z', label: 'Zero' },
    ])).toEqual([]);
  });

  it('renders the interval as an accessible full-bar target with a reference line', async () => {
    const onTripClick = vi.fn();
    const { container, getByRole } = render(
      <RichTimeSeriesChart
        points={[{ ts: '2026-01-01T00:00:00Z' }, { ts: '2026-01-01T02:00:00Z' }]}
        series={[{ key: 'fl', label: 'Front left', values: [48, null] }]}
        intervals={[{ id: 'trip-1', start: '2026-01-01T00:15:00Z', end: '2026-01-01T01:00:00Z', label: 'Home → Work', details: '45 min · 12 mi' }]}
        referenceLines={[{ value: 48, label: 'Target' }]}
        onIntervalClick={(interval) => onTripClick(interval.id)}
        height={240}
      />,
    );

    await waitFor(() => expect(container.querySelector('.uplot')).toBeTruthy());
    const interval = getByRole('button', { name: /Home → Work: 45 min/ });
    expect(interval).toHaveAttribute('title', expect.stringContaining('12 mi'));
    fireEvent.click(interval);
    expect(onTripClick).toHaveBeenCalledWith('trip-1');
    expect(container.textContent).toContain('Target');
  });
});
