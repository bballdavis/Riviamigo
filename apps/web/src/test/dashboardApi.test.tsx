import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@riviamigo/hooks';
import { normalizeDashboardConfig, useDashboardBySlug, useUpdateDashboard } from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';

const dashboardConfig: DashboardConfig = {
  schemaVersion: 1,
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
      widgetId: 'stat.current_soc',
      layout: { x: 0, y: 0, w: 3, h: 1 },
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

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

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
    });
    vi.restoreAllMocks();
  });

  it('normalizes backend dashboard records into renderable dashboard configs', () => {
    const normalized = normalizeDashboardConfig(dashboardRecord());

    expect(normalized.name).toBe('Battery');
    expect(normalized.widgets).toHaveLength(1);
    expect(normalized.widgets[0]?.widgetId).toBe('stat.current_soc');
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

    await act(async () => {
      await result.current.mutateAsync(dashboardConfig);
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));

    expect(body).toMatchObject({
      name: 'Battery',
      slug: 'battery',
      config: {
        widgets: dashboardConfig.widgets,
      },
    });
    expect(body.config.widgets).toHaveLength(1);
  });
});
