import type {
  ChartManagerEntry,
  ChartOrigin,
  ChartRecord,
  ChartPermissions,
} from '@riviamigo/types';

export function chartOrigin(record: ChartRecord, systemBase?: ChartRecord): ChartOrigin {
  if (!record.ownerId) return 'system';
  return systemBase ? 'override' : 'personal';
}

export function defaultChartPermissions(record: ChartRecord, isAdmin = false): ChartPermissions {
  const isSystem = record.ownerId == null;
  const editable = isSystem ? isAdmin : true;
  return {
    read: true,
    edit: editable && !record.isLocked,
    duplicate: true,
    reset: false,
    restore: isSystem && isAdmin,
    delete: !isSystem,
    lock: isSystem && isAdmin,
  };
}

export function buildChartManagerEntries(
  rows: ChartRecord[],
  userId: string | null | undefined,
  isAdmin = false,
): ChartManagerEntry[] {
  const systemBySlug = new Map(rows.filter((row) => row.ownerId == null).map((row) => [row.slug, row]));
  const personalBySlug = new Map(rows.filter((row) => row.ownerId === userId).map((row) => [row.slug, row]));
  const slugs = new Set([...systemBySlug.keys(), ...personalBySlug.keys()]);
  return [...slugs]
    .map((slug) => {
      const systemBase = systemBySlug.get(slug);
      const personalOverride = personalBySlug.get(slug);
      const effective = personalOverride ?? systemBase;
      if (!effective) return null;
      const origin = chartOrigin(effective, systemBase);
      return {
        effective,
        ...(systemBase ? { systemBase } : {}),
        ...(personalOverride ? { personalOverride } : {}),
        origin,
        permissions: {
          ...defaultChartPermissions(effective, isAdmin),
          reset: Boolean(personalOverride && systemBase),
        },
      } satisfies ChartManagerEntry;
    })
    .filter((entry): entry is ChartManagerEntry => Boolean(entry))
    .sort((left, right) => left.effective.name.localeCompare(right.effective.name));
}

export function resolveAssignedCharts(
  entries: ChartManagerEntry[],
  dashboardSlug: string,
  requiredSlugs: string[] = [],
) {
  const required = new Set(requiredSlugs);
  return entries
    .map((entry) => entry.effective)
    .filter((chart) => chart.isEnabled && (
      chart.config.placements.some((placement) => placement.dashboardSlug === dashboardSlug)
      || required.has(chart.slug)
    ))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function chartHasPlacement(record: ChartRecord, dashboardSlug: string) {
  return record.config.placements.some((placement) => placement.dashboardSlug === dashboardSlug);
}

export function withChartPlacement(record: ChartRecord, dashboardSlug: string, assigned: boolean): ChartRecord {
  const placements = record.config.placements.filter((placement) => placement.dashboardSlug !== dashboardSlug);
  if (assigned) placements.push({ dashboardSlug });
  placements.sort((left, right) => left.dashboardSlug.localeCompare(right.dashboardSlug));
  return { ...record, config: { ...record.config, placements } };
}
