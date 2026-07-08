import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: () => ({ data: undefined }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

vi.mock('@riviamigo/ui/tables', () => ({
  tripColumns: [],
  DataTable: ({ data, emptyTitle, onRowClick }: { data: Array<{ id: string; name?: string }>; emptyTitle?: string; onRowClick?: (row: unknown) => void }) => (
    <div data-testid="trips-table">
      {data.length === 0 ? (
        <span>{emptyTitle}</span>
      ) : (
        data.map((row) => (
          <button key={row.id} onClick={() => onRowClick?.({ original: row })}>
            Open {row.id}
          </button>
        ))
      )}
    </div>
  ),
}));

vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ defaultVehicleId: 'vehicle-1' }),
  useMe: () => ({ data: { role: 'user' } }),
  useTrips: () => ({
    data: {
      items: [
        {
          id: 'trip-1',
          started_at: '2024-01-01T12:00:00Z',
          ended_at: '2024-01-01T13:00:00Z',
          distance_mi: 18.3,
          energy_used_kwh: 6.5,
          efficiency_wh_mi: 355,
        },
      ],
      total: 26,
      page: 1,
      per_page: 25,
    },
    isLoading: false,
  }),
  useCurrentVehicleStatus: () => ({ data: null }),
  useVehicles: () => ({ data: [{ id: 'vehicle-1', display_name: 'Forest R1S' }] }),
}));

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
  useDashboardBySlug: () => ({ data: { schemaVersion: 1, slug: 'trips', name: 'Trips', controls: { dateRange: true }, widgets: [] }, isLoading: false }),
  useUpdateDashboard: () => ({ mutateAsync: vi.fn() }),
  useUpdateAdminDashboard: () => ({ mutateAsync: vi.fn() }),
  useCreateDashboard: () => ({ mutateAsync: vi.fn() }),
  useCloneDashboard: () => ({ mutateAsync: vi.fn() }),
  getDefaultBySlug: () => ({ schemaVersion: 1, slug: 'trips', name: 'Trips', controls: { dateRange: true }, widgets: [] }),
  downloadDashboardYaml: vi.fn(),
  importDashboardYaml: vi.fn(),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../lib/dates', () => ({
  DEFAULT_TIMEFRAME: { kind: 'preset', preset: '30d' },
  presetToRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  rangeToIso: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  getTimeframeRange: () => ({ from: new Date('2024-01-01'), to: new Date('2024-01-31') }),
  timeframeToQuery: () => ({ from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' }),
  loadDashboardTimeframe: () => null,
  saveDashboardTimeframe: vi.fn(),
  DEFAULT_PRESET: '30d',
}));

import { TripsContent } from '../trips';

describe('Trips page', () => {
  it('renders the trips dashboard shell', () => {
    render(<TripsContent />);

    expect(screen.getByText('Trips')).toBeInTheDocument();
    expect(screen.getByTestId('date-range-picker')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-renderer')).toBeInTheDocument();
  });

  it('renders the trips dashboard renderer', () => {
    render(<TripsContent />);
    // Trips table is a widget rendered via DashboardRenderer, not a direct child
    expect(screen.getByTestId('dashboard-renderer')).toBeInTheDocument();
  });

  it('renders the date range picker', () => {
    render(<TripsContent />);
    expect(screen.getByTestId('date-range-picker')).toBeInTheDocument();
  });
});
