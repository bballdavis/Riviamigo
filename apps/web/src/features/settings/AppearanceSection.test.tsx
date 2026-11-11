import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserPreferencesResponse } from '@riviamigo/types';

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  navigate: vi.fn(),
  unitPreferences: undefined as unknown as UserPreferencesResponse,
  basemap: undefined as { resolved_provider: string } | undefined,
  api: { updateThemePreferences: vi.fn() },
  themeClient: { getCatalog: vi.fn(), getPreferences: vi.fn(), updatePreferences: vi.fn(), create: vi.fn() },
  updateMapStyle: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useBlocker: () => ({ status: 'idle' }),
}));

vi.mock('@riviamigo/ui/primitives', async () => await import('../../test/mockPrimitives'));

vi.mock('@riviamigo/ui/lib/theme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@riviamigo/ui/lib/theme')>()),
  applyThemePreferences: mocks.apply,
}));

vi.mock('@riviamigo/hooks', () => ({
  api: mocks.api,
  queryKeys: {
    unitPreferences: { current: ['unit-preferences'] },
    themePreferences: { all: ['theme-preferences'], forUser: (userId: string) => ['theme-preferences', userId] },
    themes: { catalog: (userId: string) => ['themes', userId, 'catalog'] },
  },
  themeClient: mocks.themeClient,
  useAuth: (selector: (state: { userId: string }) => unknown) => selector({ userId: 'user-1' }),
  useBasemapConfig: () => ({ data: mocks.basemap }),
  // Mirrors the real hook: writes the new style into the preference cache before the request settles and rolls it back on failure.
  useUpdateMapStyle: () => {
    const queryClient = useQueryClient();
    return {
      isPending: false,
      mutateAsync: async (style: string) => {
        const key = ['unit-preferences'];
        const previous = queryClient.getQueryData<UserPreferencesResponse>(key);
        queryClient.setQueryData(key, { ...previous, map_style: style });
        try {
          await mocks.updateMapStyle(style);
        } catch (error) {
          queryClient.setQueryData(key, previous);
          throw error;
        }
        return { map_style: style };
      },
    };
  },
}));

import { AppearanceSection } from './AppearanceSection';
import { SettingsDraftProvider } from './drafts/SettingsDraftProvider';

/** Feeds the section from the preference cache, as the Settings page does. */
function PreferencesHarness() {
  const query = useQuery({ queryKey: ['unit-preferences'], queryFn: async () => mocks.unitPreferences, staleTime: Infinity });
  return <AppearanceSection preferencesQuery={{ data: query.data, isLoading: query.isLoading }} />;
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsDraftProvider>
        <PreferencesHarness />
      </SettingsDraftProvider>
    </QueryClientProvider>,
  );
}

const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' });
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const discardButton = () => screen.getByRole('button', { name: 'Discard' });
/** Resolves once the saved theme has loaded and the cards render. */
const themesReady = () => screen.findByRole('radio', { name: /^RAD/ });

const savedClassicRuntime = { schemaVersion: 2, mode: 'dark', selection: { kind: 'builtin', themeId: 'classic' } };

describe('AppearanceSection staged draft', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.basemap = undefined;
    mocks.unitPreferences = {
      theme: { mode: 'dark', palette: 'classic' },
      map_style: 'follow-theme',
    } as unknown as UserPreferencesResponse;
    mocks.api.updateThemePreferences.mockResolvedValue({ theme: { mode: 'light', palette: 'classic' } });
    mocks.themeClient.getCatalog.mockResolvedValue({ schemaVersion: 2, registryHash: 'hash', builtins: [], customThemes: [] });
    mocks.themeClient.getPreferences.mockResolvedValue({ preferences: savedClassicRuntime, etag: '"theme-preferences-1"' });
    mocks.themeClient.updatePreferences.mockResolvedValue({
      preferences: { schemaVersion: 2, mode: 'dark', selection: { kind: 'builtin', themeId: 'rad' } },
      etag: '"theme-preferences-2"',
    });
    mocks.updateMapStyle.mockResolvedValue({ map_style: 'liberty' });
  });

  it('stages an appearance mode change: shows the bar, previews it, and makes no API call', async () => {
    renderSection();
    await themesReady();
    fireEvent.change(screen.getByLabelText('Appearance mode'), { target: { value: 'light' } });

    expect(bar()).toBeInTheDocument();
    expect(mocks.api.updateThemePreferences).not.toHaveBeenCalled();
    expect(mocks.apply).toHaveBeenLastCalledWith({ ...savedClassicRuntime, mode: 'light' }, null);
  });

  it('Save persists the staged mode with the same payload as before and clears the bar', async () => {
    renderSection();
    await themesReady();
    fireEvent.change(screen.getByLabelText('Appearance mode'), { target: { value: 'light' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.api.updateThemePreferences).toHaveBeenCalledWith({ mode: 'light', palette: 'classic' }));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(screen.getByLabelText('Appearance mode')).toHaveValue('light');
  });

  it('Discard reverts the staged mode and re-applies the saved theme', async () => {
    renderSection();
    await themesReady();
    fireEvent.change(screen.getByLabelText('Appearance mode'), { target: { value: 'light' } });
    expect(mocks.apply).toHaveBeenLastCalledWith({ ...savedClassicRuntime, mode: 'light' }, null);

    fireEvent.click(discardButton());

    expect(screen.getByLabelText('Appearance mode')).toHaveValue('dark');
    expect(bar()).not.toBeInTheDocument();
    expect(mocks.apply).toHaveBeenLastCalledWith(savedClassicRuntime, null);
    expect(mocks.api.updateThemePreferences).not.toHaveBeenCalled();
  });

  it('picking a theme stages it; Save sends the V2 payload with the loaded etag', async () => {
    renderSection();
    fireEvent.click(await themesReady());

    expect(bar()).toBeInTheDocument();
    expect(mocks.themeClient.updatePreferences).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /^RAD/ })).toHaveAttribute('aria-checked', 'true');
    expect(mocks.apply).toHaveBeenLastCalledWith({ schemaVersion: 2, mode: 'dark', selection: { kind: 'builtin', themeId: 'rad' } }, null);

    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.themeClient.updatePreferences).toHaveBeenCalledWith(
      { schemaVersion: 2, mode: 'dark', selection: { kind: 'builtin', themeId: 'rad' } },
      '"theme-preferences-1"',
    ));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
  });

  it('Save with both a mode and a theme change sends the staged mode with the theme payload', async () => {
    renderSection();
    fireEvent.click(await themesReady());
    fireEvent.change(screen.getByLabelText('Appearance mode'), { target: { value: 'light' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mocks.themeClient.updatePreferences).toHaveBeenCalledWith(
      { schemaVersion: 2, mode: 'light', selection: { kind: 'builtin', themeId: 'rad' } },
      '"theme-preferences-1"',
    ));
    await waitFor(() => expect(mocks.api.updateThemePreferences).toHaveBeenCalledWith({ mode: 'light', palette: 'classic' }));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
  });

  it('a failed theme save keeps the bar and the staged theme open with a user-facing message', async () => {
    mocks.themeClient.updatePreferences.mockRejectedValueOnce(new Error('HTTP 412'));
    renderSection();
    fireEvent.click(await themesReady());
    fireEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('The theme changed elsewhere or could not be saved. Refresh and try again.');
    expect(bar()).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^RAD/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('stages a map style change: shows the bar and makes no API call; Save calls the map style mutation', async () => {
    mocks.basemap = { resolved_provider: 'openfreemap' };
    renderSection();
    await themesReady();
    fireEvent.change(screen.getByLabelText('Map style'), { target: { value: 'liberty' } });

    expect(bar()).toBeInTheDocument();
    expect(mocks.updateMapStyle).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(mocks.updateMapStyle).toHaveBeenCalledWith('liberty'));
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(screen.getByLabelText('Map style')).toHaveValue('liberty');
  });

  it('a failed map style save keeps the staged style and the bar open', async () => {
    mocks.basemap = { resolved_provider: 'openfreemap' };
    mocks.updateMapStyle.mockRejectedValueOnce(new Error('offline'));
    renderSection();
    await themesReady();
    fireEvent.change(screen.getByLabelText('Map style'), { target: { value: 'liberty' } });
    fireEvent.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save map style.');
    expect(bar()).toBeInTheDocument();
    expect(screen.getByLabelText('Map style')).toHaveValue('liberty');
  });

  it('Discard reverts a staged map style without calling the API', async () => {
    mocks.basemap = { resolved_provider: 'openfreemap' };
    renderSection();
    await themesReady();
    fireEvent.change(screen.getByLabelText('Map style'), { target: { value: 'liberty' } });
    fireEvent.click(discardButton());

    expect(screen.getByLabelText('Map style')).toHaveValue('follow-theme');
    expect(bar()).not.toBeInTheDocument();
    expect(mocks.updateMapStyle).not.toHaveBeenCalled();
  });

  it('changing a staged value back to the saved one clears the bar and restores the saved theme preview', async () => {
    renderSection();
    await themesReady();
    fireEvent.change(screen.getByLabelText('Appearance mode'), { target: { value: 'light' } });
    fireEvent.change(screen.getByLabelText('Appearance mode'), { target: { value: 'dark' } });

    expect(bar()).not.toBeInTheDocument();
    expect(mocks.apply).toHaveBeenLastCalledWith(savedClassicRuntime, null);
  });

  it('leaving the section while a theme is previewed restores the saved theme', async () => {
    const { unmount } = renderSection();
    await themesReady();
    fireEvent.change(screen.getByLabelText('Appearance mode'), { target: { value: 'light' } });
    unmount();

    expect(mocks.apply).toHaveBeenLastCalledWith(savedClassicRuntime, null);
    expect(mocks.api.updateThemePreferences).not.toHaveBeenCalled();
  });
});
