import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getBrandAsset, type BrandAssetKind } from '@riviamigo/ui/lib/brandAssets';

const kinds: BrandAssetKind[] = ['wordmark', 'logo', 'icon', 'favicon'];

describe('brand asset resolver', () => {
  it('selects one deterministic asset for every palette and contrast mode', () => {
    for (const palette of ['classic', 'rad'] as const) {
      for (const dark of [true, false]) {
        for (const kind of kinds) {
          const asset = getBrandAsset(kind, { palette, dark });
          expect(asset, `${palette}:${dark ? 'dark' : 'light'}:${kind}`).toMatch(/^\/[a-z0-9_-]+\.svg$/i);
        }
      }
    }
  });

  it('keeps classic docs-compatible assets as the default and resolves RAD variants centrally', () => {
    expect(getBrandAsset('wordmark')).toBe('/text_white.svg');
    expect(getBrandAsset('wordmark', { dark: false })).toBe('/text_black.svg');
    expect(getBrandAsset('wordmark', { palette: 'rad' })).toBe('/rad-text_white.svg');
    expect(getBrandAsset('wordmark', { palette: 'rad', dark: false })).toBe('/rad-text_black.svg');
    expect(getBrandAsset('favicon', { palette: 'rad' })).toBe('/rad-favicon.svg');
  });

  it('keeps RAD wordmarks self-contained for image elements', () => {
    for (const asset of ['rad-text_white.svg', 'rad-text_black.svg']) {
      const svg = readFileSync(resolve(process.cwd(), 'public', asset), 'utf8');
      expect(svg).toContain('data:image/svg+xml;base64,');
      expect(svg).not.toMatch(/href="\/text_(?:white|black)\.svg"/);
    }
  });
});
