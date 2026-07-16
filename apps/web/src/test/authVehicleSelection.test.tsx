import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth, useResolvedVehicleSelection } from '@riviamigo/hooks';

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

describe('resolved vehicle selection', () => {
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

  it('does not fetch vehicles before auth bootstrap is ready', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useResolvedVehicleSelection(), {
      wrapper: wrapper(),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.authReady).toBe(false);
    expect(result.current.effectiveVehicleId).toBeNull();
  });

  it('preserves the active vehicle when a browser session resumes after refresh', async () => {
    useAuth.setState({
      accessToken: null,
      isAuthenticated: false,
      isBootstrapping: true,
      userId: 'user-1',
      defaultVehicleId: 'vehicle-1',
      activeVehicleId: 'vehicle-2',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        access_token: 'resumed-token',
        expires_in: 900,
        default_vehicle_id: 'vehicle-1',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    await expect(useAuth.getState().resumeSession()).resolves.toBe(true);

    expect(useAuth.getState()).toMatchObject({
      accessToken: 'resumed-token',
      defaultVehicleId: 'vehicle-1',
      activeVehicleId: 'vehicle-2',
      isAuthenticated: true,
      isBootstrapping: false,
    });
  });

  it('repairs stale persisted vehicle ids before shared live status can start', async () => {
    useAuth.setState({
      accessToken: 'token-123',
      isAuthenticated: true,
      isBootstrapping: false,
      userId: 'user-1',
      defaultVehicleId: 'stale-default',
      activeVehicleId: 'stale-active',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        vehicles: [
          { id: 'vehicle-1', model: 'R1S', display_name: 'Home - Castor' },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response,
    );

    const { result } = renderHook(() => useResolvedVehicleSelection(), {
      wrapper: wrapper(),
    });

    await waitFor(() => {
      expect(result.current.vehiclesQuery.isSuccess).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.effectiveVehicleId).toBe('vehicle-1');
    });

    expect(useAuth.getState().activeVehicleId).toBeNull();
    expect(useAuth.getState().defaultVehicleId).toBe('vehicle-1');
  });
});
