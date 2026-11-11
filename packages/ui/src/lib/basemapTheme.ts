import { colors as tokenColors } from '../tokens/colors';
import { formatRgba, mixRgba, parseRgba, type RgbColor, type RgbaColor } from './color';

/**
 * Recolors an OpenMapTiles-schema vector style (OpenFreeMap Positron, Dark,
 * and friends) so the basemap sits on the active app theme instead of the
 * provider's stock palette.
 *
 * Layers are matched by layer `type` and `source-layer`, never by the
 * provider's layer IDs, so the transform keeps working when upstream styles
 * add, rename, or reorder layers. Only layers backed by the style's own
 * sources are changed; overlays the app adds after the style loads (routes,
 * the active point) never pass through here and are left alone.
 */

export type BasemapThemeMode = 'light' | 'dark';

/** Resolved theme colors the basemap is painted from. */
export interface BasemapThemeColors {
  /** Map ground: background and land. */
  ground: RgbaColor;
  /** Direction features move in to stand out from the ground (text ink). */
  ink: RgbaColor;
  /** Direction features move in to recede behind the ground. */
  paper: RgbaColor;
  /** Hue for water fills and waterways. */
  water: RgbaColor;
  /** Hue for parks and vegetated landcover. */
  vegetation: RgbaColor;
  /** Label text. */
  label: RgbaColor;
}

/** Token reader; returns the raw declared custom-property value. */
export type ThemeTokenReader = (variableName: string) => string;

/** Tokens the basemap theme reads, by role. */
export const BASEMAP_THEME_TOKENS = {
  surface: '--rm-bg-surface',
  elevated: '--rm-bg-elevated',
  page: '--rm-bg-page',
  ink: '--rm-text-primary',
  label: '--rm-text-secondary',
  water: '--rm-status-info',
  vegetation: '--rm-status-positive',
} as const;

/** Halo width for every basemap label; wider than the stock 0.5–1.4 px. */
export const BASEMAP_LABEL_HALO_WIDTH = 1.75;
const BASEMAP_LABEL_HALO_BLUR = 0.25;

// How far a feature moves from the ground toward ink/paper per unit of the
// stock style's lightness difference. Dark styles keep their features very
// close to the background, so they get more gain to stay legible.
const TONE_GAIN: Record<BasemapThemeMode, number> = { light: 1.3, dark: 1.6 };
const MAX_INK_MIX = 0.55;
const WATER_MIX: Record<BasemapThemeMode, number> = { light: 0.2, dark: 0.22 };
const WATERWAY_MIX: Record<BasemapThemeMode, number> = { light: 0.32, dark: 0.34 };
const VEGETATION_MIX: Record<BasemapThemeMode, number> = { light: 0.12, dark: 0.12 };
const LANDCOVER_MIX: Record<BasemapThemeMode, number> = { light: 0.08, dark: 0.08 };
const WATER_LABEL_MIX = 0.45;

// Neutral fallbacks from the static slate ramp, used only when a token cannot
// be read (SSR, tests). Water and vegetation fall back to ink, which keeps
// their tints neutral rather than inventing a hue.
const { slate } = tokenColors;
const FALLBACKS: Record<BasemapThemeMode, Record<keyof typeof BASEMAP_THEME_TOKENS, string>> = {
  light: { surface: slate[50], elevated: slate[100], page: slate[50], ink: slate[900], label: slate[600], water: slate[900], vegetation: slate[900] },
  dark: { surface: slate[900], elevated: slate[850], page: slate[950], ink: slate[50], label: slate[400], water: slate[50], vegetation: slate[50] },
};

const COLOR_PAINT_PROPERTIES = new Set([
  'background-color',
  'fill-color',
  'fill-outline-color',
  'fill-extrusion-color',
  'line-color',
  'circle-color',
  'circle-stroke-color',
]);

const WATER_LAYERS = new Set(['water', 'waterway']);
const VEGETATION_CLASSES = ['park', 'wood', 'forest', 'grass', 'scrub', 'meadow', 'farmland', 'garden', 'recreation_ground', 'cemetery', 'golf_course', 'pitch'];
const SNOW_CLASSES = ['ice_shelf', 'glacier'];

/* ── Color helpers ─────────────────────────────────────────────────────── */

/** Perceived lightness (0–1) used to compare stock colors to their background. */
function tone({ r, g, b }: RgbColor) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const opaque = (color: RgbaColor): RgbaColor => ({ ...color, a: 1 });

/* ── Token resolution ──────────────────────────────────────────────────── */

/**
 * Reads the active theme's tokens and derives the basemap palette. The
 * reader returns raw custom-property text; colors a plain parser cannot read
 * (for example `color-mix()` in a custom theme) are resolved through the
 * browser when one is available.
 */
export function resolveBasemapThemeColors(mode: BasemapThemeMode, readToken: ThemeTokenReader = readDocumentToken): BasemapThemeColors {
  const token = (role: keyof typeof BASEMAP_THEME_TOKENS) => {
    const raw = readToken(BASEMAP_THEME_TOKENS[role]).trim();
    const parsed = raw ? parseRgba(raw) ?? resolveThroughBrowser(BASEMAP_THEME_TOKENS[role]) : null;
    return opaque(parsed ?? parseRgba(FALLBACKS[mode][role])!);
  };
  const surface = token('surface');
  const elevated = token('elevated');
  const page = token('page');
  // Light themes use pure-white surfaces; a white ground would hide the
  // white road fills, so land sits halfway toward the elevated tone. Dark
  // themes sit on the card surface itself and recede toward the page.
  const ground = mode === 'light' ? mixRgba(surface, elevated, 0.5) : surface;
  const paper = mode === 'light' ? surface : page;
  return {
    ground,
    ink: token('ink'),
    paper,
    water: token('water'),
    vegetation: token('vegetation'),
    label: token('label'),
  };
}

function readDocumentToken(variableName: string) {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(variableName);
}

function resolveThroughBrowser(variableName: string): RgbaColor | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = `var(${variableName})`;
  document.body.appendChild(probe);
  try {
    return parseRgba(getComputedStyle(probe).color);
  } finally {
    probe.remove();
  }
}

/* ── Style transform ───────────────────────────────────────────────────── */

type StyleLayer = Record<string, unknown> & {
  id: string;
  type: string;
  source?: unknown;
  'source-layer'?: unknown;
  filter?: unknown;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

export interface BasemapStyleLike {
  sources?: Record<string, unknown>;
  layers?: StyleLayer[];
  [key: string]: unknown;
}

/** Layer IDs the app adds on top of the basemap; never recolored. */
export const APP_OVERLAY_LAYER_PREFIX = 'trip-';

/**
 * Returns a copy of `style` repainted from `colors`. Unknown or unparseable
 * values are left as the provider wrote them.
 */
export function themeBasemapStyle<T extends BasemapStyleLike>(style: T, colors: BasemapThemeColors, mode: BasemapThemeMode): T {
  const layers = style.layers;
  if (!Array.isArray(layers)) return style;
  const ownSources = new Set(Object.keys(style.sources ?? {}));
  const stockGround = stockBackgroundTone(layers, mode);
  const remapTone = (value: string) => {
    const original = parseRgba(value);
    if (!original) return value;
    const difference = tone(original) - stockGround;
    const towardInk = mode === 'light' ? difference < 0 : difference > 0;
    const amount = Math.abs(difference) * TONE_GAIN[mode];
    const target = towardInk ? colors.ink : colors.paper;
    const mixed = mixRgba(colors.ground, target, towardInk ? Math.min(amount, MAX_INK_MIX) : amount);
    return formatRgba({ ...mixed, a: original.a });
  };
  const tint = (hue: RgbaColor, amount: number) => (value: string) => {
    const original = parseRgba(value);
    return formatRgba({ ...mixRgba(colors.ground, hue, amount), a: original?.a ?? 1 });
  };

  return {
    ...style,
    layers: layers.map((layer) => {
      if (!isBasemapLayer(layer, ownSources)) return layer;
      const sourceLayer = typeof layer['source-layer'] === 'string' ? layer['source-layer'] : '';
      if (layer.type === 'symbol') return themeLabelLayer(layer, sourceLayer, colors);

      let recolor = remapTone;
      if (WATER_LAYERS.has(sourceLayer)) {
        recolor = tint(colors.water, layer.type === 'line' ? WATERWAY_MIX[mode] : WATER_MIX[mode]);
      } else if (sourceLayer === 'park' || (sourceLayer === 'landuse' && filterMentions(layer, VEGETATION_CLASSES))) {
        recolor = tint(colors.vegetation, VEGETATION_MIX[mode]);
      } else if (sourceLayer === 'landcover' && !filterMentions(layer, SNOW_CLASSES)) {
        recolor = tint(colors.vegetation, LANDCOVER_MIX[mode]);
      }

      const paint = layer.paint ? { ...layer.paint } : {};
      if (layer.type === 'background') {
        paint['background-color'] = formatRgba(colors.ground);
        delete paint['background-pattern'];
        return { ...layer, paint };
      }
      let changed = false;
      for (const [property, value] of Object.entries(paint)) {
        if (!COLOR_PAINT_PROPERTIES.has(property)) continue;
        paint[property] = mapColors(value, recolor);
        changed = true;
      }
      // Provider texture sprites (e.g. Dark's wood pattern) carry their own
      // gray palette; drop them so the themed tint shows instead.
      if (recolor !== remapTone && 'fill-pattern' in paint) {
        delete paint['fill-pattern'];
        if (!('fill-color' in paint)) paint['fill-color'] = recolor(formatRgba(colors.ink));
        changed = true;
      }
      return changed ? { ...layer, paint } : layer;
    }),
  };
}

function themeLabelLayer(layer: StyleLayer, sourceLayer: string, colors: BasemapThemeColors): StyleLayer {
  const hasText = layer.layout?.['text-field'] !== undefined || layer.paint?.['text-color'] !== undefined;
  if (!hasText) return layer;
  const text = sourceLayer === 'water_name' || sourceLayer === 'waterway'
    ? mixRgba(colors.label, colors.water, WATER_LABEL_MIX)
    : colors.label;
  return {
    ...layer,
    paint: {
      ...layer.paint,
      'text-color': formatRgba(opaque(text)),
      'text-halo-color': formatRgba(opaque(colors.ground)),
      'text-halo-width': BASEMAP_LABEL_HALO_WIDTH,
      'text-halo-blur': BASEMAP_LABEL_HALO_BLUR,
    },
  };
}

function isBasemapLayer(layer: StyleLayer, ownSources: Set<string>) {
  if (typeof layer.id !== 'string' || layer.id.startsWith(APP_OVERLAY_LAYER_PREFIX)) return false;
  if (layer.type === 'background') return true;
  if (layer.type === 'raster' || layer.type === 'hillshade') return false;
  return typeof layer.source === 'string' && ownSources.has(layer.source);
}

function stockBackgroundTone(layers: StyleLayer[], mode: BasemapThemeMode) {
  const background = layers.find((layer) => layer.type === 'background')?.paint?.['background-color'];
  const parsed = typeof background === 'string' ? parseRgba(background) : null;
  return parsed ? tone(parsed) : mode === 'light' ? 0.95 : 0.05;
}

/** Maps every color literal in a paint value, including inside expressions. */
function mapColors(value: unknown, recolor: (color: string) => string): unknown {
  if (typeof value === 'string') return parseRgba(value) ? recolor(value) : value;
  if (Array.isArray(value)) {
    // Never rewrite feature lookups such as ['get', 'color'].
    if (value[0] === 'get' || value[0] === 'literal') return value;
    return value.map((item) => mapColors(item, recolor));
  }
  if (value && typeof value === 'object' && 'stops' in value && Array.isArray((value as { stops: unknown }).stops)) {
    const legacy = value as { stops: Array<[unknown, unknown]> };
    return { ...legacy, stops: legacy.stops.map(([stop, color]) => [stop, mapColors(color, recolor)]) };
  }
  return value;
}

function filterMentions(layer: StyleLayer, values: readonly string[]) {
  if (layer.filter === undefined) return false;
  const text = JSON.stringify(layer.filter);
  return values.some((value) => text.includes(`"${value}"`));
}
