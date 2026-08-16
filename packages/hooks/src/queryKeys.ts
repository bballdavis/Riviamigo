/** Shared React Query keys. Keep public keys stable; version segments document intentional cache breaks. */
export const queryKeys = {
  me: () => ['me'] as const,
  vehicles: () => ['vehicles'] as const,
  vehicle: {
    health: (vehicleId: string | null) => ['vehicles', 'health', vehicleId] as const,
    images: (vehicleId: string | null) => ['vehicles', 'images', vehicleId] as const,
  },
  trips: {
    list: (vehicleId: string | null, from: string | null, to: string | null, lifetime: boolean, page: number, perPage: number, search: string) =>
      ['trips', 'list', 'v2', vehicleId, from, to, lifetime, page, perPage, search] as const,
    detail: (tripId: string | null, vehicleId: string | null) => ['trips', 'detail', tripId, vehicleId] as const,
    detailData: (tripId: string | null, vehicleId: string | null) => ['trips', 'detail-data', 'v1', tripId, vehicleId] as const,
  },
  charging: {
    detail: (sessionId: string | null, vehicleId: string | null) => ['charging', 'detail', sessionId, vehicleId] as const,
  },
} as const;
