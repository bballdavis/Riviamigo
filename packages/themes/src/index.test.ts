import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES, CUSTOMIZABLE_SEMANTIC_TOKENS, LEGACY_CHART_ALIASES, SEMANTIC_TOKEN_CATALOG, createThemeRegistry, registryHash, registryManifest, resolveTheme, validateThemeOverride } from './index';

describe('theme registry', () => {
  it('contains complete, parity-shaped built-ins', () => {
    expect(Object.keys(BUILT_IN_THEMES)).toEqual(['classic', 'rad']);
    expect(Object.keys(BUILT_IN_THEMES.classic.tokens.light)).toHaveLength(Object.keys(SEMANTIC_TOKEN_CATALOG).length);
    expect(Object.keys(BUILT_IN_THEMES.classic.series)).toHaveLength(16);
    expect(BUILT_IN_THEMES.classic.schemaVersion).toBe(1);
    expect(BUILT_IN_THEMES.classic.series['series-01']).toEqual({ dark: '#FD8304', light: '#C96F08' });
    expect(BUILT_IN_THEMES.classic.chartAliases.accent).toEqual({ dark: '#FD8304', light: '#FD8304' });
    expect(BUILT_IN_THEMES.classic.tokens.light['status-positive']).toBe('#059669');
    expect(BUILT_IN_THEMES.classic.tokens.light['status-warning']).toBe('#D97706');
    expect(BUILT_IN_THEMES.classic.tokens.light['status-danger']).toBe('#EF4444');
    expect(BUILT_IN_THEMES.classic.tokens.light['status-info']).toBe('#3B82F6');
    expect(BUILT_IN_THEMES.classic.tokens.light['accent-hover']).toBe('#EA580C');
    expect(BUILT_IN_THEMES.classic.tokens.light['charging-done']).toBe('#059669');
    expect(BUILT_IN_THEMES.classic.tokens.dark['glow-sm']).toBe('0 0 20px rgba(253, 131, 4, 0.15)');
    expect(BUILT_IN_THEMES.rad.chartAliases.accent).toEqual({ dark: '#FFB000', light: '#F26A2E' });
    expect(BUILT_IN_THEMES.rad.series['series-02']).toEqual({ dark: '#FF7054', light: '#F26A2E' });
    expect(BUILT_IN_THEMES.rad.tokens.light['status-positive']).toBe('#007A4B');
    expect(BUILT_IN_THEMES.rad.tokens.light['accent-active']).toBe('#8E2E0A');
    expect(BUILT_IN_THEMES.rad.tokens.light['charging-ac']).toBe('#007DA3');
    expect(BUILT_IN_THEMES.rad.tokens.light['dm-everyday']).toBe('#007A4B');
  });
  it('rejects unknown or non-canonical overrides', () => {
    expect(validateThemeOverride({ tokens: { nope: { dark: '#FFFFFF' } } as never })).toContain('Token is not customizable: nope');
    expect(validateThemeOverride({ tokens: { accent: { dark: 'var(--bad)' } } })).toContain('Invalid custom color for accent.dark');
    expect(validateThemeOverride({ tokens: { 'glow-sm': { dark: '#FFFFFF' } } })).toContain('Token is not customizable: glow-sm');
    expect(CUSTOMIZABLE_SEMANTIC_TOKENS.every((token) => !['glow-sm','glow-md','glow-lg','glow-button','shadow-sm','shadow-md','shadow-lg','shadow-xl','value-halo'].includes(token))).toBe(true);
    expect(validateThemeOverride({ series: { 'series-17': { dark: '#FFFFFF' } } as never })).toContain('Unknown series slot: series-17');
    expect(validateThemeOverride({ brandPaints: { unsafe: { dark: '#FFFFFF' } } as never })).toContain('Unknown brand paint: unsafe');
    expect(validateThemeOverride({ brandPaints: { mark: { dark: 'url(https://example.test)' } } })).toContain('Invalid custom color for brandPaints.mark.dark');
    expect(validateThemeOverride({ script: 'alert(1)' } as never)).toContain('Unsupported theme property: script');
  });
  it('resolves deterministically and retains legacy aliases', () => {
    const a = resolveTheme({ theme: 'rad', series: { 'series-01': { dark: '#112233' } } });
    expect(a.series['series-01']).toEqual({ dark: '#112233', light: '#FFB000' }); expect(resolveTheme({ theme: 'rad' })).toEqual(resolveTheme({ theme: 'rad' }));
    expect(registryHash()).toBe(registryHash()); expect(LEGACY_CHART_ALIASES.accent).toEqual({ dark: '#FD8304', light: '#FD8304' });
    expect(Object.keys(registryManifest())).toEqual(['schemaVersion', 'registryHash', 'builtins']);
  });
  it('rejects duplicate registry identifiers', () => {
    expect(() => createThemeRegistry([BUILT_IN_THEMES.classic, { ...BUILT_IN_THEMES.classic }])).toThrow('Duplicate theme id: classic');
  });
});
