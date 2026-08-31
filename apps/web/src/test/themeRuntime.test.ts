import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTheme } from '../../../../packages/themes/src/index';
import {
  applyThemePreferences,
  getThemeRuntimeSnapshot,
  resetThemePreferences,
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

  it('resets account visual state to classic dark on logout', () => {
    applyThemePreferences({ mode: 'light', palette: 'rad' });
    resetThemePreferences();
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.dataset.rmPalette).toBe('classic');
    expect(document.documentElement.dataset.rmThemeRevision).toBe('0');
  });
});
