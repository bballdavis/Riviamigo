import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { OwnershipResponse, OwnershipSettings } from '@riviamigo/types';
import { api } from './api';
import { useAuthReady } from './useAuthState';
import { queryKeys } from './queryKeys';

/** Everything the Ownership page computes from: settings, usage, prices, references. */
export function useOwnership(vehicleId: string | null) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.vehicle.ownership(vehicleId),
    queryFn: () => api.getOwnership(vehicleId!),
    enabled: authReady && !!vehicleId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (previous) => previous,
    // Not saved to the browser cache: the response's shape is still changing,
    // and a copy saved by an older build must never reach the page.
    meta: { persist: false },
  });
}

/** Only the stored cost inputs; never contacts the fuel-price provider. */
export function useOwnershipSettings(vehicleId: string | null, enabled = true) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.vehicle.ownershipSettings(vehicleId),
    queryFn: () => api.getOwnershipSettings(vehicleId!),
    enabled: enabled && authReady && !!vehicleId,
    staleTime: 60 * 1000,
    meta: { persist: false },
  });
}

/**
 * Saves the vehicle's whole ownership settings object. The cache is updated
 * optimistically and rolled back when the save fails.
 *
 * Every request carries the full object, so two things keep saves consistent:
 * requests reach the server one at a time in the order they were made (an
 * older request landing last would undo a newer change), and callers build
 * each save from `readLatest()` rather than from a render-time copy.
 */
export function useUpdateOwnershipSettings(vehicleId: string | null) {
  const queryClient = useQueryClient();
  const key = queryKeys.vehicle.ownership(vehicleId);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const sequenceRef = useRef(0);
  const inFlightRef = useRef(0);

  const mutation = useMutation({
    mutationFn: (settings: OwnershipSettings) => {
      const request = queueRef.current.then(() => api.updateOwnershipSettings(vehicleId!, settings));
      // A failed save must not stall the saves queued behind it.
      queueRef.current = request.catch(() => undefined);
      return request;
    },
    onMutate: async (settings: OwnershipSettings) => {
      const sequence = ++sequenceRef.current;
      inFlightRef.current += 1;
      // Cancel first: a refetch already in flight would otherwise land after
      // the optimistic write and show the pre-save response.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<OwnershipResponse>(key);
      if (previous) queryClient.setQueryData<OwnershipResponse>(key, { ...previous, settings });
      return { previous, sequence };
    },
    onSuccess: (saved, _settings, context) => {
      // An older save finishing must not overwrite the newer one's optimistic state.
      if (context?.sequence !== sequenceRef.current) return;
      queryClient.setQueryData<OwnershipResponse>(key, (current) =>
        current ? { ...current, settings: saved.settings } : current,
      );
    },
    onError: (_error, _settings, context) => {
      // Only the newest save rolls back. An older save's snapshot can already
      // include changes that a newer save still has in flight; the refetch
      // once everything settles puts the server's state back either way.
      if (context?.sequence !== sequenceRef.current || !context.previous) return;
      queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      inFlightRef.current -= 1;
      // The settings key is nested under the ownership key, so one
      // invalidation refreshes the page and the settings editor together.
      // Waiting for the last save avoids a refetch that shows a mid-burst state.
      if (inFlightRef.current === 0) void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    ...mutation,
    /** The cached response as it stands, including saves still in flight. */
    readLatest: () => queryClient.getQueryData<OwnershipResponse>(key),
  };
}

type LookupMenu = 'years' | 'makes' | 'models' | 'options';

/** One step of the year, make, model, trim cascade. Lookup data rarely changes. */
export function useOwnershipVehicleLookupMenu(
  menu: LookupMenu,
  params: { year?: string; make?: string; model?: string },
  enabled: boolean,
) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: queryKeys.ownership.vehicleLookup(menu, params),
    queryFn: async () => (await api.lookupOwnershipVehicleMenu(menu, params)).items,
    enabled: enabled && authReady,
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
}
