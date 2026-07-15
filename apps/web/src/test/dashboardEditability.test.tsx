import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardConfig } from '@riviamigo/dashboards';

const dashboardMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  routeSlug: 'custom-dashboard',
  routeSearch: {} as { edit?: 1; dashboardId?: string },
  updateDashboard: vi.fn(),
  createDashboard: vi.fn(),
  updateAdminDashboard: vi.fn(),
  cloneDashboard: vi.fn(),
}));

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
  const connectedStatus = {
    charger_state: 'Connected',
    charger_status: 'chrgr_sts_connected_no_chrg',
    power_state: 'standby',
  };
  const emptyMetricBatch = { values: [], series: [] };
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
    useResolvedVehicleSelection: () => ({
      authReady: true,
      effectiveVehicleId: 'vehicle-1',
      vehicleSelectionReady: true,
      vehicles: [{ id: 'vehicle-1', display_name: 'Demo R1T', model: 'R1T' }],
    }),
    useMe: () => ({ data: { role: 'user' } }),
    useMetricCatalog: () => ({ data: [] }),
    useMetricBatch: () => ({ data: emptyMetricBatch, isFetching: false }),
    useCurrentVehicleStatus: () => ({
      data: connectedStatus,
      isFetching: false,
    }),
    useBatteryHealth: () => ({ data: null, isFetching: false }),
    useChargingSummary: () => ({ data: null, isFetching: false }),
    useEfficiencySummary: () => ({ data: null, isFetching: false }),
  };
});

vi.mock('../../../../packages/dashboards/src/WidgetHost', () => ({
  WidgetHost: ({ instance }: { instance: { id: string; title?: string; definitionId: string } }) => (
    <div data-testid={`widget-host-${instance.id}`}>{instance.title ?? instance.definitionId}</div>
  ),
}));

vi.mock('@riviamigo/dashboards', async () => {
  const actual = await vi.importActual<typeof import('@riviamigo/dashboards')>('@riviamigo/dashboards');
  const overview = actual.getDefaultBySlug('dashboard');
  const customDashboard: DashboardConfig = {
    ...overview!,
    id: 'custom-dashboard-id',
    slug: 'custom-dashboard',
    name: 'Custom Dashboard',
    isDefault: false,
    isLocked: false,
    ownerId: 'user-1',
    widgets: [
      {
        id: 'custom-widget',
        componentType: 'sensor',
        definitionId: 'total_miles',
        title: 'Custom miles',
        layout: { x: 0, y: 0, w: 3, h: 2 },
        options: {},
      },
    ],
  };

  function configForSlug(slug: string) {
    return slug === 'custom-dashboard' ? customDashboard : actual.getDefaultBySlug(slug);
  }

  return {
    ...actual,
    getDefaultBySlug: configForSlug,
    useDashboardBySlug: (slug: string) => ({
      data: configForSlug(slug),
      isLoading: false,
    }),
    useDashboardById: (id: string | null) => ({
      data: id ? customDashboard : undefined,
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
  SelectPicker: ({ value, options, onChange, ...props }: {
    value: string;
    options: Array<{ value: string; label: React.ReactNode }>;
    onChange: (value: string) => void;
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)} {...props}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { DashboardPageShell } from '../components/dashboard/DashboardPageShell';
import { userDashboardRoute } from '../routes/d.$slug';

const RouteComponent = userDashboardRoute.options.component as React.ComponentType;

async function expectEditableDashboard(widgetId: string, widgetCount: number) {
  expect(screen.queryByTestId(`widget-overlay-right-${widgetId}`)).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Edit dashboard' }));

  const editOverlay = await screen.findByTestId(`widget-overlay-right-${widgetId}`);
  const editButton = within(editOverlay).getByRole('button', { name: 'Edit widget settings' });
  const host = screen.getByTestId(`widget-host-${widgetId}`);
  const gridItem = host.closest('.react-grid-item');
  const editFrames = document.querySelectorAll('[data-widget-frame="edit"]');

  expect(editFrames).toHaveLength(widgetCount);
  expect(screen.getAllByRole('button', { name: 'Edit widget settings' })).toHaveLength(widgetCount);
  expect(host.closest('[data-widget-frame="edit"]')).toHaveAttribute('data-widget-id', widgetId);
  expect(host.closest('[data-widget-frame="edit"]')).toHaveAttribute('data-widget-resizable', 'true');
  expect(editOverlay).toHaveAttribute('data-widget-edit-control', 'true');
  expect(gridItem?.querySelector('.react-resizable-handle')).not.toBeNull();

  await userEvent.click(editButton);

  expect(await screen.findByText('Editing')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove component' })).toBeInTheDocument();
}

describe('dashboard editability', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    dashboardMocks.navigate.mockReset();
    dashboardMocks.updateDashboard.mockResolvedValue({});
    dashboardMocks.createDashboard.mockResolvedValue({});
    dashboardMocks.updateAdminDashboard.mockResolvedValue({});
    dashboardMocks.cloneDashboard.mockResolvedValue({ slug: 'custom-dashboard' });
    dashboardMocks.routeSlug = 'custom-dashboard';
    dashboardMocks.routeSearch = {};
  });

  it.each([
    ['dashboard', 'd1000001-0000-0000-0000-000000000002', 6],
    ['battery', 'd2000002-0000-0000-0000-000000000001', 9],
    ['charging', 'd4000004-0000-0000-0000-000000000001', 9],
    ['efficiency', 'd3000003-0000-0000-0000-000000000001', 5],
    ['trips', 'd5000005-0000-0000-0000-000000000005', 6],
  ] as const)('opens widget editing from the shared shell for %s', async (slug, widgetId, widgetCount) => {
    render(<DashboardPageShell navKey={slug} slug={slug} title={slug} />);

    await expectEditableDashboard(widgetId, widgetCount);
  });

  it('opens the same edit overlay path for /d/$slug custom dashboards', async () => {
    dashboardMocks.routeSearch = { edit: 1 };

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
      search: { edit: 1 },
    });
  });

  it('keeps dashboard utilities separate from the shared edit action', () => {
    render(<RouteComponent />);

    expect(screen.getByRole('button', { name: 'Edit dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull();
  });
});
