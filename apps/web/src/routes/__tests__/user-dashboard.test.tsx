import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeState = vi.hoisted(() => ({
  slug: 'custom-dashboard',
  search: {} as { edit?: 1 },
  navigate: vi.fn(),
}));

const shellState = vi.hoisted(() => ({
  props: null as null | {
    slug: string;
    isEditMode?: boolean;
    onEditModeChange?: (next: boolean) => void;
  },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useParams: () => ({ slug: routeState.slug }),
    useSearch: () => routeState.search,
    useNavigate: () => routeState.navigate,
  };
});

vi.mock('@riviamigo/hooks', () => ({
  useMe: () => ({ data: { role: 'user' } }),
}));

vi.mock('@riviamigo/dashboards', () => ({
  findOwnedDashboardBySlug: (dashboards: Array<{ slug: string; ownerId: string | null }> | undefined, slug: string) =>
    dashboards?.find((dashboard) => dashboard.slug === slug && dashboard.ownerId != null),
  isSystemDefaultDashboard: (config: { isDefault: boolean; ownerId: string | null }) =>
    config.isDefault && !config.ownerId,
  materializeSystemDashboardDraft: (draft: object, saved: object) => ({ ...draft, ...saved }),
  materializeUserDashboardDraft: (draft: object, owned?: object | null) => ({
    ...draft,
    ...(owned ?? {}),
    isDefault: false,
    isLocked: false,
  }),
  useCreateDashboard: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDashboard: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAdminDashboard: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCloneDashboard: () => ({ mutateAsync: vi.fn(), isPending: false }),
  downloadDashboardYaml: vi.fn(),
  importDashboardYaml: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({
      getQueryData: vi.fn(),
      refetchQueries: vi.fn(),
      invalidateQueries: vi.fn(),
    }),
  };
});

vi.mock('../../components/layout/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/dashboard/DashboardPageShell', () => ({
  DashboardPageShell: (props: {
    slug: string;
    isEditMode?: boolean;
    onEditModeChange?: (next: boolean) => void;
  }) => {
    shellState.props = props;
    return (
      <div
        data-testid="dashboard-shell"
        data-slug={props.slug}
        data-edit-mode={props.isEditMode ? 'true' : 'false'}
      >
        <button type="button" onClick={() => props.onEditModeChange?.(false)}>
          Leave edit
        </button>
        <button type="button" onClick={() => props.onEditModeChange?.(true)}>
          Enter edit
        </button>
      </div>
    );
  },
}));

import { userDashboardRoute } from '../d.$slug';

const RouteComponent = userDashboardRoute.options.component as React.ComponentType;

describe('user dashboard route', () => {
  beforeEach(() => {
    routeState.slug = 'custom-dashboard';
    routeState.search = {};
    routeState.navigate.mockReset();
    shellState.props = null;
  });

  it('passes URL edit state into the shared dashboard shell', () => {
    routeState.search = { edit: 1 };

    render(<RouteComponent />);

    expect(screen.getByTestId('dashboard-shell')).toHaveAttribute('data-slug', 'custom-dashboard');
    expect(screen.getByTestId('dashboard-shell')).toHaveAttribute('data-edit-mode', 'true');
  });

  it('updates the edit query through the shared shell callback', async () => {
    const user = userEvent.setup();
    routeState.search = { edit: 1 };

    render(<RouteComponent />);
    await user.click(screen.getByRole('button', { name: 'Leave edit' }));

    expect(routeState.navigate).toHaveBeenCalledWith({
      to: '/d/$slug',
      params: { slug: 'custom-dashboard' },
      search: {},
    });

    await user.click(screen.getByRole('button', { name: 'Enter edit' }));

    expect(routeState.navigate).toHaveBeenCalledWith({
      to: '/d/$slug',
      params: { slug: 'custom-dashboard' },
      search: { edit: 1 },
    });
  });
});
