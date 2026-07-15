/**
 * Smoke test — verifies the DashboardPage renders without crashing.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', () => ({
  PageLayout: ({ children, title, actions }: { children: React.ReactNode; title: string; actions?: React.ReactNode }) => (
    <div data-testid="page-layout"><h1>{title}</h1>{actions}{children}</div>
  ),
  DateRangePicker: () => <div />,
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'v1', accessToken: 'tok' }),
  useMe: () => ({ data: { role: 'user' } }),
  useCurrentVehicleStatus: () => ({ data: null }),
  useVehicles: () => ({ data: [{ id: 'v1', display_name: 'Forest R1S' }] }),
  useResolvedVehicleSelection: () => ({
    authReady: true,
    effectiveVehicleId: 'v1',
    vehicleSelectionReady: true,
    vehicles: [{ id: 'v1', display_name: 'Forest R1S' }],
  }),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/NoVehicleState', () => ({ NoVehicleState: () => <div>no vehicle</div> }));

vi.mock('../../lib/dates', () => ({
  DEFAULT_TIMEFRAME: { kind: 'preset', preset: '30d' },
  presetToRange: () => ({ from: new Date(), to: new Date() }),
  rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  getTimeframeRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  timeframeToQuery: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  loadDashboardTimeframe: () => undefined,
  saveDashboardTimeframe: vi.fn(),
  DEFAULT_PRESET: '30d',
}));

const mockConfig = {
  schemaVersion: 1,
  id: '00000000-0000-0000-0000-000000000002',
  slug: 'battery',
  name: 'Battery',
  isDefault: true,
  isLocked: true,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [],
};

vi.mock('@riviamigo/dashboards', () => ({
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

import { DashboardPage } from '../../components/dashboard/DashboardPage';

it('DashboardPage renders without crashing', () => {
  render(<DashboardPage navKey="battery" slug="battery" title="Battery" />);
  expect(screen.getByTestId('dashboard-renderer')).toBeInTheDocument();
  expect(screen.getByTestId('page-layout')).toBeInTheDocument();
});
