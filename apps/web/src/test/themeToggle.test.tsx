import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '@riviamigo/ui/primitives';
import { applyThemePreferences, ThemeModeSync } from '@riviamigo/ui/lib/theme';

const originalMatchMedia = window.matchMedia;

function setMatchMedia(options: { dark?: boolean; mobile?: boolean }) {
  const { dark = false, mobile = false } = options;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-color-scheme') ? dark : mobile,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('theme chooser', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    setMatchMedia({ dark: false, mobile: false });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('resets to the safe classic-dark state before account preferences load', async () => {
    render(<ThemeModeSync />);

    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark');
      expect(document.documentElement.dataset.rmPalette).toBe('classic');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });
  });

  it('opens a mobile-safe chooser and reports the selected mode without browser persistence', async () => {
    setMatchMedia({ dark: false, mobile: true });
    const onModeChange = vi.fn();

    render(<ThemeToggle mode="dark" onModeChange={onModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Theme options' }));

    const menu = await screen.findByRole('menu', { name: 'Theme options' });
    expect(menu).toHaveClass('inset-x-2');
    expect(menu).toHaveClass('bottom-2');
    expect(screen.getByRole('menuitemradio', { name: /system/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemradio', { name: /system/i }));

    await waitFor(() => {
      expect(onModeChange).toHaveBeenCalledWith('system');
      expect(localStorage.getItem('rm-theme')).toBeNull();
    });
  });

  it('applies the account preference to the document without using localStorage', () => {
    applyThemePreferences({ mode: 'light', palette: 'rad' });

    expect(document.documentElement).toHaveClass('light');
    expect(document.documentElement.dataset.rmPalette).toBe('rad');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(localStorage.getItem('rm-theme')).toBeNull();
  });

  it.each([
    { dark: true, expected: 'dark' },
    { dark: false, expected: 'light' },
  ])('resolves persisted system mode from prefers-color-scheme=$dark', ({ dark, expected }) => {
    setMatchMedia({ dark });
    applyThemePreferences({ mode: 'system', palette: 'classic' });

    expect(document.documentElement).toHaveClass(expected);
    expect(document.documentElement.style.colorScheme).toBe(expected);
  });
});
