import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OwnershipSettings } from '@riviamigo/types';
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
  });
}

export function useUpdateOwnershipSettings(vehicleId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: OwnershipSettings) => api.updateOwnershipSettings(vehicleId!, settings),
    onSuccess: () =>
      // The settings key is nested under the ownership key, so one
      // invalidation refreshes the page and the settings editor together.
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicle.ownership(vehicleId) }),
  });
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
    queryKey: ['ownership', 'vehicle-lookup', menu, params.year ?? '', params.make ?? '', params.model ?? ''],
    queryFn: async () => (await api.lookupOwnershipVehicleMenu(menu, params)).items,
    enabled: enabled && authReady,
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
}
