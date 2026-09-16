import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeGallery } from '../features/settings/ThemeGallery';

const mocks = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@riviamigo/hooks', () => ({
  queryKeys: { themePreferences: { all: ['theme-preferences', 'v2'], forUser: (userId: string) => ['theme-preferences', 'v2', userId] }, unitPreferences: { current: ['unit-preferences'] }, themes: { catalog: (userId: string) => ['themes', userId, 'catalog'] } },
  themeClient: { getCatalog: mocks.getCatalog, getPreferences: mocks.getPreferences, updatePreferences: mocks.updatePreferences, create: mocks.create },
  useAuth: (selector: (state: { userId: string }) => unknown) => selector({ userId: 'user-1' }),
}));

function renderGallery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ThemeGallery /></QueryClientProvider>);
}

describe('ThemeGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCatalog.mockResolvedValue({ schemaVersion: 2, registryHash: 'hash', builtins: [], customThemes: [] });
    mocks.getPreferences.mockResolvedValue({ preferences: { schemaVersion: 2, mode: 'dark', selection: { kind: 'builtin', themeId: 'classic' } }, etag: '"theme-preferences-1"' });
    mocks.updatePreferences.mockResolvedValue({ preferences: { schemaVersion: 2, mode: 'dark', selection: { kind: 'builtin', themeId: 'rad' } }, etag: '"theme-preferences-2"' });
    mocks.create.mockResolvedValue({ themeId: 'custom-1', etag: '"theme-custom-1-1"' });
  });

  it('persists built-in selection through the V2 account preference', async () => {
    renderGallery();
    fireEvent.click(await screen.findByRole('radio', { name: /^RAD/ }));
    await waitFor(() => expect(mocks.updatePreferences).toHaveBeenCalledWith({ schemaVersion: 2, mode: 'dark', selection: { kind: 'builtin', themeId: 'rad' } }, '"theme-preferences-1"'));
  });

  it('creates an owned theme and opens Theme Studio', async () => {
    renderGallery();
    fireEvent.click(await screen.findByRole('button', { name: 'Create custom theme' }));
    fireEvent.change(screen.getByLabelText('Theme name'), { target: { value: 'Trail dusk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('Trail dusk', 'classic'));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/themes/$themeId', params: { themeId: 'custom-1' } });
  });
});
