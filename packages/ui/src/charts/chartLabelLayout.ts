import { CHART_FONT } from './ChartProvider';

export interface ChartLabelMeasure {
  text: string;
  width: number;
}

export interface ValueLabelCandidate {
  index: number;
  value: number;
  x: number;
  y: number;
  width: number;
  height?: number;
}

const FALLBACK_GLYPH_WIDTH = 0.62;

/** Measures with the chart font when canvas is available, and stays deterministic in SSR/jsdom. */
export function measureChartText(text: string, font = CHART_FONT): number {
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context) {
        context.font = `${font.fontWeight} ${font.fontSize}px ${font.fontFamily}`;
        const measured = context.measureText(text).width;
        if (Number.isFinite(measured) && measured > 0) return measured;
      }
    } catch {
      // Canvas is optional (not available in SSR and some test environments).
    }
  }
  return Math.max(1, text.length * font.fontSize * FALLBACK_GLYPH_WIDTH);
}

export function measureChartLabels(labels: string[], font = CHART_FONT): ChartLabelMeasure[] {
  return labels.map((text) => ({ text, width: measureChartText(text, font) }));
}

export interface AxisLabelLayoutOptions {
  minSpacing?: number;
  font?: typeof CHART_FONT;
}

/** Returns the densest readable set of x-axis labels, retaining endpoints when they fit. */
export function selectAdaptiveAxisLabelIndices(
  labels: string[],
  xPositions: number[],
  options: AxisLabelLayoutOptions = {},
): number[] {
  const count = Math.min(labels.length, xPositions.length);
  if (count === 0) return [];
  const gap = options.minSpacing ?? 12;
  const widths = measureChartLabels(labels.slice(0, count), options.font).map((item) => item.width);
  const fits = (left: number, right: number) => Math.abs((xPositions[right] ?? 0) - (xPositions[left] ?? 0)) >= ((widths[left] ?? 0) + (widths[right] ?? 0)) / 2 + gap;

  const selected: number[] = [0];
  for (let index = 1; index < count; index += 1) {
    const previous = selected[selected.length - 1];
    if (previous !== undefined && fits(previous, index)) selected.push(index);
  }
  const previous = selected[selected.length - 1];
  if (count > 1 && previous !== undefined && fits(previous, count - 1)) {
    if (selected[selected.length - 1] !== count - 1) selected.push(count - 1);
  } else if (count > 1 && selected[selected.length - 1] !== count - 1) {
    // Prefer the endpoint over the nearest colliding interior label.
    while (selected.length > 1) {
      const current = selected[selected.length - 1];
      if (current === undefined || fits(current, count - 1)) break;
      selected.pop();
    }
    const current = selected[selected.length - 1];
    if (current !== undefined && fits(current, count - 1)) selected.push(count - 1);
  }
  return selected;
}

export const selectAxisLabelIndices = selectAdaptiveAxisLabelIndices;

/** Selects value labels by descending value while preventing padded bounding-box collisions. */
export function selectValueLabelIndices(
  candidates: ValueLabelCandidate[],
  padding = 6,
): number[] {
  const accepted: ValueLabelCandidate[] = [];
  const ordered = candidates
    .map((candidate, order) => ({ candidate, order }))
    .sort((left, right) => right.candidate.value - left.candidate.value || left.order - right.order);
  for (const { candidate } of ordered) {
    const height = candidate.height ?? CHART_FONT.fontSize;
    const box = { left: candidate.x - candidate.width / 2 - padding, right: candidate.x + candidate.width / 2 + padding, top: candidate.y - height - padding, bottom: candidate.y + padding };
    const overlaps = accepted.some((other) => {
      const otherHeight = other.height ?? CHART_FONT.fontSize;
      return box.left < other.x + other.width / 2 + padding && box.right > other.x - other.width / 2 - padding
        && box.top < other.y + padding && box.bottom > other.y - otherHeight - padding;
    });
    if (!overlaps) accepted.push(candidate);
  }
  return accepted.map((candidate) => candidate.index).sort((left, right) => left - right);
}

export const selectNonOverlappingValueLabels = selectValueLabelIndices;
