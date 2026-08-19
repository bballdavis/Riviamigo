/** Shared React Query keys. Keep public keys stable; version segments document intentional cache breaks. */
export const queryKeys = {
  me: { all: ['me'] as const },
  vehicles: {
    all: ['vehicles'] as const,
    status: (vehicleId: string | null) => ['vehicles', 'status', vehicleId] as const,
  },
  vehicle: {
    health: (vehicleId: string | null) => ['vehicles', 'health', vehicleId] as const,
    images: (vehicleId: string | null) => ['vehicles', 'images', vehicleId] as const,
  },
  apiKeys: { all: ['api-keys'] as const },
  apiCatalog: { all: ['api-catalog'] as const },
  vehicleMembers: {
    byVehicle: (vehicleId: string | null) => ['vehicle-members', vehicleId] as const,
  },
  vehicleInvites: {
    byVehicle: (vehicleId: string | null) => ['vehicle-invites', vehicleId] as const,
  },
  unitPreferences: { current: ['unit-preferences'] as const },
  appTimezone: { current: ['app-timezone'] as const },
  backups: {
    all: ['backup-overview'] as const,
    overview: (page?: number, perPage?: number) => ['backup-overview', page, perPage] as const,
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
