import { describe, expect, it } from 'vitest';
import { getActiveElapsedSFromChartState } from './TripChartSync';

type MockState<T> = {
  activePayload?: Array<{ payload: T }>;
  activeLabel?: string | number | null;
  activeTooltipIndex?: number | null;
};

describe('getActiveElapsedSFromChartState', () => {
  it('resolves elapsed time from active payload', () => {
    const state: MockState<{ elapsed_s: number }> = {
      activePayload: [{ payload: { elapsed_s: 72 } }],
    };

    const value = getActiveElapsedSFromChartState(state, [{ elapsed_s: 72 }, { elapsed_s: 128 }]);

    expect(value).toBe(72);
  });

  it('resolves elapsed time from active label and falls back to a previous value when missing', () => {
    const state = {
      activeLabel: '130',
    } as MockState<{ elapsed_s: number }>;

    const value = getActiveElapsedSFromChartState(
      state,
      [{ elapsed_s: 0 }, { elapsed_s: 60 }, { elapsed_s: 120 }, { elapsed_s: 180 }],
      60,
    );

    expect(value).toBe(120);
  });

  it('holds previous elapsed when no resolvable hover data is present', () => {
    const value = getActiveElapsedSFromChartState<{ elapsed_s: number }>(null, [], 144);

    expect(value).toBe(144);
  });

  it('resolves tooltip index against measured sample rows when present', () => {
    const value = getActiveElapsedSFromChartState<{ elapsed_s: number }>(
      { activeTooltipIndex: 1 },
      [
        { elapsed_s: 10 },
        { elapsed_s: 40 },
        { elapsed_s: 70 },
      ],
      null,
    );

    expect(value).toBe(40);
  });
});
