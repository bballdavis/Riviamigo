import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, useCloneChart, useSetChartEnabled } from '@riviamigo/hooks';

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

describe('chart mutation API wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('patches enabled state through the existing owner-writable chart route', async () => {
    const apiFetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});
    const { result } = renderHook(() => useSetChartEnabled(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.mutateAsync({ id: 'chart-1', isEnabled: false });
    });

    expect(apiFetch).toHaveBeenCalledWith('PATCH', '/v1/charts/chart-1', {
      isEnabled: false,
    });
  });

  it('sends the requested duplicate slug and name to the clone route', async () => {
    const apiFetch = vi.spyOn(api, 'apiFetch').mockResolvedValue({});
    const { result } = renderHook(() => useCloneChart(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'chart-1',
        slug: 'efficiency-copy',
        name: 'Efficiency Copy',
      });
    });

    expect(apiFetch).toHaveBeenCalledWith('POST', '/v1/charts/chart-1/clone', {
      slug: 'efficiency-copy',
      name: 'Efficiency Copy',
    });
  });
});
