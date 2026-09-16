import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getThemeRuntimeSnapshot, resetThemePreferences } from '@riviamigo/ui/lib/theme';
import { applyThemePreferences } from '@riviamigo/ui/lib/theme';
import { resolveTheme } from '@riviamigo/themes';
import { useThemePreferenceController } from '../hooks/useThemePreferenceController';

const mocks = vi.hoisted(() => {
  const state = { userId: 'user-a' };
  const useAuthMock = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return { getPreferences: vi.fn(), updatePreferences: vi.fn(), state, useAuthMock };
});

vi.mock('@riviamigo/hooks', () => ({
  queryKeys: {
    themePreferences: { forUser: (id: string) => ['theme-preferences', 'v2', id] },
    unitPreferences: { current: ['unit-preferences'] },
  },
  themeClient: { getPreferences: mocks.getPreferences, updatePreferences: mocks.updatePreferences },
  useAuth: mocks.useAuthMock,
}));

const customResponse = (mode: 'light' | 'dark' = 'dark', etag = 'etag-a') => ({
  preferences: {
    schemaVersion: 2 as const,
    mode,
    selection: {
      kind: 'custom' as const,
      themeId: 'trail-dusk',
      revision: 7,
      baseThemeId: 'classic' as const,
      definition: { theme: 'classic', tokens: { accent: { dark: '#123456', light: '#654321' } } },
      definitionHash: 'a'.repeat(64),
    },
  },
  etag,
});

function Probe() {
  const controller = useThemePreferenceController();
  return <button onClick={() => controller.onModeChange('light')}>{controller.mode}:{getThemeRuntimeSnapshot().themeRef.kind}:{getThemeRuntimeSnapshot().revision}</button>;
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['theme-preferences', 'v2', 'user-a'], customResponse());
  return render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>);
}

describe('useThemePreferenceController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.userId = 'user-a';
    resetThemePreferences();
    applyThemePreferences(customResponse().preferences, resolveTheme({ theme: 'classic', tokens: { accent: { dark: '#123456', light: '#654321' } } }));
    mocks.getPreferences.mockResolvedValue(customResponse());
    mocks.updatePreferences.mockImplementation(async (preferences, etag) => ({ ...customResponse(preferences.mode, 'etag-b'), preferences }));
  });

  it('writes only mode while retaining the custom revision and definition', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(/dark:custom:7/));
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.updatePreferences).toHaveBeenCalledWith(expect.objectContaining({ mode: 'light', selection: expect.objectContaining({ themeId: 'trail-dusk', revision: 7, definition: expect.any(Object) }) }), 'etag-a'));
    await waitFor(() => expect(getThemeRuntimeSnapshot().selectedMode).toBe('light'));
    await waitFor(() => expect(getThemeRuntimeSnapshot().themeRef).toEqual(expect.objectContaining({ kind: 'custom', themeId: 'trail-dusk', revision: 7 })));
    expect(getThemeRuntimeSnapshot().cssVariables['--rm-accent']).toBe('#654321');
  });

  it('restores the prior custom runtime when the write fails', async () => {
    mocks.updatePreferences.mockRejectedValue(new Error('conflict'));
    renderProbe();
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(/dark:custom:7/));
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.updatePreferences).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(/dark:custom:7/));
    expect(getThemeRuntimeSnapshot().cssVariables['--rm-accent']).toBe('#123456');
  });

  it('ignores a stale response after the authenticated owner changes', async () => {
    let resolveUpdate!: (value: unknown) => void;
    mocks.updatePreferences.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    const view = renderProbe();
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(/dark:custom:7/));
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.updatePreferences).toHaveBeenCalled());
    mocks.state.userId = 'user-b';
    view.rerender(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>);
    await act(async () => { resolveUpdate(customResponse('light', 'stale')); });
    await waitFor(() => expect(getThemeRuntimeSnapshot().selectedMode).toBe('dark'));
    expect(getThemeRuntimeSnapshot().themeRef).toEqual(expect.objectContaining({ kind: 'custom', themeId: 'trail-dusk', revision: 7 }));
  });

  it('coalesces rapid mode clicks into one write while one mutation is pending', async () => {
    mocks.updatePreferences.mockImplementation(() => new Promise(() => {}));
    renderProbe();
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent(/dark:custom:7/));
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.updatePreferences).toHaveBeenCalledTimes(1));
  });
});
