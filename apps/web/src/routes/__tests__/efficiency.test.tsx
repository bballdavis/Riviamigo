import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'v1', accessToken: 'tok' }),
  useMe: () => ({ data: { role: 'user' } }),
  useCurrentVehicleStatus: () => ({ data: null }),
  useVehicles: () => ({ data: [{ id: 'v1', display_name: 'Forest R1S' }] }),
  useResolvedVehicleSelection: () => ({
    authReady: true,
    effectiveVehicleId: 'v1',
    vehicleSelectionReady: true,
    vehicles: [
      { id: 'v1', display_name: 'Forest R1S' },
      { id: 'v2', display_name: 'Summit R1T' },
    ],
  }),
  useEfficiencyTrend: () => ({ data: [], isFetching: false }),
  useEfficiencyVsTemp: () => ({ data: [], isFetching: false }),
  useTrips: () => ({ data: { items: [], total: 0, page: 1, per_page: 200 }, isFetching: false }),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/NoVehicleState', () => ({ NoVehicleState: () => <div>connect vehicle</div> }));
vi.mock('../../lib/dates', () => ({
  DEFAULT_TIMEFRAME: { kind: 'preset', preset: '30d' },
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso:    () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  getTimeframeRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  timeframeToQuery: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
  loadDashboardTimeframe: () => undefined,
  saveDashboardTimeframe: vi.fn(),
}));

const mockConfig = {
  schemaVersion: 1,
  id: '00000000-0000-0000-0000-000000000003',
  slug: 'efficiency',
  name: 'Efficiency',
  isDefault: true,
  isLocked: true,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [],
};

vi.mock('@riviamigo/dashboards', () => ({
  TripTagPicker: ({ label, mode, canManage, inlineClassName }: { label?: string; mode?: string; canManage?: boolean; inlineClassName?: string }) => (
    <div data-testid="efficiency-tag-picker" data-mode={mode} data-can-manage={canManage} data-inline-class-name={inlineClassName}>
      <input aria-label={label} />
    </div>
  ),
  dashboardKey: (config: { id?: string; slug?: string } | undefined, fallbackSlug: string) =>
    config ? `${config.id}:${config.slug}` : `pending:${fallbackSlug}`,
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
  DashboardRenderer: () => <div data-testid="dashboard-renderer" />,
  useDashboardBySlug: () => ({ data: mockConfig, isLoading: false }),
  useDashboardById: () => ({ data: undefined, isLoading: false }),
  useUpdateDashboard: () => ({ mutateAsync: vi.fn() }),
  useCreateDashboard: () => ({ mutateAsync: vi.fn() }),
  useCloneDashboard: () => ({ mutateAsync: vi.fn() }),
  useUpdateAdminDashboard: () => ({ mutateAsync: vi.fn() }),
  getDefaultBySlug: () => mockConfig,
  downloadDashboardYaml: vi.fn(),
  importDashboardYaml: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: () => ({ data: undefined }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

import { EfficiencyDashboardPage } from '../../components/dashboard/EfficiencyDashboardPage';

describe('Efficiency dashboard page', () => {
  it('renders the page title', () => {
    render(<EfficiencyDashboardPage navKey="efficiency" slug="efficiency" title="Efficiency" />);
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
  });

  it('renders the modular dashboard renderer in view mode', () => {
    render(<EfficiencyDashboardPage navKey="efficiency" slug="efficiency" title="Efficiency" />);
    expect(screen.getByTestId('dashboard-renderer')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search charts')).not.toBeInTheDocument();
  });

  it('keeps tag filters collapsed by default and places the icon control before vehicle selection', () => {
    const filter = {
      tagIds: [],
      tagMatch: 'all' as const,
      untagged: false,
      setFilter: vi.fn(),
    };

    render(
      <EfficiencyDashboardPage
        navKey="efficiency"
        slug="efficiency"
        title="Efficiency"
        widgetCtx={{ tripTagFilter: filter, canManageTripTags: true }}
      />,
    );

    const filterButton = screen.getByRole('button', { name: 'Show efficiency filters' });
    const vehiclePicker = screen.getByLabelText('Select vehicle');
    expect(filterButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Efficiency tag filters')).not.toBeInTheDocument();
    expect(filterButton.compareDocumentPosition(vehiclePicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(filterButton);
    expect(screen.getByRole('button', { name: 'Hide efficiency filters' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Efficiency tag filters')).toHaveClass('bg-bg-elevated/40');
    expect(screen.getByLabelText('Efficiency tag filters')).not.toHaveClass('focus-within:border-accent', 'focus-within:ring-1');
    expect(screen.getByTestId('efficiency-tag-picker')).toHaveAttribute('data-mode', 'inline');
    expect(screen.getByTestId('efficiency-tag-picker')).toHaveAttribute('data-can-manage', 'false');
    expect(screen.getByTestId('efficiency-tag-picker')).toHaveAttribute('data-inline-class-name', expect.stringContaining('border-2'));
    expect(screen.getByTestId('efficiency-tag-picker')).toHaveAttribute('data-inline-class-name', expect.stringContaining('focus-within:ring-0'));
    expect(screen.getByRole('textbox', { name: 'Filter efficiency by tags' })).toBeInTheDocument();
  });

  it('opens the tag section when the URL-backed filter is already active', () => {
    const filter = {
      tagIds: ['tag-road-trip'],
      tagMatch: 'all' as const,
      untagged: false,
      setFilter: vi.fn(),
    };

    render(
      <EfficiencyDashboardPage
        navKey="efficiency"
        slug="efficiency"
        title="Efficiency"
        widgetCtx={{ tripTagFilter: filter, canManageTripTags: true }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Hide efficiency filters' })).toBeInTheDocument();
    expect(screen.getByLabelText('Efficiency tag filters')).toBeInTheDocument();
  });
});
