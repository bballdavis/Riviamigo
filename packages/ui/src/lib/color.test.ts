import { describe, expect, it } from 'vitest';
import {
  canonicalColor,
  contrastRatio,
  formatRgba,
  hexToRgb,
  mixRgba,
  normalizeHex,
  oklchToHex,
  parseRgba,
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

describe('parseRgba', () => {
  it('reads the color forms OpenFreeMap styles and browsers produce', () => {
    expect(parseRgba('rgb(27 ,27 ,29)')).toEqual({ r: 27, g: 27, b: 29, a: 1 });
    expect(parseRgba('rgba(60,60,60,0.8)')).toEqual({ r: 60, g: 60, b: 60, a: 0.8 });
    expect(parseRgba('hsla(0,0%,85%,0.69)')?.a).toBeCloseTo(0.69);
    expect(parseRgba('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseRgba('#00000080')?.a).toBeCloseTo(0.5, 2);
    expect(parseRgba('color(srgb 1 0.5 0 / 0.25)')).toEqual({ r: 255, g: 127.5, b: 0, a: 0.25 });
    expect(parseRgba('transparent')?.a).toBe(0);
    expect(parseRgba('residential')).toBeNull();
  });

  it('mixes in sRGB like color-mix() and formats for MapLibre', () => {
    const mixed = mixRgba({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 0 }, 0.5);
    expect(formatRgba(mixed)).toBe('rgba(128, 128, 128, 0.5)');
    expect(parseRgba(formatRgba(mixed))).toEqual({ r: 128, g: 128, b: 128, a: 0.5 });
  });
});
