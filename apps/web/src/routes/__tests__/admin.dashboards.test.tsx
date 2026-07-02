import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const adminRouteMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  apiFetch: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => adminRouteMocks.navigate };
});

vi.mock('@riviamigo/hooks', () => ({
  api: {
    apiFetch: adminRouteMocks.apiFetch,
  },
}));

vi.mock('@riviamigo/dashboards', () => ({
  useDashboards: () => ({
    data: [
      {
        id: 'default-1',
        slug: 'dashboard',
        name: 'Overview',
        isDefault: true,
        isLocked: false,
        ownerId: null,
        widgets: [],
      },
    ],
    isLoading: false,
  }),
}));

vi.mock('../../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../components/layout/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { adminDashboardsRoute } from '../admin.dashboards';

const AdminDashboardsPage = adminDashboardsRoute.options.component as React.ComponentType;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(adminRouteMocks.invalidateQueries as typeof queryClient.invalidateQueries);

  return render(
    <QueryClientProvider client={queryClient}>
      <AdminDashboardsPage />
    </QueryClientProvider>,
  );
}

describe('Admin dashboards route', () => {
  beforeEach(() => {
    adminRouteMocks.navigate.mockReset();
    adminRouteMocks.apiFetch.mockReset();
    adminRouteMocks.invalidateQueries.mockReset();
    adminRouteMocks.apiFetch.mockResolvedValue({ ok: true });
  });

  it('routes dashboard lock changes through the shared API client', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTitle('Lock'));

    expect(adminRouteMocks.apiFetch).toHaveBeenCalledWith('POST', '/v1/admin/dashboards/default-1/lock', { locked: true });
    expect(adminRouteMocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboards'] });
  });
});
