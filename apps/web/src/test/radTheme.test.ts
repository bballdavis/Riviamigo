import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAD_THEME } from '@riviamigo/themes';
import { contrastRatio } from '@riviamigo/ui/lib/color';

function rgbDistance(left: string, right: string) {
  const channels = (color: string) => color.slice(1).match(/../g)!.map((value) => Number.parseInt(value, 16));
  const a = channels(left);
  const b = channels(right);
  return Math.hypot(...a.map((value, index) => value - b[index]!));
}

describe('RAD visual contract', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`keeps text and controls readable in ${mode} mode`, () => {
      const tokens = RAD_THEME.tokens[mode];
      for (const surface of ['bg-page', 'bg-surface', 'bg-elevated'] as const) {
        for (const text of ['text-primary', 'text-secondary', 'text-tertiary'] as const) {
          expect(contrastRatio(tokens[text], tokens[surface]), `${text}/${surface}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrastRatio(tokens.accent, tokens[surface]), `accent/${surface}`).toBeGreaterThanOrEqual(3);
      }
      for (const accent of ['accent', 'accent-hover', 'accent-active'] as const) {
        expect(contrastRatio(tokens['text-on-accent'], tokens[accent]), accent).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`provides sixteen distinct, alternating chart colors in ${mode} mode`, () => {
      const colors = Object.values(RAD_THEME.series).map((pair) => pair[mode]);
      expect(new Set(colors).size).toBe(16);
      for (const [index, color] of colors.entries()) {
        expect(contrastRatio(color, RAD_THEME.tokens[mode]['bg-surface']), color).toBeGreaterThanOrEqual(3);
        expect(rgbDistance(color, colors[(index + 1) % colors.length]!), `series ${index + 1}/${(index + 1) % colors.length + 1}`).toBeGreaterThanOrEqual(100);
      }
    });

    it(`keeps consecutive map-route colors distinct in ${mode} mode`, () => {
      const colors = Array.from({ length: 6 }, (_, index) => RAD_THEME.tokens[mode][`map-route-${index}` as keyof typeof RAD_THEME.tokens[typeof mode]]);
      expect(new Set(colors).size).toBe(6);
      colors.forEach((color, index) => {
        expect(rgbDistance(color, colors[(index + 1) % colors.length]!), `route ${index}/${(index + 1) % colors.length}`).toBeGreaterThanOrEqual(100);
      });
    });
  }

  it('keeps static first-paint chart aliases aligned with runtime aliases', () => {
    const css = readFileSync(resolve(process.cwd(), '../../packages/ui/src/tokens/globals.css'), 'utf8');
    for (const mode of ['light', 'dark'] as const) {
      for (const [alias, pair] of Object.entries(RAD_THEME.chartAliases)) {
        if (typeof pair === 'string') continue;
        expect(css, `${mode} chart alias ${alias}`).toContain(`--rm-chart-${alias}: ${pair[mode]};`);
      }
    }
  });

  it('ships standalone vector artwork for every RAD brand surface', () => {
    const paths = new Set(Object.values(RAD_THEME.brandAssets).flatMap((modes) => Object.values(modes)));
    for (const path of paths) {
      const svg = readFileSync(resolve(process.cwd(), 'public', path.slice(1)), 'utf8');
      expect(svg).toContain('<path');
      expect(svg).toContain('<title');
      expect(svg).not.toMatch(/<image\b|<text\b|<script\b|<foreignObject\b|\b(?:href|src)=|url\(/i);
    }
  });
});
