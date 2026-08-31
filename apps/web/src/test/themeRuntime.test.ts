import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTheme } from '../../../../packages/themes/src/index';
import {
  applyThemePreferences,
  getThemeRuntimeSnapshot,
  resetThemePreferences,
  resolveThemeRuntimeResponse,
  subscribeThemeRuntime,
} from '@riviamigo/ui/lib/theme';

describe('theme runtime', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    for (const key of ['data-rm-palette', 'data-rm-theme-id', 'data-rm-theme-kind', 'data-rm-theme-revision']) document.documentElement.removeAttribute(key);
    localStorage.clear();
    resetThemePreferences();
  });

  it('applies V1 preferences atomically and projects legacy DOM state', () => {
    applyThemePreferences({ mode: 'light', palette: 'rad' });
    const root = document.documentElement;
    expect(root).toHaveClass('light');
    expect(root.dataset.rmPalette).toBe('rad');
    expect(root.dataset.rmThemeId).toBe('rad');
    expect(root.dataset.rmThemeKind).toBe('builtin');
    expect(root.style.getPropertyValue('--rm-chart-accent')).toBe('#A46617');
    expect(localStorage.getItem('rm-theme')).toBeNull();
  });

  it('supports V2 custom revisions and notifies subscribers when only revision changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThemeRuntime(listener);
    const custom = resolveTheme({ theme: 'classic' });
    applyThemePreferences({ schemaVersion: 2, mode: 'dark', selection: { kind: 'custom', themeId: 'custom', revision: 7 } }, custom);
    expect(getThemeRuntimeSnapshot().revision).toBe(7);
    expect(document.documentElement.dataset.rmThemeRevision).toBe('7');
    applyThemePreferences({ schemaVersion: 2, mode: 'dark', selection: { kind: 'custom', themeId: 'custom', revision: 8 } }, custom);
    expect(getThemeRuntimeSnapshot().revision).toBe(8);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('preserves an active custom selection when a legacy mode update arrives', () => {
    const custom = resolveTheme({ theme: 'classic', tokens: { accent: { light: '#654321', dark: '#123456' } } });
    applyThemePreferences({ schemaVersion: 2, mode: 'dark', selection: { kind: 'custom', themeId: 'custom', revision: 3 } }, custom);
    applyThemePreferences({ mode: 'light', palette: 'classic' });
    const snapshot = getThemeRuntimeSnapshot();
    expect(snapshot.themeRef).toEqual({ kind: 'custom', themeId: 'custom', revision: 3 });
    expect(snapshot.selectedMode).toBe('light');
    expect(snapshot.legacyPalette).toBe('classic');
    expect(snapshot.cssVariables['--rm-accent']).toBe('#654321');
  });

  it('honors a legacy palette switch by leaving the active custom selection', () => {
    const custom = resolveTheme({ theme: 'classic', tokens: { accent: { light: '#654321', dark: '#123456' } } });
    applyThemePreferences({ schemaVersion: 2, mode: 'dark', selection: { kind: 'custom', themeId: 'custom', revision: 3 } }, custom);
    applyThemePreferences({ mode: 'light', palette: 'rad' });
    const snapshot = getThemeRuntimeSnapshot();
    expect(snapshot.themeRef).toEqual({ kind: 'builtin', themeId: 'rad' });
    expect(snapshot.legacyPalette).toBe('rad');
    expect(snapshot.cssVariables['--rm-accent']).not.toBe('#654321');
  });

  it('resolves the production v2 response on mount and keeps the custom revision after v1 update and refetch', () => {
    const response = {
      preferences: {
        schemaVersion: 2 as const,
        mode: 'dark' as const,
        selection: {
          kind: 'custom' as const,
          themeId: 'custom-1',
          revision: 9,
          baseThemeId: 'classic' as const,
          definition: { theme: 'classic' as const, tokens: { accent: { dark: '#123456', light: '#654321' } } },
          definitionHash: 'a'.repeat(64),
        },
      },
      etag: '"preferences-9"',
    };
    const initial = resolveThemeRuntimeResponse(response);
    applyThemePreferences(initial.preferences!, initial.resolvedTheme);
    applyThemePreferences({ mode: 'light', palette: 'classic' });

    const refetched = resolveThemeRuntimeResponse({ ...response, preferences: { ...response.preferences, mode: 'light' } });
    applyThemePreferences(refetched.preferences!, refetched.resolvedTheme);
    expect(getThemeRuntimeSnapshot().themeRef).toEqual(expect.objectContaining({ kind: 'custom', themeId: 'custom-1', revision: 9 }));
    expect(getThemeRuntimeSnapshot().selectedMode).toBe('light');
    expect(getThemeRuntimeSnapshot().cssVariables['--rm-accent']).toBe('#654321');
  });

  it('resets account visual state to classic dark on logout', () => {
    applyThemePreferences({ mode: 'light', palette: 'rad' });
    resetThemePreferences();
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.dataset.rmPalette).toBe('classic');
    expect(document.documentElement.dataset.rmThemeRevision).toBe('0');
  });
});
