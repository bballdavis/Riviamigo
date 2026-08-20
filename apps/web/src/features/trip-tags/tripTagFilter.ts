import { z } from 'zod';

export const tripTagSearchSchema = z.object({
  tag_ids: z.string().optional(),
  tag_match: z.enum(['all', 'any']).optional(),
  untagged: z.literal('1').optional(),
});

export type TripTagSearch = z.infer<typeof tripTagSearchSchema>;
export type TripTagMatch = 'all' | 'any';

export interface TripTagFilter {
  tagIds: string[];
  tagMatch: TripTagMatch;
  untagged: boolean;
}

export interface TripTagFilterSelection extends TripTagFilter {
  setFilter: (next: TripTagFilter) => void;
}

export function normalizeTripTagIds(tagIds: string | readonly string[] | undefined): string[] {
  const values = typeof tagIds === 'string' ? tagIds.split(',') : tagIds ?? [];
  return [...new Set(values.map((id) => id.trim()).filter(Boolean))].sort();
}

export function parseTripTagFilter(search: TripTagSearch | null | undefined): TripTagFilter {
  const tagIds = normalizeTripTagIds(search?.tag_ids);
  return {
    tagIds,
    tagMatch: search?.tag_match ?? 'all',
    untagged: search?.untagged === '1' && tagIds.length === 0,
  };
}

export function serializeTripTagFilter(filter: TripTagFilter): TripTagSearch {
  const tagIds = normalizeTripTagIds(filter.tagIds);
  if (tagIds.length > 0) {
    return {
      tag_ids: tagIds.join(','),
      ...(filter.tagMatch === 'any' ? { tag_match: 'any' as const } : {}),
    };
  }

  return filter.untagged ? { untagged: '1' } : {};
}

export function createTripTagFilterAdapter(
  search: TripTagSearch | null | undefined,
  setSearch: (search: TripTagSearch) => void,
): TripTagFilterSelection {
  return {
    ...parseTripTagFilter(search),
    setFilter: (next) => setSearch(serializeTripTagFilter(next)),
  };
}
