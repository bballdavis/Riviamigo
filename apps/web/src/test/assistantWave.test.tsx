import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantWave, assistantWavePath } from '../../../../packages/ui/src/primitives/AssistantWave';

function points(path: string) {
  return [...path.matchAll(/[ML]([\d.]+) ([\d.-]+)/g)].map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
}

describe('AssistantWave', () => {
  it('ripples tallest at the centre and flattens toward both edges', () => {
    const wave = points(assistantWavePath(0, 1));
    const swing = (from: number, to: number) => {
      const slice = wave.filter((point) => point.x >= from && point.x <= to);
      return Math.max(...slice.map((point) => Math.abs(point.y - 20)));
    };

    expect(swing(150, 250)).toBeGreaterThan(8);
    expect(swing(0, 40)).toBeLessThan(1);
    expect(swing(360, 400)).toBeLessThan(1);
  });

  it('mirrors itself so ripples travel out from the centre on both sides', () => {
    const wave = points(assistantWavePath(1234, 1));
    for (let index = 0; index < wave.length; index += 1) {
      expect(wave[index]!.y).toBeCloseTo(wave[wave.length - 1 - index]!.y, 1);
    }
  });

  it('gives small spots fewer, longer ripples so narrow waves stay readable', () => {
    const crossings = (wavelength: number) => {
      const ys = points(assistantWavePath(0, 1, wavelength)).map((point) => point.y - 20);
      return ys.slice(1).filter((y, index) => Math.sign(y) !== Math.sign(ys[index]!) && Math.abs(y) > 0.05).length;
    };
    expect(crossings(110)).toBeLessThan(crossings(46));
  });

  it('starts flat while growing in and announces what is loading', () => {
    expect(points(assistantWavePath(0, 0)).every((point) => point.y === 20)).toBe(true);

    render(<AssistantWave label="Loading vehicle picture" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading vehicle picture');
  });
});
