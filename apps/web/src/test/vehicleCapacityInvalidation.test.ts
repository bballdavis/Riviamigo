import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateVehicleCapacityData } from '@riviamigo/hooks';

describe('invalidateVehicleCapacityData', () => {
  it('marks persisted battery health data stale after a vehicle capacity save', () => {
    const queryClient = new QueryClient();
    const keys = [
      ['battery', 'health', 'v1'],
      ['battery', 'degradation', 'v1', null, null, true],
      ['vehicles'],
      ['chart-dataset', 'battery.degradation', 'b1'],
      ['metrics', 'batch', 'v1'],
    ];
    for (const key of keys) queryClient.setQueryData(key, { cached: true });
    queryClient.setQueryData(['trips', 'list'], { cached: true });

    invalidateVehicleCapacityData(queryClient);

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
    expect(queryClient.getQueryState(['trips', 'list'])?.isInvalidated).toBe(false);
  });
});
