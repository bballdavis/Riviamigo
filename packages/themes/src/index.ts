import type { BrandAssetKind } from './internal-types';
import type { ChartColorToken, ThemePalette, ThemeRef } from '@riviamigo/types';

export type { BrandAssetKind };
export type SemanticToken = keyof typeof SEMANTIC_TOKEN_CATALOG;
/** Serialized color/effect value. Runtime validation restricts persisted overrides. */
export type ThemeColor = string;
export interface ThemeColorPair { light: ThemeColor; dark: ThemeColor; }
export interface BrandPaintSlots { accent: ThemeColorPair; accentMuted: ThemeColorPair; mark: ThemeColorPair; }

export interface ThemeDefinition {
  schemaVersion: 1;
  id: string;
  legacyPalette: ThemePalette;
  name: string;
  tokens: { light: Record<SemanticToken, ThemeColor>; dark: Record<SemanticToken, ThemeColor> };
  series: Record<Extract<ChartColorToken, `series-${string}`>, ThemeColorPair>;
  chartAliases: Record<string, ThemeColorPair | ChartColorToken>;
  brandAssets: Record<BrandAssetKind, { light: string; dark: string }>;
  brandPaints: BrandPaintSlots;
}

export interface ThemeOverride {
  theme?: ThemePalette;
  tokens?: Partial<Record<SemanticToken, Partial<ThemeColorPair>>>;
  series?: Partial<Record<Extract<ChartColorToken, `series-${string}`>, Partial<ThemeColorPair>>>;
  brandPaints?: Partial<{ [K in keyof BrandPaintSlots]: Partial<ThemeColorPair> }>;
}

export interface ResolvedTheme extends ThemeDefinition { sourceTheme: ThemePalette; }

export const SEMANTIC_TOKEN_CATALOG = {
  'bg-page': 0, 'bg-surface': 0, 'bg-elevated': 0, 'bg-glass': 0, 'bg-overlay': 0,
  'text-primary': 0, 'text-secondary': 0, 'text-tertiary': 0, 'text-disabled': 0, 'text-on-accent': 0,
  'border-default': 0, 'border-strong': 0, 'border-accent': 0,
  'status-positive': 0, 'status-warning': 0, 'status-danger': 0, 'status-info': 0,
  'charging-active': 0, 'charging-done': 0, 'charging-limited': 0, 'charging-ac': 0, 'charging-dc': 0, 'charging-dcfc': 0,
  'dm-everyday': 0, 'dm-conserve': 0, 'dm-terrain': 0, 'dm-sand': 0, 'dm-rock': 0, 'dm-rally': 0, 'dm-drift': 0, 'dm-towing': 0, 'dm-unknown': 0,
  'glow-sm': 0, 'glow-md': 0, 'glow-lg': 0, 'glow-button': 0,
  accent: 0, 'accent-hover': 0, 'accent-active': 0, 'accent-muted': 0,
  'shadow-sm': 0, 'shadow-md': 0, 'shadow-lg': 0, 'shadow-xl': 0,
  'chart-grid': 0, 'chart-hover-bg': 0, 'chart-accent': 0, 'chart-success': 0, 'chart-warning': 0, 'chart-danger': 0, 'chart-muted': 0,
  'chart-amber': 0, 'chart-yellow': 0, 'chart-sky': 0, 'chart-emerald': 0, 'chart-violet': 0, 'chart-rose': 0, 'chart-teal': 0, 'chart-orange': 0, 'chart-indigo': 0,
  'map-route-0': 0, 'map-route-1': 0, 'map-route-2': 0, 'map-route-3': 0, 'map-route-4': 0, 'map-route-5': 0,
  'value-halo': 0,
} as const;

const chart = (darkValues: string[], lightValues: string[]) => {
  const names = ['accent','success','warning','danger','muted','emerald','amber','sky','violet','rose','teal','indigo','yellow','orange'];
  return Object.fromEntries(names.map((name, i) => [name, { dark: darkValues[i]!, light: lightValues[i]! }])) as Record<string, ThemeColorPair>;
};
const chartValues = (accent: string, success: string, warning: string, danger: string, muted: string, colors: string[]) => [
  accent, success, warning, danger, muted, success, accent, colors[2]!, colors[4]!, danger, colors[6]!, colors[8]!, colors[1]!, colors[7]!,
];
const assets = (rad: boolean) => rad ? { wordmark: { dark: '/rad-text_white.svg', light: '/rad-text_black.svg' }, logo: { dark: '/rad-logo.svg', light: '/rad-logo.svg' }, icon: { dark: '/rad-icon.svg', light: '/rad-icon.svg' }, favicon: { dark: '/rad-favicon.svg', light: '/rad-favicon.svg' } } : { wordmark: { dark: '/text_white.svg', light: '/text_black.svg' }, logo: { dark: '/logo_color_lighter.svg', light: '/logo_color_lighter.svg' }, icon: { dark: '/icon_color_lighter.svg', light: '/icon_color_lighter.svg' }, favicon: { dark: '/favicon.svg', light: '/favicon.svg' } };

const makeTokens = (rad: boolean): Record<SemanticToken, ThemeColorPair> => {
  const dark = rad ? ['#082529','#10363B','#18464B','rgba(24, 70, 75, 0.68)','rgba(7, 13, 16, 0.74)','#FFFFFF','#C4E3DF','#9CBDB9','#658B88','#082529','rgba(214, 239, 230, 0.10)','rgba(214, 239, 230, 0.19)','rgba(255, 176, 0, 0.36)'] : ['#0A0A0F','#12121A','#1A1A24','rgba(26, 26, 36, 0.6)','rgba(0, 0, 0, 0.7)','#FAFAFA','#A1A1A1','#71717A','#52525B','#0A0A0F','rgba(255, 255, 255, 0.08)','rgba(255, 255, 255, 0.15)','rgba(253, 131, 4, 0.3)'];
  const light = rad ? ['#F7F5F0','#FFFFFF','#F1EDE5','rgba(255, 255, 255, 0.82)','rgba(17, 30, 30, 0.42)','#10363B','#355F60','#52716F','#A5B1AE','#FFFFFF','rgba(22, 43, 43, 0.10)','rgba(22, 43, 43, 0.19)','rgba(201, 55, 30, 0.36)'] : ['#FAFAF7','#FFFFFF','#F4F4EE','rgba(255, 255, 255, 0.7)','rgba(20, 20, 24, 0.4)','#18181B','#52525B','#71717A','#A1A1A1','#FAFAFA','rgba(20, 20, 24, 0.08)','rgba(20, 20, 24, 0.18)','rgba(253, 131, 4, 0.35)'];
  const out = {} as Record<SemanticToken, ThemeColorPair>; const names = ['bg-page','bg-surface','bg-elevated','bg-glass','bg-overlay','text-primary','text-secondary','text-tertiary','text-disabled','text-on-accent','border-default','border-strong','border-accent'];
  names.forEach((n, i) => { out[n as SemanticToken] = { dark: dark[i] as ThemeColor, light: light[i] as ThemeColor }; });
  const accentDark = rad ? ['#FFB000','#FFD34E','#F59A00','rgba(255, 176, 0, 0.17)'] : ['#FD8304','#FDBA74','#EA580C','rgba(253, 131, 4, 0.15)'];
  const accentLight = rad ? ['#C9371E','#AE2B16','#94200F','rgba(201, 55, 30, 0.12)'] : ['#FD8304','#EA580C','#C2410C','rgba(253, 131, 4, 0.10)'];
  const statusDark = rad ? ['#38E8A5','#FFC43D','#FF7054','#36CEFF'] : ['#10B981','#F59E0B','#F87171','#60A5FA'];
  const statusLight = rad ? ['#007A4B','#9C5D00','#D02D30','#007DA3'] : ['#059669','#D97706','#EF4444','#3B82F6'];
  ['accent','accent-hover','accent-active','accent-muted'].forEach((n, i) => { out[n as SemanticToken] = { dark: accentDark[i]!, light: accentLight[i]! }; });
  ['status-positive','status-warning','status-danger','status-info'].forEach((n, i) => { out[n as SemanticToken] = { dark: statusDark[i]!, light: statusLight[i]! }; });
  const set = (names: string[], darkValues: string[], lightValues = darkValues) => names.forEach((name, i) => { out[name as SemanticToken] = { dark: darkValues[i]!, light: lightValues[i]! }; });
  const chartDark = rad ? ['#FFB000','#38E8A5','#FFC43D','#FF7054','#9AA9AA','#FFB000','#FFD34E','#36CEFF','#38E8A5','#B59AFF','#FF7054','#2AE0CB','#FF9850','#839FFF'] : ['#FD8304','#10B981','#F59E0B','#F87171','#A1A1A1','#FD8304','#FACC15','#60A5FA','#10B981','#A78BFA','#F87171','#34D399','#FB923C','#818CF8'];
  const chartLight = rad ? ['#C9371E','#007A4B','#9C5D00','#D02D30','#52716F','#C9371E','#8D6A00','#007DA3','#007A4B','#7945D8','#D02D30','#007C73','#B84D00','#435BD0'] : ['#C96F08','#047857','#B45309','#DC2626','#71717A','#C96F08','#A16207','#2563EB','#047857','#7C3AED','#DC2626','#047857','#C2410C','#4F46E5'];
  set(['chart-accent','chart-success','chart-warning','chart-danger','chart-muted','chart-amber','chart-yellow','chart-sky','chart-emerald','chart-violet','chart-rose','chart-teal','chart-orange','chart-indigo'], chartDark, chartLight);
  set(['chart-grid','chart-hover-bg'], rad ? ['rgba(214, 239, 230, 0.09)','rgba(214, 239, 230, 0.035)'] : ['rgba(255, 255, 255, 0.06)','rgba(255, 255, 255, 0.02)'], rad ? ['rgba(22, 43, 43, 0.10)','rgba(22, 43, 43, 0.035)'] : ['rgba(20, 20, 24, 0.08)','rgba(20, 20, 24, 0.03)']);
  set(['charging-active','charging-done','charging-limited','charging-ac','charging-dc','charging-dcfc'], rad ? ['#FFB000','#38E8A5','#FF7054','#36CEFF','#B59AFF','#F077DA'] : ['#FD8304','#10B981','#F87171','#60A5FA','#A78BFA','#C084FC'], rad ? ['#C9371E','#007A4B','#D02D30','#007DA3','#7945D8','#B02A91'] : ['#FD8304','#059669','#EF4444','#3B82F6','#A78BFA','#C084FC']);
  set(['dm-everyday','dm-conserve','dm-terrain','dm-sand','dm-rock','dm-rally','dm-drift','dm-towing'], rad ? ['#38E8A5','#36CEFF','#2AE0CB','#FFD34E','#B59AFF','#F077DA','#FF7054','#FF9850'] : ['#10B981','#60A5FA','#22D3EE','#FBBF24','#A78BFA','#E879F9','#FB7185','#FB923C'], rad ? ['#007A4B','#007DA3','#007C73','#8D6A00','#7945D8','#B02A91','#D02D30','#B84D00'] : ['#059669','#3B82F6','#22D3EE','#FBBF24','#A78BFA','#E879F9','#FB7185','#FB923C']);
  set(['map-route-0','map-route-1','map-route-2','map-route-3','map-route-4','map-route-5'], rad ? ['#FF7054','#36CEFF','#FFD34E','#B59AFF','#38E8A5','#F077DA'] : ['#60A5FA','#34D399','#A78BFA','#F472B6','#F59E0B','#F87171'], rad ? ['#C9371E','#007DA3','#8D6A00','#7945D8','#007A4B','#B02A91'] : ['#38BDF8','#34D399','#A78BFA','#F472B6','#F59E0B','#F87171']);
  set(['dm-unknown'], [rad ? '#9CBDB9' : '#7A8B89'], [rad ? '#52716F' : '#6B7C7C']);
  set(['glow-sm','glow-md','glow-lg','glow-button'], rad ? ['0 0 20px rgba(255, 176, 0, 0.16)','0 0 40px rgba(255, 176, 0, 0.21)','0 0 60px rgba(255, 176, 0, 0.26)','0 0 20px rgba(255, 176, 0, 0.42)'] : ['0 0 20px rgba(253, 131, 4, 0.15)','0 0 40px rgba(253, 131, 4, 0.20)','0 0 60px rgba(253, 131, 4, 0.25)','0 0 20px rgba(253, 131, 4, 0.40)'], rad ? ['0 0 0 1px rgba(201, 55, 30, 0.12)','0 1px 2px rgba(201, 55, 30, 0.16)','0 2px 8px rgba(201, 55, 30, 0.21)','0 4px 12px rgba(201, 55, 30, 0.28)'] : ['0 0 0 1px rgba(253, 131, 4, 0.10)','0 1px 2px rgba(253, 131, 4, 0.15)','0 2px 8px rgba(253, 131, 4, 0.20)','0 4px 12px rgba(253, 131, 4, 0.25)']);
  set(['shadow-sm','shadow-md','shadow-lg','shadow-xl'], rad ? ['0 1px 2px rgba(0, 0, 0, 0.34)','0 4px 6px rgba(0, 0, 0, 0.34)','0 10px 15px rgba(0, 0, 0, 0.34)','0 20px 25px rgba(0, 0, 0, 0.44)'] : ['0 1px 2px rgba(0, 0, 0, 0.3)','0 4px 6px rgba(0, 0, 0, 0.3)','0 10px 15px rgba(0, 0, 0, 0.3)','0 20px 25px rgba(0, 0, 0, 0.4)'], rad ? ['0 1px 2px rgba(22, 43, 43, 0.07)','0 2px 6px rgba(22, 43, 43, 0.09)','0 8px 20px rgba(22, 43, 43, 0.12)','0 16px 32px rgba(22, 43, 43, 0.14)'] : ['0 1px 2px rgba(20, 20, 24, 0.06)','0 2px 6px rgba(20, 20, 24, 0.08)','0 8px 20px rgba(20, 20, 24, 0.10)','0 16px 32px rgba(20, 20, 24, 0.12)']);
  set(['value-halo'], [rad ? '-2px -2px 0 #10363B, 0 -2px 0 #10363B, 2px -2px 0 #10363B, 2px 0 0 #10363B, 2px 2px 0 #10363B, 0 2px 0 #10363B, -2px 2px 0 #10363B, -2px 0 0 #10363B' : '-2px -2px 0 #12121A, 0 -2px 0 #12121A, 2px -2px 0 #12121A, 2px 0 0 #12121A, 2px 2px 0 #12121A, 0 2px 0 #12121A, -2px 2px 0 #12121A, -2px 0 0 #12121A'], [rad ? '-2px -2px 0 #FFFFFF, 0 -2px 0 #FFFFFF, 2px -2px 0 #FFFFFF, 2px 0 0 #FFFFFF, 2px 2px 0 #FFFFFF, 0 2px 0 #FFFFFF, -2px 2px 0 #FFFFFF, -2px 0 0 #FFFFFF' : '-2px -2px 0 #FFFFFF, 0 -2px 0 #FFFFFF, 2px -2px 0 #FFFFFF, 2px 0 0 #FFFFFF, 2px 2px 0 #FFFFFF, 0 2px 0 #FFFFFF, -2px 2px 0 #FFFFFF, -2px 0 0 #FFFFFF']);
  return out;
};

const makeTheme = (id: ThemePalette): ThemeDefinition => {
  const rad = id === 'rad'; const colors = rad ? ['#FFB000','#36CEFF','#FF7054','#38E8A5','#B59AFF','#FF9850','#2AE0CB','#FF93A7','#839FFF','#F4F36B','#7AE0FF','#FFAFC7','#8AE36C','#DAA1FF','#FFD34E','#A6C7C2'] : ['#FD8304','#FACC15','#60A5FA','#10B981','#A78BFA','#F87171','#34D399','#FB923C','#818CF8'];
  const lightColors = rad ? ['#C9371E','#007DA3','#D02D30','#007A4B','#7945D8','#B84D00','#007C73','#B83461','#435BD0','#697900','#16769B','#A74773','#478100','#9744B8','#8D6A00','#486A64'] : ['#C96F08','#A16207','#2563EB','#047857','#7C3AED','#DC2626','#047857','#C2410C','#4F46E5'];
  const series = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`series-${String(i + 1).padStart(2, '0')}`, { dark: colors[i % colors.length]!, light: lightColors[i % lightColors.length]! }])) as ThemeDefinition['series'];
  const aliases = rad
    ? chart(
      ['#FFB000','#38E8A5','#FFC43D','#FF7054','#9AA9AA','#38E8A5','#FFB000','#36CEFF','#B59AFF','#FF7054','#2AE0CB','#839FFF','#F4F36B','#FF9850'],
      ['#C9371E','#007A4B','#9C5D00','#D02D30','#52716F','#007A4B','#8D6A00','#007DA3','#7945D8','#D02D30','#007C73','#435BD0','#697900','#B84D00'],
    )
    : chart(chartValues('#FD8304','#10B981','#F59E0B','#F87171','#A1A1A1', colors), chartValues('#FD8304','#047857','#B45309','#DC2626','#71717A', lightColors));
  const tokenPairs = makeTokens(rad);
  const tokens = { light: Object.fromEntries(Object.entries(tokenPairs).map(([key, pair]) => [key, pair.light])) as Record<SemanticToken, ThemeColor>, dark: Object.fromEntries(Object.entries(tokenPairs).map(([key, pair]) => [key, pair.dark])) as Record<SemanticToken, ThemeColor> };
  const paints = { accent: { light: tokens.light.accent, dark: tokens.dark.accent }, accentMuted: { light: tokens.light['accent-muted'], dark: tokens.dark['accent-muted'] }, mark: { light: tokens.light.accent, dark: tokens.dark.accent } };
  return { schemaVersion: 1, id, legacyPalette: id, name: rad ? 'RAD' : 'Classic', tokens, series, chartAliases: aliases, brandAssets: assets(rad), brandPaints: paints };
};

export const CLASSIC_THEME = makeTheme('classic');
export const RAD_THEME = makeTheme('rad');
export const BUILT_IN_THEMES = { classic: CLASSIC_THEME, rad: RAD_THEME } as const;
export const LEGACY_CHART_ALIASES = Object.freeze({ ...CLASSIC_THEME.chartAliases });

const colorPattern = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
export const CUSTOMIZABLE_SEMANTIC_TOKENS = [
  'bg-page','bg-surface','bg-elevated','bg-glass','bg-overlay','text-primary','text-secondary','text-tertiary','text-disabled','text-on-accent',
  'border-default','border-strong','border-accent','status-positive','status-warning','status-danger','status-info',
  'charging-active','charging-done','charging-limited','charging-ac','charging-dc','charging-dcfc','dm-everyday','dm-conserve','dm-terrain','dm-sand','dm-rock','dm-rally','dm-drift','dm-towing','dm-unknown',
  'accent','accent-hover','accent-active','accent-muted','chart-grid','chart-hover-bg','chart-accent','chart-success','chart-warning','chart-danger','chart-muted','chart-amber','chart-yellow','chart-sky','chart-emerald','chart-violet','chart-rose','chart-teal','chart-orange','chart-indigo',
  'map-route-0','map-route-1','map-route-2','map-route-3','map-route-4','map-route-5',
] as const satisfies readonly SemanticToken[];
const customizableTokens = new Set<SemanticToken>(CUSTOMIZABLE_SEMANTIC_TOKENS);
export function validateThemeOverride(override: ThemeOverride): string[] {
  const errors: string[] = [];
  const root = override as Record<string, unknown>;
  for (const key of Object.keys(root)) if (!['theme', 'tokens', 'series', 'brandPaints'].includes(key)) errors.push(`Unsupported theme property: ${key}`);
  if (override.theme && !(override.theme in BUILT_IN_THEMES)) errors.push(`Unknown built-in theme: ${override.theme}`);
  for (const [key, value] of Object.entries(override.tokens ?? {})) {
    if (!customizableTokens.has(key as SemanticToken)) errors.push(`Token is not customizable: ${key}`);
    for (const [mode, color] of Object.entries(value ?? {})) if (!['light', 'dark'].includes(mode) || (color && !colorPattern.test(color))) errors.push(`Invalid custom color for ${key}.${mode}`);
  }
  for (const [key, value] of Object.entries(override.series ?? {})) {
    if (!/^series-(0[1-9]|1[0-6])$/.test(key)) errors.push(`Unknown series slot: ${key}`);
    for (const [mode, color] of Object.entries(value ?? {})) if (!['light', 'dark'].includes(mode) || (color && !colorPattern.test(color))) errors.push(`Invalid custom color for ${key}.${mode}`);
  }
  for (const [key, value] of Object.entries(override.brandPaints ?? {})) {
    if (!['accent', 'accentMuted', 'mark'].includes(key)) errors.push(`Unknown brand paint: ${key}`);
    for (const [mode, color] of Object.entries(value ?? {})) if (!['light', 'dark'].includes(mode) || (color && !colorPattern.test(color))) errors.push(`Invalid custom color for brandPaints.${key}.${mode}`);
  }
  return errors;
}
export function resolveTheme(override: ThemeOverride = {}): ResolvedTheme { const base = BUILT_IN_THEMES[override.theme ?? 'classic']; const errors = validateThemeOverride(override); if (errors.length) throw new Error(errors.join('; ')); const tokens = { light: { ...base.tokens.light }, dark: { ...base.tokens.dark } }; for (const [key, value] of Object.entries(override.tokens ?? {})) for (const mode of ['light', 'dark'] as const) if (value?.[mode]) tokens[mode][key as SemanticToken] = value[mode]!; const series = { ...base.series }; for (const [key, value] of Object.entries(override.series ?? {})) series[key as keyof typeof series] = { ...series[key as keyof typeof series], ...value }; const brandPaints = { ...base.brandPaints }; for (const [key, value] of Object.entries(override.brandPaints ?? {})) brandPaints[key as keyof typeof brandPaints] = { ...brandPaints[key as keyof typeof brandPaints], ...value }; return { ...base, tokens, series, brandPaints, sourceTheme: base.legacyPalette }; }
export function createThemeRegistry(definitions: readonly ThemeDefinition[]): ReadonlyMap<string, ThemeDefinition> { const registry = new Map<string, ThemeDefinition>(); for (const definition of definitions) { if (registry.has(definition.id)) throw new Error(`Duplicate theme id: ${definition.id}`); registry.set(definition.id, definition); } return registry; }
export const THEME_REGISTRY = createThemeRegistry([CLASSIC_THEME, RAD_THEME]);
export function registryManifest() { return { schemaVersion: 1, registryHash: registryHash(), builtins: [CLASSIC_THEME, RAD_THEME] }; }
export function stableThemeJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableThemeJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${stableThemeJson((value as Record<string, unknown>)[k])}`).join(',')}}`; return JSON.stringify(value); }
export function themeHash(theme: ThemeDefinition): string { let hash = 2166136261; for (const char of stableThemeJson(theme).replace(/"definitionHash":(?:"[^"]*"|null),?/, '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); }
export function registryHash(): string { return themeHash(CLASSIC_THEME) + themeHash(RAD_THEME); }
