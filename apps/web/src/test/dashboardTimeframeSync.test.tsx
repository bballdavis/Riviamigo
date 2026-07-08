import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dashboardConfigs = vi.hoisted(() => ({
  dashboard: {
    schemaVersion: 2,
    id: 'dashboard-default',
    slug: 'dashboard',
    name: 'Overview',
    isDefault: true,
    isLocked: true,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [
      { id: 'overview-vehicle', componentType: 'custom', definitionId: 'overview.vehicle', title: 'Vehicle overview', options: {}, layout: { x: 0, y: 0, w: 12, h: 7 } },
      { id: 'overview-sensor', componentType: 'sensor', definitionId: 'total_miles', title: 'Total miles', options: {}, layout: { x: 0, y: 7, w: 3, h: 2 } },
    ],
  },
  battery: {
    schemaVersion: 2,
    id: 'battery-default',
    slug: 'battery',
    name: 'Battery',
    isDefault: true,
    isLocked: true,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [
      { id: 'battery-chart', componentType: 'chart', definitionId: 'catalog', title: 'Battery chart', options: {}, layout: { x: 0, y: 0, w: 6, h: 4 } },
      { id: 'battery-table', componentType: 'custom', definitionId: 'battery.table', title: 'Battery table', options: {}, layout: { x: 6, y: 0, w: 6, h: 4 } },
    ],
  },
  charging: {
    schemaVersion: 2,
    id: 'charging-default',
    slug: 'charging',
    name: 'Charging',
    isDefault: true,
    isLocked: true,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [
      { id: 'charging-chart', componentType: 'chart', definitionId: 'catalog', title: 'Charging chart', options: {}, layout: { x: 0, y: 0, w: 6, h: 4 } },
      { id: 'charging-table', componentType: 'custom', definitionId: 'charging.sessions.table', title: 'Charging sessions', options: {}, layout: { x: 6, y: 0, w: 6, h: 4 } },
    ],
  },
  efficiency: {
    schemaVersion: 2,
    id: 'efficiency-default',
    slug: 'efficiency',
    name: 'Efficiency',
    isDefault: true,
    isLocked: true,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [
      { id: 'efficiency-chart', componentType: 'chart', definitionId: 'catalog', title: 'Efficiency chart', options: {}, layout: { x: 0, y: 0, w: 6, h: 4 } },
      { id: 'efficiency-sensor', componentType: 'sensor', definitionId: 'avg_efficiency', title: 'Avg efficiency', options: {}, layout: { x: 6, y: 0, w: 3, h: 2 } },
    ],
  },
  trips: {
    schemaVersion: 2,
    id: 'trips-default',
    slug: 'trips',
    name: 'Trips',
    isDefault: true,
    isLocked: true,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [
      { id: 'trips-chart', componentType: 'chart', definitionId: 'catalog', title: 'Trips chart', options: {}, layout: { x: 0, y: 0, w: 6, h: 4 } },
      { id: 'trips-table', componentType: 'custom', definitionId: 'trips.table', title: 'Trips table', options: {}, layout: { x: 6, y: 0, w: 6, h: 4 } },
      { id: 'trips-map', componentType: 'custom', definitionId: 'trips.map', title: 'Trips map', options: {}, layout: { x: 0, y: 4, w: 12, h: 5 } },
    ],
  },
}));

const dashboardQuery = vi.hoisted(() => ({
  data: undefined as unknown,
  isLoading: false,
  isFetching: false,
}));

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
      data: [{ id: 'vehicle-1', display_name: 'Truck', model: 'R1T' }],
    }),
    useMe: () => ({ data: { role: 'user' } }),
  };
});

vi.mock('@riviamigo/dashboards', () => ({
  dashboardKey: (config: { id?: string; slug?: string } | undefined, fallbackSlug: string) =>
    config ? `${config.id}:${config.slug}` : `pending:${fallbackSlug}`,
  findOwnedDashboardBySlug: () => undefined,
  isSystemDefaultDashboard: (config: { isDefault: boolean; ownerId: string | null }) =>
    config.isDefault && !config.ownerId,
  materializeSystemDashboardDraft: (draft: object, saved: object) => ({ ...draft, ...saved }),
  materializeUserDashboardDraft: (draft: object, owned?: object | null) => ({
    ...draft,
    ...(owned ?? {}),
    isDefault: false,
    isLocked: false,
  }),
  DashboardRenderer: ({
    config,
    ctx,
    mode,
  }: {
    config: { widgets: Array<{ id: string; title?: string; definitionId: string }> };
    ctx: { timeframe?: { kind: string }; from: string | null; to: string | null };
    mode?: 'view' | 'edit';
  }) => (
    <div data-testid="dashboard-renderer" data-mode={mode ?? 'view'}>
      {config.widgets.map((widget) => (
        <div
          key={widget.id}
          data-testid={`widget-${widget.id}`}
          data-timeframe-kind={ctx.timeframe?.kind ?? 'missing'}
          data-from={ctx.from ?? ''}
          data-to={ctx.to ?? ''}
        >
          {widget.title ?? widget.definitionId}
        </div>
      ))}
    </div>
  ),
  getDefaultBySlug: (slug: keyof typeof dashboardConfigs) => dashboardConfigs[slug],
  useDashboardBySlug: () => ({
    data: dashboardQuery.data,
    isLoading: dashboardQuery.isLoading,
    isFetching: dashboardQuery.isFetching,
  }),
  useUpdateDashboard: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateDashboard: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAdminDashboard: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: vi.fn(),
    refetchQueries: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@riviamigo/ui/primitives', () => ({
  PageLayout: ({
    title,
    actions,
    children,
  }: {
    title: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {actions}
      {children}
    </div>
  ),
  DateRangePicker: ({
    onChange,
  }: {
    onChange: (timeframe: unknown) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onChange({ kind: 'custom', from: new Date('2025-01-07T18:30:00Z'), to: new Date('2025-01-09T06:15:00Z') })}>
        Set custom timeframe
      </button>
      <button type="button" onClick={() => onChange({ kind: 'lifetime' })}>
        Set lifetime timeframe
      </button>
    </div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/layout/NoVehicleState', () => ({
  NoVehicleState: () => null,
}));

import { DashboardPageShell } from '../components/dashboard/DashboardPageShell';

describe('DashboardPageShell timeframe sync', () => {
  beforeEach(() => {
    sessionStorage.clear();
    dashboardQuery.data = undefined;
    dashboardQuery.isLoading = false;
    dashboardQuery.isFetching = false;
  });

  it.each([
    ['trips', ['Trips chart', 'Trips table', 'Trips map']],
    ['charging', ['Charging chart', 'Charging sessions']],
    ['efficiency', ['Efficiency chart', 'Avg efficiency']],
    ['battery', ['Battery chart', 'Battery table']],
  ] as const)('updates all visible %s widgets to the same custom timeframe', async (slug, titles) => {
    const user = userEvent.setup();

    render(<DashboardPageShell navKey={slug} slug={slug} title={slug} />);

    await user.click(screen.getByRole('button', { name: 'Set custom timeframe' }));

    const renderer = screen.getByTestId('dashboard-renderer');
    const firstWidget = within(renderer).getByText(titles[0]!);
    const expectedFrom = firstWidget.getAttribute('data-from');
    const expectedTo = firstWidget.getAttribute('data-to');
    expect(expectedFrom).toContain('2025-01-07');
    expect(expectedTo).toContain('2025-01-09');
    for (const title of titles) {
      const widget = within(renderer).getByText(title);
      expect(widget).toHaveAttribute('data-timeframe-kind', 'custom');
      expect(widget.getAttribute('data-from')).toBe(expectedFrom);
      expect(widget.getAttribute('data-to')).toBe(expectedTo);
    }
  });

  it('switches battery range-aware content to lifetime bounds together', async () => {
    const user = userEvent.setup();

    render(<DashboardPageShell navKey="battery" slug="battery" title="Battery" />);

    await user.click(screen.getByRole('button', { name: 'Set lifetime timeframe' }));

    const renderer = screen.getByTestId('dashboard-renderer');
    for (const title of ['Battery chart', 'Battery table']) {
      const widget = within(renderer).getByText(title);
      expect(widget).toHaveAttribute('data-timeframe-kind', 'lifetime');
      expect(widget).toHaveAttribute('data-from', '');
      expect(widget).toHaveAttribute('data-to', '');
    }
  });

  it.each(['dashboard', 'battery', 'charging', 'efficiency', 'trips'] as const)(
    'passes edit mode through the shared renderer for %s',
    (slug) => {
      render(<DashboardPageShell navKey={slug} slug={slug} title={slug} isEditMode />);

      expect(screen.getByTestId('dashboard-renderer')).toHaveAttribute('data-mode', 'edit');
    },
  );

  it('keeps edit drafts scoped when switching dashboard slugs', () => {
    const { rerender } = render(
      <DashboardPageShell navKey="battery" slug="battery" title="Battery" isEditMode />,
    );

    expect(screen.getByTestId('dashboard-renderer')).toHaveAttribute('data-mode', 'edit');
    expect(screen.getByText('Battery chart')).toBeInTheDocument();

    rerender(
      <DashboardPageShell navKey="charging" slug="charging" title="Charging" isEditMode />,
    );

    expect(screen.getByTestId('dashboard-renderer')).toHaveAttribute('data-mode', 'edit');
    expect(screen.queryByText('Battery chart')).not.toBeInTheDocument();
    expect(screen.getByText('Charging chart')).toBeInTheDocument();
  });

  it('ignores stale by-slug placeholder data from a different dashboard slug', () => {
    dashboardQuery.data = dashboardConfigs.battery;
    dashboardQuery.isFetching = true;

    render(<DashboardPageShell navKey="charging" slug="charging" title="Charging" />);

    expect(screen.queryByText('Battery chart')).not.toBeInTheDocument();
    expect(screen.getByText('Charging chart')).toBeInTheDocument();
  });
});
