import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dashboardMocks = vi.hoisted(() => ({
  slug: 'battery',
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
    useResolvedVehicleSelection: () => ({
      authReady: true,
      effectiveVehicleId: 'vehicle-1',
      vehicleSelectionReady: true,
      vehicles: [{ id: 'vehicle-1', display_name: 'Truck', model: 'R1T' }],
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
  DashboardRenderer: () => <div data-testid="dashboard-renderer" />,
  getDefaultBySlug: () => ({
    schemaVersion: 2,
    id: 'dashboard-default',
    slug: dashboardMocks.slug,
    name: 'Dashboard',
    isDefault: false,
    isLocked: false,
    ownerId: null,
    controls: { dateRange: true },
    widgets: [],
  }),
  useDashboardBySlug: () => ({ data: undefined, isLoading: false }),
  useDashboardById: () => ({ data: undefined, isLoading: false, isError: false }),
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
    timeframe,
    onChange,
  }: {
    timeframe?: { kind: string; preset?: string };
    onChange: (timeframe: unknown) => void;
  }) => (
    <div>
      <span data-testid="preset-value">{timeframe?.kind === 'preset' ? timeframe.preset : timeframe?.kind ?? 'custom'}</span>
      <button
        type="button"
        onClick={() => onChange({ kind: 'preset', preset: '1y' })}
      >
        Select last year
      </button>
    </div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/layout/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/layout/NoVehicleState', () => ({
  NoVehicleState: () => null,
}));

import { DashboardPageShell } from '../components/dashboard/DashboardPageShell';

describe('DashboardPageShell timeframe persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
    dashboardMocks.slug = 'battery';
  });

  it('restores the previously selected timeframe when a new dashboard mounts', async () => {
    const user = userEvent.setup();

    const { unmount } = render(
      <DashboardPageShell navKey="battery" slug="battery" title="Battery" />,
    );

    expect(screen.getByTestId('preset-value')).toHaveTextContent('30d');

    await user.click(screen.getByRole('button', { name: 'Select last year' }));

    expect(JSON.parse(sessionStorage.getItem('rm-dashboard-timeframe') ?? '{}')).toEqual({ kind: 'preset', preset: '1y' });

    unmount();
    dashboardMocks.slug = 'charging';

    render(
      <DashboardPageShell navKey="charging" slug="charging" title="Charging" />,
    );

    expect(screen.getByTestId('preset-value')).toHaveTextContent('1y');
  });
});
