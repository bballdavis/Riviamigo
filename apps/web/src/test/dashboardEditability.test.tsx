import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardConfig } from '@riviamigo/dashboards';

const dashboardMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  routeSlug: 'custom-dashboard',
  routeSearch: {} as { edit?: string },
  updateDashboard: vi.fn(),
  createDashboard: vi.fn(),
  updateAdminDashboard: vi.fn(),
  cloneDashboard: vi.fn(),
}));

const dashboardConfigs = vi.hoisted(() => {
  function makeConfig(slug: string, widgetId: string): DashboardConfig {
    return {
      schemaVersion: 2,
      id: `${slug}-default`,
      slug,
      name: slug,
      isDefault: true,
      isLocked: true,
      ownerId: null,
      controls: { dateRange: true },
      widgets: [
        {
          id: widgetId,
          componentType: 'sensor',
          definitionId: 'total_miles',
          title: `${slug} miles`,
          layout: { x: 0, y: 0, w: 3, h: 2 },
          options: {},
        },
      ],
    };
  }

  return {
    dashboard: makeConfig('dashboard', 'dashboard-widget'),
    battery: makeConfig('battery', 'battery-widget'),
    charging: makeConfig('charging', 'charging-widget'),
    efficiency: makeConfig('efficiency', 'efficiency-widget'),
    trips: makeConfig('trips', 'trips-widget'),
    'custom-dashboard': makeConfig('custom-dashboard', 'custom-widget'),
  };
});

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => dashboardMocks.navigate,
    useParams: () => ({ slug: dashboardMocks.routeSlug }),
    useSearch: () => dashboardMocks.routeSearch,
  };
});

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

vi.mock('@riviamigo/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riviamigo/hooks')>();
  return {
    ...actual,
    useAuth: () => ({
      defaultVehicleId: 'vehicle-1',
      activeVehicleId: null,
      setActiveVehicleId: vi.fn(),
    }),
    useVehicles: () => ({
      data: [{ id: 'vehicle-1', display_name: 'Demo R1T', model: 'R1T' }],
    }),
    useMe: () => ({ data: { role: 'user' } }),
    useMetricCatalog: () => ({ data: [] }),
    useCurrentVehicleStatus: () => ({ data: null }),
  };
});

vi.mock('../../../../packages/dashboards/src/WidgetHost', () => ({
  WidgetHost: ({ instance }: { instance: { id: string; title?: string; definitionId: string } }) => (
    <div data-testid={`widget-host-${instance.id}`}>{instance.title ?? instance.definitionId}</div>
  ),
}));

vi.mock('@riviamigo/dashboards', async () => {
  const actual = await vi.importActual<typeof import('@riviamigo/dashboards')>('@riviamigo/dashboards');
  return {
    ...actual,
    getDefaultBySlug: (slug: keyof typeof dashboardConfigs) => dashboardConfigs[slug],
    useDashboardBySlug: (slug: keyof typeof dashboardConfigs) => ({
      data: dashboardConfigs[slug],
      isLoading: false,
    }),
    useUpdateDashboard: () => ({ mutateAsync: dashboardMocks.updateDashboard, isPending: false }),
    useCreateDashboard: () => ({ mutateAsync: dashboardMocks.createDashboard, isPending: false }),
    useUpdateAdminDashboard: () => ({ mutateAsync: dashboardMocks.updateAdminDashboard, isPending: false }),
    useCloneDashboard: () => ({ mutateAsync: dashboardMocks.cloneDashboard, isPending: false }),
  };
});

vi.mock('../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/layout/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/layout/NoVehicleState', () => ({
  NoVehicleState: () => null,
}));

vi.mock('@riviamigo/ui/primitives', () => ({
  PageLayout: ({
    title,
    titleAction,
    actions,
    children,
  }: {
    title: string;
    titleAction?: React.ReactNode;
    actions?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {titleAction}
      {actions}
      {children}
    </div>
  ),
  DateRangePicker: () => <div data-testid="date-range-picker" />,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { DashboardPageShell } from '../components/dashboard/DashboardPageShell';
import { userDashboardRoute } from '../routes/d.$slug';

const RouteComponent = userDashboardRoute.options.component as React.ComponentType;

async function expectEditableDashboard(widgetId: string) {
  expect(screen.queryByTestId(`widget-overlay-right-${widgetId}`)).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Edit dashboard' }));

  const editButton = await screen.findByRole('button', { name: 'Edit widget settings' });
  const host = screen.getByTestId(`widget-host-${widgetId}`);
  const gridItem = host.closest('.react-grid-item');

  expect(host.closest('[data-widget-frame="edit"]')).toHaveAttribute('data-widget-id', widgetId);
  expect(gridItem?.querySelector('.react-resizable-handle')).not.toBeNull();

  fireEvent.click(editButton);

  expect(await screen.findByText('Editing')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove component' })).toBeInTheDocument();
}

describe('dashboard editability', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    dashboardMocks.navigate.mockReset();
    dashboardMocks.updateDashboard.mockResolvedValue(dashboardConfigs.battery);
    dashboardMocks.createDashboard.mockResolvedValue(dashboardConfigs.battery);
    dashboardMocks.updateAdminDashboard.mockResolvedValue(dashboardConfigs.battery);
    dashboardMocks.cloneDashboard.mockResolvedValue(dashboardConfigs['custom-dashboard']);
    dashboardMocks.routeSlug = 'custom-dashboard';
    dashboardMocks.routeSearch = {};
  });

  it.each([
    ['dashboard', 'dashboard-widget'],
    ['battery', 'battery-widget'],
    ['charging', 'charging-widget'],
    ['efficiency', 'efficiency-widget'],
    ['trips', 'trips-widget'],
  ] as const)('opens widget editing from the shared shell for %s', async (slug, widgetId) => {
    render(<DashboardPageShell navKey={slug} slug={slug} title={slug} />);

    await expectEditableDashboard(widgetId);
  });

  it('opens the same edit overlay path for /d/$slug custom dashboards', async () => {
    dashboardMocks.routeSearch = { edit: '1' };

    render(<RouteComponent />);

    const editButton = await screen.findByRole('button', { name: 'Edit widget settings' });
    expect(screen.getByTestId('widget-host-custom-widget').closest('[data-widget-frame="edit"]')).toHaveAttribute(
      'data-widget-id',
      'custom-widget',
    );

    fireEvent.click(editButton);

    expect(await screen.findByText('Editing')).toBeInTheDocument();
  });

  it('routes the /d/$slug toolbar edit action through the URL-controlled edit mode', async () => {
    render(<RouteComponent />);

    await userEvent.click(screen.getByRole('button', { name: 'Edit dashboard' }));

    expect(dashboardMocks.navigate).toHaveBeenCalledWith({
      to: '/d/$slug',
      params: { slug: 'custom-dashboard' },
      search: { edit: '1' },
    });
  });

  it('keeps dashboard utilities separate from the shared edit action', () => {
    render(<RouteComponent />);

    expect(screen.getByRole('button', { name: 'Edit dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull();
  });
});
