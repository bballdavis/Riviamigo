import { z } from 'zod';

/**
 * Search params accepted by `/d/$slug`.
 *
 * `dashboardId` uses `z.guid()` rather than `z.string().uuid()`: Zod 4's `uuid()`
 * enforces RFC 9562 version/variant bits, which rejects the seeded system-default
 * dashboard IDs (`00000000-0000-0000-0000-00000000000N`). Rejecting them made every
 * "Open/Edit default" link fail route validation.
 */
export const dashboardSearchSchema = z.object({
  edit: z.literal(1).optional(),
  dashboardId: z.guid().optional(),
});

export type DashboardSearch = z.infer<typeof dashboardSearchSchema>;
