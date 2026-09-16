import { describe, expect, it } from 'vitest';
import {
  canonicalColor,
  contrastRatio,
  hexToRgb,
  normalizeHex,
  oklchToHex,
  rgbToHex,
  rgbToOklch,
} from './color';

describe('color utilities', () => {
  it('normalizes supported CSS colors to canonical lowercase hex', () => {
    expect(normalizeHex('#F80')).toBe('#ff8800');
    expect(canonicalColor('rgb(253, 131, 4)')).toBe('#fd8304');
    expect(canonicalColor('hsl(31, 98%, 50%)')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('round-trips in-gamut colors through OKLCH deterministically', () => {
    const original = '#2cafa5';
    const converted = oklchToHex(rgbToOklch(hexToRgb(original)!));
    const first = hexToRgb(original)!;
    const second = hexToRgb(converted)!;
    expect(Math.abs(first.r - second.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(first.g - second.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(first.b - second.b)).toBeLessThanOrEqual(1);
  });

  it('maps out-of-gamut OKLCH values into canonical sRGB', () => {
    const mapped = oklchToHex({ l: 68, c: 0.6, h: 145 });
    expect(mapped).toMatch(/^#[0-9a-f]{6}$/);
    expect(rgbToHex(hexToRgb(mapped)!)).toBe(mapped);
  });

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeGreaterThan(4);
  });
});
