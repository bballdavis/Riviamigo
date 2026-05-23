import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'v1', accessToken: 'tok' }),
  useCurrentVehicleStatus: () => ({ data: null }),
  useVehicles: () => ({ data: [{ id: 'v1', display_name: 'Forest R1S' }] }),
  useEfficiencyTrend: () => ({ data: [], isFetching: false }),
  useEfficiencyVsTemp: () => ({ data: [], isFetching: false }),
  useTrips: () => ({ data: { items: [], total: 0, page: 1, per_page: 200 }, isFetching: false }),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/NoVehicleState', () => ({ NoVehicleState: () => <div>connect vehicle</div> }));
vi.mock('../../lib/dates', () => ({
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso:    () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  DEFAULT_PRESET: '30d',
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
  DashboardRenderer: () => <div data-testid="dashboard-renderer" />,
  useDashboardBySlug: () => ({ data: mockConfig, isLoading: false }),
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
});
