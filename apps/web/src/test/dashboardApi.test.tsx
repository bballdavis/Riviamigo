import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@riviamigo/hooks';
import {
  normalizeDashboardConfig,
  useDashboardById,
  useDashboardBySlug,
  useDashboards,
  useRestoreAdminDashboardDefault,
  useUpdateDashboard,
} from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';

const dashboardConfig: DashboardConfig = {
  schemaVersion: 2,
  id: '00000000-0000-0000-0000-000000000002',
  slug: 'battery',
  name: 'Battery',
  isDefault: true,
  isLocked: true,
  ownerId: null,
  controls: { dateRange: true },
  widgets: [
    {
      id: 'd2000002-0000-0000-0000-000000000001',
      componentType: 'sensor',
      definitionId: 'battery_level',
      layout: { x: 0, y: 0, w: 3, h: 2 },
    },
  ],
};

const overviewDashboardConfig: DashboardConfig = {
  ...dashboardConfig,
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'dashboard',
  name: 'Overview',
  widgets: [
    {
      id: 'd1000001-0000-0000-0000-000000000006',
      componentType: 'chart',
      definitionId: 'catalog',
      managed: true,
      managedKey: 'overview.chart-catalog',
      options: {
        page: 'overview',
        chartId: 'battery-capacity-mileage',
        showPicker: true,
      },
      layout: { x: 0, y: 0, w: 12, h: 10 },
    },
  ],
};

function dashboardRecord(config = dashboardConfig) {
  return {
    id: config.id,
    owner_id: null,
    slug: config.slug,
    name: config.name,
    description: null,
    is_default: true,
    is_locked: true,
    config,
  };
}

function wrapper(queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})) {

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('dashboard API wiring', () => {
  beforeEach(() => {
    useAuth.setState({
      accessToken: 'access-token',
      userId: null,
      defaultVehicleId: 'vehicle-1',
      isAuthenticated: true,
      isBootstrapping: false,
    });
    vi.restoreAllMocks();
  });

  it('keeps dashboard queries idle until auth bootstrap is ready', () => {
    useAuth.setState({
      accessToken: null,
      userId: null,
      defaultVehicleId: null,
      activeVehicleId: null,
      isAuthenticated: false,
      isBootstrapping: true,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useDashboards(), {
      wrapper: wrapper(),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('normalizes backend dashboard records into renderable dashboard configs', () => {
    const normalized = normalizeDashboardConfig(dashboardRecord());

    expect(normalized.name).toBe('Battery');
    expect(normalized.widgets).toHaveLength(1);
    expect(normalized.widgets[0]?.componentType).toBe('sensor');
    expect(normalized.widgets[0]?.definitionId).toBe('battery_level');
  });

  it('does not inject or replace widgets in a saved charging dashboard', () => {
    const staleCharging: DashboardConfig = {
      ...dashboardConfig,
      id: '00000000-0000-0000-0000-000000000004',
      slug: 'charging',
      name: 'Charging',
      isDefault: false,
      isLocked: false,
      ownerId: '11111111-1111-1111-1111-111111111111',
      widgets: [
        { id: 'd4000004-0000-0000-0000-000000000003', componentType: 'charging', definitionId: 'total_cost', title: 'Total Cost', options: {}, layout: { x: 6, y: 0, w: 3, h: 2 } },
        { id: 'd4000004-0000-0000-0000-000000000004', componentType: 'charging', definitionId: 'avg_session', title: 'Avg / Session', options: {}, layout: { x: 9, y: 0, w: 3, h: 2 } },
        { id: 'd4000004-0000-0000-0000-000000000006', componentType: 'charging', definitionId: 'charge_efficiency', title: 'Charge Efficiency', options: {}, layout: { x: 3, y: 2, w: 3, h: 2 } },
        { id: 'd4000004-0000-0000-0000-000000000008', componentType: 'charging', definitionId: 'max_charge_limit', title: 'Max Charge Limit', options: {}, layout: { x: 9, y: 2, w: 3, h: 2 } },
        { id: 'd4000004-0000-0000-0000-000000000009', componentType: 'charging', definitionId: 'home_share', title: 'Home Charging', options: {}, layout: { x: 0, y: 4, w: 6, h: 2 } },
        { id: 'd4000004-0000-0000-0000-000000000010', componentType: 'charging', definitionId: 'dc_share', title: 'DC Fast Charging', options: {}, layout: { x: 6, y: 4, w: 6, h: 2 } },
        { id: 'd4000004-0000-0000-0000-000000000011', componentType: 'chart', definitionId: 'catalog', title: 'Charging Charts', options: {}, layout: { x: 0, y: 6, w: 12, h: 10 } },
        { id: 'd4000004-0000-0000-0000-000000000012', componentType: 'custom', definitionId: 'charging.sessions.table', title: 'Charging Sessions', options: {}, layout: { x: 0, y: 16, w: 12, h: 12 } },
      ],
    };

    const normalized = normalizeDashboardConfig(dashboardRecord(staleCharging));
    const widgetIds = normalized.widgets.map((widget) => widget.definitionId);

    expect(widgetIds).not.toContain('charging.connection');
    expect(widgetIds).toContain('avg_session');
    expect(widgetIds).toContain('charge_efficiency');
    expect(widgetIds).toContain('max_charge_limit');
    expect(widgetIds).toContain('catalog');
    expect(widgetIds).toContain('charging.sessions.table');
    expect(normalized.widgets).toHaveLength(staleCharging.widgets.length);
  });

  it('returns the nested config from by-slug responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(dashboardRecord()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    const { result } = renderHook(() => useDashboardBySlug('battery'), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.slug).toBe('battery');
    expect(result.current.data?.widgets).toHaveLength(1);
  });

  it('loads an exact dashboard ID without resolving through its slug', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(dashboardRecord()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    const { result } = renderHook(() => useDashboardById(dashboardConfig.id), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/v1/dashboards/${dashboardConfig.id}`);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('/by-slug/');
  });

  it('sends dashboard saves using the backend update envelope', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(dashboardRecord()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    const { result } = renderHook(() => useUpdateDashboard(), {
      wrapper: wrapper(),
    });

    const savedConfig = {
      ...dashboardConfig,
      widgets: [
        {
          ...dashboardConfig.widgets[0]!,
          options: { chartType: 'line', timeFilter: '24h' },
        },
      ],
    };

    await act(async () => {
      await result.current.mutateAsync(savedConfig);
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));

    expect(body).toMatchObject({
      name: 'Battery',
      slug: 'battery',
      config: {
        widgets: savedConfig.widgets,
      },
    });
    expect(body.config.widgets).toHaveLength(1);
    expect(body.config.widgets[0].options.timeFilter).toBe('24h');
  });

  it('rejects a malformed restore ID before it reaches the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useRestoreAdminDashboardDefault(), {
      wrapper: wrapper(),
    });

    await expect(act(async () => {
      await result.current.mutateAsync('default-overview');
    })).rejects.toThrow('Invalid dashboard ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('restoring the overview bundle aligns the account favorite with the bundled chart default', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/restore-default')) {
        return new Response(JSON.stringify(dashboardRecord(overviewDashboardConfig)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/auth/preferences/chart-favorites')) {
        return new Response(JSON.stringify({
          chart_favorites: {
            'dashboard:00000000-0000-0000-0000-000000000001:d1000001-0000-0000-0000-000000000006': 'battery-capacity-mileage',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected request: ${url} ${String(init?.method)}`);
    });
    const { result } = renderHook(() => useRestoreAdminDashboardDefault(), {
      wrapper: wrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(overviewDashboardConfig.id);
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`/v1/admin/dashboards/${overviewDashboardConfig.id}/restore-default`),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/v1/auth/preferences/chart-favorites'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          key: 'dashboard:00000000-0000-0000-0000-000000000001:d1000001-0000-0000-0000-000000000006',
          chart_id: 'battery-capacity-mileage',
        }),
      }),
    );
  });

  it('keeps a successful dashboard restore when account favorite alignment fails', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const favoriteKey = 'dashboard:00000000-0000-0000-0000-000000000001:d1000001-0000-0000-0000-000000000006';
    queryClient.setQueryData(['auth', 'dashboard-chart-favorites', null], {
      chart_favorites: { [favoriteKey]: 'soc-history' },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/restore-default')) {
        return new Response(JSON.stringify(dashboardRecord(overviewDashboardConfig)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/auth/preferences/chart-favorites')) {
        return new Response('preference unavailable', { status: 503 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useRestoreAdminDashboardDefault(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(overviewDashboardConfig.id);
    });

    expect(result.current.data?.widgets[0]?.options?.chartId).toBe('battery-capacity-mileage');
    expect(queryClient.getQueryData<DashboardConfig>([
      'dashboards',
      'id',
      overviewDashboardConfig.id,
    ])?.widgets[0]?.options?.chartId).toBe('battery-capacity-mileage');
    expect(queryClient.getQueryData<{ chart_favorites: Record<string, string> }>([
      'auth',
      'dashboard-chart-favorites',
      null,
    ])?.chart_favorites[favoriteKey]).toBe('battery-capacity-mileage');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
