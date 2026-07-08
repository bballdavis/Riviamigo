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

/**
 * Resolve the active elapsed second from Recharts hover state as a nearest-timestamp value.
 */
export function getActiveElapsedSFromChartState<T extends object>(
  state: RechartsMouseState<T> | null | undefined,
  fallbackData?: readonly HasElapsed[],
) {
  const payload = state?.activePayload?.[0]?.payload as (T & ChartPayloadLike) | undefined;
  const payloadElapsed = toValidNumber(payload?.elapsed_s);
  if (payloadElapsed != null) return payloadElapsed;

  const label = state?.activeLabel;
  const labelElapsed = toValidNumber(typeof label === 'string' ? Number(label) : label);
  if (labelElapsed != null) return labelElapsed;

  const tooltipIndex = toValidNumber(state?.activeTooltipIndex);
  if (tooltipIndex != null && fallbackData?.length) {
    const fallbackPoint = fallbackData[Math.round(tooltipIndex)] as HasElapsed | undefined;
    const fallbackElapsed = toValidNumber(fallbackPoint?.elapsed_s);
    if (fallbackElapsed != null) return fallbackElapsed;
  }

  return null;
}
