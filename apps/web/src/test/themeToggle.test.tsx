import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '@riviamigo/ui/primitives';
import { ThemeModeSync } from '@riviamigo/ui/lib/theme';

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

  it.each([
    { dark: true, expected: 'dark' },
    { dark: false, expected: 'light' },
  ])('applies system theme from prefers-color-scheme=$dark', async ({ dark, expected }) => {
    localStorage.setItem('rm-theme', 'system');
    setMatchMedia({ dark });

    render(<ThemeModeSync />);

    await waitFor(() => {
      expect(document.documentElement).toHaveClass(expected);
      expect(document.documentElement.style.colorScheme).toBe(expected);
    });
  });

  it('opens a mobile-safe chooser and stores the system mode', async () => {
    localStorage.setItem('rm-theme', 'dark');
    setMatchMedia({ dark: false, mobile: true });

    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Theme options' }));

    const menu = await screen.findByRole('menu', { name: 'Theme options' });
    expect(menu).toHaveClass('inset-x-2');
    expect(menu).toHaveClass('bottom-2');
    expect(screen.getByRole('menuitemradio', { name: /system/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemradio', { name: /system/i }));

    await waitFor(() => {
      expect(localStorage.getItem('rm-theme')).toBe('system');
      expect(document.documentElement).toHaveClass('light');
      expect(document.documentElement.style.colorScheme).toBe('light');
    });
  });
});
