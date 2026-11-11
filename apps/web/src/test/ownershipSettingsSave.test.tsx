import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnershipResponse, OwnershipSettings, OwnershipSettingsResponse } from '@riviamigo/types';
import { api, queryKeys, useUpdateOwnershipSettings } from '@riviamigo/hooks';
import { response } from '../features/ownership/testFixtures';

const VEHICLE_ID = 'vehicle-1';
const OWNERSHIP_KEY = queryKeys.vehicle.ownership(VEHICLE_ID);

function settingsWith(customIds: string[]): OwnershipSettings {
  return {
    ...response().settings,
    comparisons: {
      enabled: null,
      custom: customIds.map((id) => ({
        id,
        label: id,
        powertrain: 'ev' as const,
        price_usd: 70_000,
        mpg: null,
        kwh_per_mi: 0.3,
        premium_fuel: false,
      })),
    },
  };
}

function reply(settings: OwnershipSettings): OwnershipSettingsResponse {
  return { vehicle_id: VEHICLE_ID, can_edit: true, settings };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function customIds(client: QueryClient) {
  return client.getQueryData<OwnershipResponse>(OWNERSHIP_KEY)?.settings.comparisons.custom.map((vehicle) => vehicle.id);
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(OWNERSHIP_KEY, response());
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useUpdateOwnershipSettings(VEHICLE_ID), { wrapper });
  return { client, result };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('useUpdateOwnershipSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a save in the cache before the server answers, and rolls it back when it fails', async () => {
    const { client, result } = setup();
    const pending = deferred<OwnershipSettingsResponse>();
    vi.spyOn(api, 'updateOwnershipSettings').mockReturnValue(pending.promise);

    act(() => {
      result.current.mutate(settingsWith(['custom-1']));
    });
    await waitFor(() => expect(customIds(client)).toEqual(['custom-1']));

    await act(async () => pending.reject(new Error('offline')));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(customIds(client)).toEqual([]);
  });

  it('writes the server response into the cache when the newest save succeeds', async () => {
    const { client, result } = setup();
    vi.spyOn(api, 'updateOwnershipSettings').mockResolvedValue(reply(settingsWith(['saved-by-server'])));

    await act(async () => {
      await result.current.mutateAsync(settingsWith(['custom-1']));
    });
    expect(customIds(client)).toEqual(['saved-by-server']);
  });

  it('sends saves one at a time, in the order they were made', async () => {
    const { result } = setup();
    const first = deferred<OwnershipSettingsResponse>();
    const second = deferred<OwnershipSettingsResponse>();
    const send = vi.spyOn(api, 'updateOwnershipSettings')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    act(() => {
      result.current.mutate(settingsWith(['a']));
      result.current.mutate(settingsWith(['a', 'b']));
    });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(reply(settingsWith(['a']))));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[1].comparisons.custom.map((vehicle) => vehicle.id)).toEqual(['a', 'b']);

    await act(async () => second.resolve(reply(settingsWith(['a', 'b']))));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('keeps the newest change when an older save fails, and does not stall the saves behind it', async () => {
    const { client, result } = setup();
    const first = deferred<OwnershipSettingsResponse>();
    const second = deferred<OwnershipSettingsResponse>();
    const send = vi.spyOn(api, 'updateOwnershipSettings')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    act(() => {
      result.current.mutate(settingsWith(['a']));
      result.current.mutate(settingsWith(['a', 'b']));
    });
    await flush();

    await act(async () => first.reject(new Error('rejected')));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(customIds(client)).toEqual(['a', 'b']);

    await act(async () => second.resolve(reply(settingsWith(['a', 'b']))));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(customIds(client)).toEqual(['a', 'b']);
  });

  it('exposes saves still in flight through readLatest, so the next change starts from them', async () => {
    const { result } = setup();
    const pending = deferred<OwnershipSettingsResponse>();
    vi.spyOn(api, 'updateOwnershipSettings').mockReturnValue(pending.promise);

    act(() => {
      result.current.mutate(settingsWith(['x']));
    });
    await waitFor(() => expect(result.current.readLatest()?.settings.comparisons.custom.map((vehicle) => vehicle.id)).toEqual(['x']));

    await act(async () => pending.resolve(reply(settingsWith(['x']))));
  });

  it('refetches the ownership data only after the last queued save settles', async () => {
    const { client, result } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
    const first = deferred<OwnershipSettingsResponse>();
    const second = deferred<OwnershipSettingsResponse>();
    vi.spyOn(api, 'updateOwnershipSettings')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    act(() => {
      result.current.mutate(settingsWith(['a']));
      result.current.mutate(settingsWith(['a', 'b']));
    });
    await flush();

    await act(async () => first.resolve(reply(settingsWith(['a']))));
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => second.resolve(reply(settingsWith(['a', 'b']))));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: OWNERSHIP_KEY }));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
