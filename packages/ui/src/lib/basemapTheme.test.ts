import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, parseRgba } from './color';
import {
  BASEMAP_LABEL_HALO_WIDTH,
  BASEMAP_THEME_TOKENS,
  resolveBasemapThemeColors,
  themeBasemapStyle,
  type BasemapStyleLike,
  type BasemapThemeMode,
} from './basemapTheme';

/* ── Real theme tokens from globals.css ──────────────────────────────── */

const css = readFileSync(fileURLToPath(new URL('../tokens/globals.css', import.meta.url)), 'utf8');

function tokenBlock(selectorStart: string): Record<string, string> {
  const start = css.indexOf(selectorStart);
  if (start < 0) throw new Error(`missing token block ${selectorStart}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--rm-[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
}

const classicDark = tokenBlock(":root, .dark, [data-theme='dark']");
const classicLight = { ...classicDark, ...tokenBlock(".light, [data-theme='light']") };
const THEMES: Array<{ name: string; mode: BasemapThemeMode; tokens: Record<string, string> }> = [
  { name: 'classic dark', mode: 'dark', tokens: classicDark },
  { name: 'classic light', mode: 'light', tokens: classicLight },
  { name: 'rad dark', mode: 'dark', tokens: { ...classicDark, ...tokenBlock(".dark[data-rm-palette='rad']") } },
  { name: 'rad light', mode: 'light', tokens: { ...classicLight, ...tokenBlock(".light[data-rm-palette='rad']") } },
];

const colorsFor = (theme: (typeof THEMES)[number]) => resolveBasemapThemeColors(theme.mode, (name) => theme.tokens[name] ?? '');

/* ── Compact OpenMapTiles-schema fixture ─────────────────────────────── */

function stockStyle(mode: BasemapThemeMode): BasemapStyleLike {
  const light = mode === 'light';
  return {
    version: 8,
    sources: {
      openmaptiles: { type: 'vector', url: '/v1/external/basemap/openfreemap/planet' },
      ne2_shaded: { type: 'raster', tiles: ['/v1/external/basemap/openfreemap/natural_earth/{z}/{x}/{y}.png'] },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': light ? 'rgb(242,243,240)' : 'rgb(12,12,12)' } },
      { id: 'shaded-relief', type: 'raster', source: 'ne2_shaded', paint: { 'raster-opacity': 0.3 } },
      { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-color': 'rgb(230, 233, 229)' } },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': 'rgb(194, 200, 202)' } },
      { id: 'landcover_wood', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': 'rgb(32,32,32)', 'fill-pattern': 'wood-pattern', 'fill-opacity': 0.4 } },
      { id: 'landcover_glacier', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: ['==', ['get', 'subclass'], 'glacier'], paint: { 'fill-color': light ? 'hsl(0,0%,98%)' : 'hsl(0,1%,2%)' } },
      { id: 'landuse_residential', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', filter: ['==', ['get', 'class'], 'residential'], paint: { 'fill-color': 'rgb(234, 234, 230)' } },
      { id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', paint: { 'line-color': 'hsl(195,17%,78%)' } },
      { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', paint: { 'fill-color': 'rgb(234, 234, 229)', 'fill-outline-color': 'rgb(219, 219, 218)' } },
      { id: 'highway_major_casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': light ? 'rgb(213, 213, 213)' : 'rgba(60,60,60,0.8)', 'line-width': 3 } },
      { id: 'highway_major_inner', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': light ? '#fff' : 'hsl(0,0%,7%)', 'line-width': 2 } },
      { id: 'highway_motorway_inner', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 5.8, 'hsla(0,0%,85%,0.53)', 6, light ? '#fff' : '#000'] } },
      { id: 'boundary_2', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary', paint: { 'line-color': 'hsl(0,0%,70%)' } },
      { id: 'label_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': '{name}' }, paint: { 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 1 } },
      { id: 'highway-name-minor', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'text-field': '{name}' }, paint: { 'text-color': '#666', 'text-halo-width': 1 } },
      { id: 'water_name', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name', layout: { 'text-field': '{name}' }, paint: { 'text-color': 'hsla(0,0%,0%,0.7)', 'text-halo-color': 'hsl(0,0%,27%)' } },
      { id: 'road_shield_us', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', layout: { 'icon-image': 'us-interstate' } },
    ],
  };
}

/** Overlays TripMapChart adds after the style loads. */
const APP_OVERLAYS = [
  { id: 'trip-routes-line', type: 'line', source: 'trip-routes', paint: { 'line-color': ['get', 'color'], 'line-width': 3 } },
  { id: 'trip-routes-hit', type: 'line', source: 'trip-routes', paint: { 'line-color': 'transparent', 'line-width': 18 } },
  { id: 'trip-active-point-layer', type: 'circle', source: 'trip-active-point', paint: { 'circle-color': '#FD8304', 'circle-stroke-color': '#12121A' } },
];

const layerById = (style: BasemapStyleLike, id: string) => style.layers!.find((layer) => layer.id === id)!;
const paintOf = (style: BasemapStyleLike, id: string, property: string) => layerById(style, id).paint![property];
const rgbaText = (value: unknown) => {
  const parsed = parseRgba(String(value));
  if (!parsed) throw new Error(`not a color: ${String(value)}`);
  return parsed;
};
/** Composites a translucent color over the ground for contrast checks. */
const over = (value: unknown, ground: unknown) => {
  const top = rgbaText(value); const base = rgbaText(ground);
  const blend = (a: number, b: number) => Math.round(a * top.a + b * (1 - top.a));
  return `rgb(${blend(top.r, base.r)}, ${blend(top.g, base.g)}, ${blend(top.b, base.b)})`;
};

describe('themeBasemapStyle label contrast', () => {
  it.each(THEMES)('keeps every basemap label at WCAG AA contrast on its halo ($name)', (theme) => {
    const colors = colorsFor(theme);
    const themed = themeBasemapStyle(stockStyle(theme.mode), colors, theme.mode);
    const ground = paintOf(themed, 'background', 'background-color');
    const labels = themed.layers!.filter((layer) => layer.type === 'symbol' && layer.layout?.['text-field']);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const text = label.paint!['text-color'];
      const halo = label.paint!['text-halo-color'];
      expect(halo).toBe(ground);
      expect(label.paint!['text-halo-width']).toBe(BASEMAP_LABEL_HALO_WIDTH);
      expect(contrastRatio(String(text), String(halo)), `${label.id} on halo`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('paints place labels from --rm-text-secondary ($name)', (theme) => {
    const themed = themeBasemapStyle(stockStyle(theme.mode), colorsFor(theme), theme.mode);
    const expected = rgbaText(theme.tokens[BASEMAP_THEME_TOKENS.label]);
    const actual = rgbaText(paintOf(themed, 'label_city', 'text-color'));
    expect([actual.r, actual.g, actual.b]).toEqual([expected.r, expected.g, expected.b]);
  });

  it('widens the stock halo on every text label', () => {
    for (const mode of ['light', 'dark'] as const) {
      const stock = stockStyle(mode);
      const themed = themeBasemapStyle(stock, colorsFor(THEMES.find((theme) => theme.mode === mode)!), mode);
      for (const layer of stock.layers!.filter((item) => item.layout?.['text-field'])) {
        const before = Number(layer.paint?.['text-halo-width'] ?? 0);
        expect(Number(paintOf(themed, layer.id, 'text-halo-width'))).toBeGreaterThan(before);
      }
    }
  });
});

describe('themeBasemapStyle scope', () => {
  it.each(THEMES)('never touches app overlays, raster layers, or icon-only symbols ($name)', (theme) => {
    const stock = stockStyle(theme.mode);
    const withOverlays: BasemapStyleLike = { ...stock, layers: [...stock.layers!, ...APP_OVERLAYS] };
    const themed = themeBasemapStyle(withOverlays, colorsFor(theme), theme.mode);
    for (const overlay of APP_OVERLAYS) {
      expect(layerById(themed, overlay.id)).toBe(overlay);
    }
    expect(layerById(themed, 'shaded-relief')).toBe(layerById(withOverlays, 'shaded-relief'));
    expect(layerById(themed, 'road_shield_us')).toBe(layerById(withOverlays, 'road_shield_us'));
  });

  it('recolors every vector basemap layer and leaves non-color paint alone', () => {
    const theme = THEMES[0]!;
    const stock = stockStyle(theme.mode);
    const themed = themeBasemapStyle(stock, colorsFor(theme), theme.mode);
    for (const layer of stock.layers!) {
      if (layer.type === 'raster' || !layer.paint || layer.id === 'road_shield_us') continue;
      expect(layerById(themed, layer.id), layer.id).not.toBe(layer);
    }
    expect(paintOf(themed, 'highway_major_casing', 'line-width')).toBe(3);
    expect(paintOf(themed, 'landcover_wood', 'fill-opacity')).toBe(0.4);
    expect(paintOf(themed, 'landcover_wood', 'fill-pattern')).toBeUndefined();
    // Input is not mutated.
    expect(paintOf(stock, 'background', 'background-color')).toBe('rgb(12,12,12)');
  });

  it('rewrites colors nested in expressions and keeps their alpha', () => {
    const theme = THEMES[1]!;
    const themed = themeBasemapStyle(stockStyle(theme.mode), colorsFor(theme), theme.mode);
    const expression = paintOf(themed, 'highway_motorway_inner', 'line-color') as unknown[];
    expect(expression.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    expect(rgbaText(expression[4]).a).toBeCloseTo(0.53, 2);
    expect(rgbaText(expression[6]).a).toBe(1);
  });
});

describe('themeBasemapStyle palette', () => {
  it.each(THEMES)('sits the map on the theme surface and keeps the stock road hierarchy ($name)', (theme) => {
    const colors = colorsFor(theme);
    const themed = themeBasemapStyle(stockStyle(theme.mode), colors, theme.mode);
    const ground = paintOf(themed, 'background', 'background-color');
    const surface = theme.tokens[BASEMAP_THEME_TOKENS.surface]!;
    // Light themes blend surface and elevated; dark themes use the surface.
    expect(contrastRatio(String(ground), surface)).toBeLessThan(1.1);

    const casing = over(paintOf(themed, 'highway_major_casing', 'line-color'), ground);
    const inner = over(paintOf(themed, 'highway_major_inner', 'line-color'), ground);
    expect(contrastRatio(casing, String(ground))).toBeGreaterThan(contrastRatio(inner, String(ground)));
    // Roads stay quiet: always well below label contrast.
    expect(contrastRatio(casing, String(ground))).toBeLessThan(3);
  });

  it.each(THEMES)('tints water and vegetation from status tokens without overpowering the ground ($name)', (theme) => {
    const colors = colorsFor(theme);
    const themed = themeBasemapStyle(stockStyle(theme.mode), colors, theme.mode);
    const ground = rgbaText(paintOf(themed, 'background', 'background-color'));
    const water = rgbaText(paintOf(themed, 'water', 'fill-color'));
    const park = rgbaText(paintOf(themed, 'park', 'fill-color'));
    const info = rgbaText(theme.tokens[BASEMAP_THEME_TOKENS.water]!);
    const positive = rgbaText(theme.tokens[BASEMAP_THEME_TOKENS.vegetation]!);
    const distance = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    // Each tint moves from the ground toward its token, but stays closer to the ground.
    expect(distance(water, info)).toBeLessThan(distance(ground, info));
    expect(distance(water, ground)).toBeLessThan(distance(water, info));
    expect(distance(park, positive)).toBeLessThan(distance(ground, positive));
    expect(distance(park, ground)).toBeLessThan(distance(park, positive));
    // Glaciers are not painted as vegetation.
    const glacier = rgbaText(paintOf(themed, 'landcover_glacier', 'fill-color'));
    const wood = rgbaText(paintOf(themed, 'landcover_wood', 'fill-color'));
    expect(distance(glacier, positive)).toBeGreaterThan(distance(wood, positive));
  });
});
