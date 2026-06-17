import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth, useMetricCatalog, useTrips } from '@riviamigo/hooks';

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('authenticated query gating', () => {
  beforeEach(() => {
    useAuth.setState({
      accessToken: null,
      isAuthenticated: false,
      isBootstrapping: true,
      userId: null,
      defaultVehicleId: null,
      activeVehicleId: null,
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the metric catalog query idle until an access token exists', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useMetricCatalog(), {
      wrapper: wrapper(),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('keeps trip history idle until an access token exists', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useTrips('vehicle-123', '2026-06-01', '2026-06-17'), {
      wrapper: wrapper(),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
