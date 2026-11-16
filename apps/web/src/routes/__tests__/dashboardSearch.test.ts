import { describe, expect, it } from 'vitest';
import { DEFAULT_DASHBOARDS } from '@riviamigo/dashboards';
import { dashboardSearchSchema } from '../dashboardSearch';

describe('/d/$slug search schema', () => {
  // Regression: Zod 4's `uuid()` rejected the seeded system-default IDs, so every
  // "Open default" / "Edit default" link from Settings failed route validation.
  it.each(DEFAULT_DASHBOARDS.map((dashboard) => [dashboard.slug, dashboard.id]))(
    'accepts the system default dashboard id for %s',
    (_slug, id) => {
      expect(dashboardSearchSchema.safeParse({ dashboardId: id }).success).toBe(true);
      expect(dashboardSearchSchema.safeParse({ dashboardId: id, edit: 1 }).success).toBe(true);
    },
  );

  it('accepts a randomly generated user dashboard id', () => {
    expect(
      dashboardSearchSchema.safeParse({ dashboardId: crypto.randomUUID(), edit: 1 }).success,
    ).toBe(true);
  });

  it('accepts no search params', () => {
    expect(dashboardSearchSchema.safeParse({}).success).toBe(true);
  });

  it('still rejects malformed ids and unknown edit values', () => {
    expect(dashboardSearchSchema.safeParse({ dashboardId: 'not-a-uuid' }).success).toBe(false);
    expect(dashboardSearchSchema.safeParse({ edit: 2 }).success).toBe(false);
  });
});
