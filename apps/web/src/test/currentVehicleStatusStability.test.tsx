import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys, useCurrentVehicleStatus, useLiveStatusStore } from '@riviamigo/hooks';
import type { VehicleStatus } from '@riviamigo/types';

const stored = { vehicle_id: 'vehicle-1', battery_level: 60, speed_mph: 0, is_online: true, last_updated: '2026-11-19T15:00:00Z' } as VehicleStatus;
const live = { vehicle_id: 'vehicle-1', speed_mph: 43, is_online: true, last_updated: '2026-11-19T15:00:05Z' } as VehicleStatus;

let seen: Array<VehicleStatus | null> = [];
let rerender: () => void = () => {};

function Probe() {
  const [, setTick] = React.useState(0);
  rerender = () => setTick((tick) => tick + 1);
  seen.push(useCurrentVehicleStatus('vehicle-1').data);
  return null;
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.vehicles.status('vehicle-1'), stored);
  render(<QueryClientProvider client={queryClient}><Probe /></QueryClientProvider>);
}

beforeEach(() => {
  seen = [];
  useLiveStatusStore.setState({ status: {}, connected: {} });
});

describe('useCurrentVehicleStatus', () => {
  it('returns the same merged status until the stored or live status changes', () => {
    act(() => useLiveStatusStore.getState().setStatus('vehicle-1', live));
    renderProbe();
    const merged = seen.at(-1)!;
    expect(merged).toMatchObject({ battery_level: 60, speed_mph: 43 });

    // A render that changes neither source must hand back the same object:
    // consumers key effects on it, and a new one each render loops them.
    act(() => rerender());
    act(() => rerender());
    expect(seen.at(-1)).toBe(merged);
    expect(seen.at(-2)).toBe(merged);

    act(() => useLiveStatusStore.getState().setStatus('vehicle-1', { ...live, speed_mph: 44, last_updated: '2026-11-19T15:00:10Z' }));
    expect(seen.at(-1)).not.toBe(merged);
    expect(seen.at(-1)).toMatchObject({ battery_level: 60, speed_mph: 44 });
  });
});
