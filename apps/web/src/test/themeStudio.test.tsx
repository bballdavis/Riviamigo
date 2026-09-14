import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeStudioPage } from '../features/settings/ThemeStudioPage';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  saveRevision: vi.fn(),
  publishRevision: vi.fn(),
  rollback: vi.fn(),
  retire: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@riviamigo/hooks', () => ({
  queryKeys: {
    themePreferences: {
      all: ['theme-preferences', 'v2'],
      forUser: (userId: string) => ['theme-preferences', 'v2', userId],
    },
    themes: { catalog: (userId: string) => ['themes', userId, 'catalog'], resource: (userId: string, themeId: string) => ['themes', userId, 'resource', themeId] },
  },
  themeClient: mocks,
  useAuth: (selector: (state: { userId: string }) => unknown) => selector({ userId: 'user-1' }),
}));

const resource = {
  themeId: 'custom-1',
  name: 'Trail dusk',
  baseThemeId: 'classic',
  publishedRevision: 1,
  publishedDefinition: { theme: 'classic' },
  retiredAt: null,
  etag: '"theme-custom-1-1"',
  revisions: [{
    revision: 1,
    definition: { theme: 'classic' },
    definitionHash: 'a'.repeat(64),
    createdAt: '2026-09-01T00:00:00Z',
    publishedAt: '2026-09-01T00:00:00Z',
  }],
} as const;

function renderStudio() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['theme-preferences', 'v2', 'user-1'], {
    preferences: { schemaVersion: 2, mode: 'dark', selection: { kind: 'custom', themeId: 'custom-1', revision: 1 } },
    etag: '"theme-preferences-3"',
  });
  return render(<QueryClientProvider client={client}><ThemeStudioPage themeId="custom-1" /></QueryClientProvider>);
}

describe('ThemeStudioPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(resource);
    mocks.saveRevision.mockResolvedValue({ themeId: 'custom-1', revision: 2, etag: '"theme-custom-1-2"' });
    mocks.publishRevision.mockResolvedValue({ themeId: 'custom-1', publishedRevision: 2, applied: false, etag: '"theme-custom-1-3"' });
  });

  it('publishes the exact revision returned by save even before the resource refetch catches up', async () => {
    renderStudio();
    fireEvent.click(await screen.findByRole('button', { name: 'Save revision' }));
    await waitFor(() => expect(mocks.saveRevision).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(mocks.publishRevision).toHaveBeenCalledWith(
      'custom-1',
      2,
      false,
      '"theme-custom-1-2"',
      undefined,
    ));
  });
});
