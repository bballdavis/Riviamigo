type ChartPayloadLike = {
  elapsed_s?: number | null;
};

type RechartsMouseState<T> = {
  activePayload?: Array<{ payload?: T }>;
  activeLabel?: string | number | null;
  activeTooltipIndex?: number | null;
};

type HasElapsed = { elapsed_s: number };

function toValidNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function floorToMeasuredSample(
  sampleData: readonly HasElapsed[],
  candidateElapsed: number,
): number | null {
  if (sampleData.length === 0) return null;

  let start = 0;
  let end = sampleData.length - 1;
  let candidate: number | null = null;

  while (start <= end) {
    const mid = Math.floor((start + end) / 2);
    const point = sampleData[mid];
    if (!point) break;

    const elapsed = toValidNumber(point.elapsed_s);
    if (elapsed == null) {
      start = mid + 1;
      continue;
    }

    if (elapsed <= candidateElapsed) {
      candidate = elapsed;
      start = mid + 1;
    } else {
      end = mid - 1;
    }
  }

  if (candidate != null) return candidate;

  return toValidNumber(sampleData[0]?.elapsed_s) ?? null;
}

/**
 * Resolve the active elapsed second from Recharts hover state, preferring the most
 * recent measured sample at or before the hovered coordinate and keeping the prior
 * hover point when no resolvable sample is present.
 */
export function getActiveElapsedSFromChartState<T extends object>(
  state: RechartsMouseState<T> | null | undefined,
  fallbackData?: readonly HasElapsed[],
  previousElapsed?: number | null,
) {
  const payload = state?.activePayload?.[0]?.payload as (T & ChartPayloadLike) | undefined;
  const payloadElapsed = toValidNumber(payload?.elapsed_s);
  if (payloadElapsed != null) {
    if (fallbackData?.length) {
      return floorToMeasuredSample(fallbackData, payloadElapsed);
    }
    return payloadElapsed;
  }

  const label = state?.activeLabel;
  const labelElapsed = toValidNumber(typeof label === 'string' ? Number(label) : label);
  if (labelElapsed != null) {
    if (fallbackData?.length) {
      return floorToMeasuredSample(fallbackData, labelElapsed);
    }
    return labelElapsed;
  }

  const tooltipIndex = toValidNumber(state?.activeTooltipIndex);
  if (tooltipIndex != null && fallbackData?.length) {
    const fallbackPoint = fallbackData[Math.round(tooltipIndex)] as HasElapsed | undefined;
    const fallbackElapsed = toValidNumber(fallbackPoint?.elapsed_s);
    if (fallbackElapsed != null) return fallbackElapsed;
  }

  return previousElapsed ?? null;
}
