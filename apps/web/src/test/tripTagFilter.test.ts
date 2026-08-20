import { describe, expect, it, vi } from 'vitest';
import {
  createTripTagFilterAdapter,
  parseTripTagFilter,
  serializeTripTagFilter,
  tripTagSearchSchema,
} from '../features/trip-tags/tripTagFilter';

describe('trip tag route filter contract', () => {
  it('normalizes duplicate and unsorted IDs', () => {
    expect(parseTripTagFilter({ tag_ids: 'z, a,z,, a ', tag_match: 'any' })).toEqual({
      tagIds: ['a', 'z'],
      tagMatch: 'any',
      untagged: false,
    });
  });

  it('ignores legacy or invalid values at the shared parser boundary', () => {
    expect(parseTripTagFilter(undefined)).toEqual({ tagIds: [], tagMatch: 'all', untagged: false });
    expect(parseTripTagFilter({ tag_ids: ' , , ' })).toEqual({ tagIds: [], tagMatch: 'all', untagged: false });
    expect(tripTagSearchSchema.safeParse({ tag_match: 'ALL' }).success).toBe(false);
    expect(tripTagSearchSchema.safeParse({ untagged: true }).success).toBe(false);
  });

  it('drops untagged when tag IDs are present', () => {
    expect(parseTripTagFilter({ tag_ids: 'tag-b,tag-a', tag_match: 'all', untagged: '1' })).toEqual({
      tagIds: ['tag-a', 'tag-b'],
      tagMatch: 'all',
      untagged: false,
    });
    expect(serializeTripTagFilter({ tagIds: ['tag-b', 'tag-a'], tagMatch: 'all', untagged: true })).toEqual({
      tag_ids: 'tag-a,tag-b',
    });
  });

  it('serializes both route adapters identically', () => {
    const tripsSetSearch = vi.fn();
    const efficiencySetSearch = vi.fn();
    const next = { tagIds: ['z', 'a', 'z'], tagMatch: 'any' as const, untagged: false };
    createTripTagFilterAdapter(undefined, tripsSetSearch).setFilter(next);
    createTripTagFilterAdapter(undefined, efficiencySetSearch).setFilter(next);
    const tripsSearch = tripsSetSearch.mock.calls[0]?.[0];
    const efficiencySearch = efficiencySetSearch.mock.calls[0]?.[0];
    expect(tripsSearch).toEqual({ tag_ids: 'a,z', tag_match: 'any' });
    expect(efficiencySearch).toEqual({ tag_ids: 'a,z', tag_match: 'any' });
    expect(tripsSearch).toEqual(efficiencySearch);
  });
});
