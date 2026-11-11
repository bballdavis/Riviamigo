import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeRef } from '@riviamigo/types';
import { ThemeGallery } from '../features/settings/ThemeGallery';

const mocks = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  updatePreferences: vi.fn(),
  create: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@riviamigo/hooks', () => ({
  queryKeys: { themes: { catalog: (userId: string) => ['themes', userId, 'catalog'] } },
  themeClient: { getCatalog: mocks.getCatalog, updatePreferences: mocks.updatePreferences, create: mocks.create },
  useAuth: (selector: (state: { userId: string }) => unknown) => selector({ userId: 'user-1' }),
}));

function renderGallery(props: { selected?: ThemeRef; loading?: boolean; disabled?: boolean; onSelect?: (choice: unknown) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onSelect = props.onSelect ?? vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeGallery selected={props.selected} loading={props.loading ?? false} disabled={props.disabled ?? false} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return { ...view, onSelect };
}

describe('ThemeGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCatalog.mockResolvedValue({ schemaVersion: 2, registryHash: 'hash', builtins: [], customThemes: [] });
    mocks.updatePreferences.mockResolvedValue({ preferences: { schemaVersion: 2, mode: 'dark', selection: { kind: 'builtin', themeId: 'rad' } }, etag: '"theme-preferences-2"' });
    mocks.create.mockResolvedValue({ themeId: 'custom-1', etag: '"theme-custom-1-1"' });
  });

  it('reports a built-in pick to the parent and does not save it', async () => {
    const { onSelect } = renderGallery({ selected: { kind: 'builtin', themeId: 'classic' } });
    fireEvent.click(await screen.findByRole('radio', { name: /^RAD/ }));
    expect(onSelect).toHaveBeenCalledWith({ selection: { kind: 'builtin', themeId: 'rad' }, resolvedTheme: null });
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it('marks the staged selection as active rather than the saved one', async () => {
    renderGallery({ selected: { kind: 'builtin', themeId: 'rad' } });
    expect(await screen.findByRole('radio', { name: /^RAD/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /^Classic/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('disables the cards while the parent is saving', async () => {
    renderGallery({ selected: { kind: 'builtin', themeId: 'classic' }, disabled: true });
    expect(await screen.findByRole('radio', { name: /^RAD/ })).toBeDisabled();
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
