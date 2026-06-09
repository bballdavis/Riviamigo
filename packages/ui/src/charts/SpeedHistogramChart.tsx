import * as React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '').trim();
  if (normalized.length !== 6) return { r: 56, g: 189, b: 248 };
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function blendColor(fromHex: string, toHex: string, ratio: number) {
  const from = hexToRgb(fromHex);
  const to = hexToRgb(toHex);
  const t = Math.max(0, Math.min(1, ratio));
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export interface SpeedHistogramBin {
  label: string;
  min: number;
  max: number;
  count: number;
  sample_elapsed_s: number | null;
}

type ActivePayloadState<T> = {
  activePayload?: Array<{ payload?: T }>;
};

export interface SpeedHistogramChartProps {
  bins: SpeedHistogramBin[];
  loading?: boolean;
  height?: number;
  activeBinLabel?: string | null;
  onActiveElapsedSChange?: (value: number | null) => void;
}

export function SpeedHistogramChart({
  bins,
  loading = false,
  height = 280,
  activeBinLabel = null,
  onActiveElapsedSChange,
}: SpeedHistogramChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        Loading speed histogram...
      </div>
    );
  }

  if (bins.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        No speed data for this trip.
      </div>
    );
  }

  const maxCount = Math.max(...bins.map((bin) => bin.count));
  const minCount = Math.min(...bins.map((bin) => bin.count));
  const countRange = Math.max(1, maxCount - minCount);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={bins}
        margin={CHART_MARGINS.withYAxis}
        onMouseMove={(state) => {
          const payload = (state as ActivePayloadState<SpeedHistogramBin> | undefined)?.activePayload?.[0]?.payload;
          onActiveElapsedSChange?.(payload?.sample_elapsed_s ?? null);
        }}
        onMouseLeave={() => onActiveElapsedSChange?.(null)}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={48}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={34}
        />
        <Tooltip
          content={<ChartTooltip
            formatter={(value) => [String(value), 'Samples']}
            labelFormatter={(value) => `${String(value)} mph`}
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {bins.map((bin) => {
            const intensity = (bin.count - minCount) / countRange;
            const fill = blendColor(CHART_COLORS.success, CHART_COLORS.accent, intensity);
            return (
            <Cell
              key={bin.label}
              fill={fill}
              fillOpacity={bin.label === activeBinLabel ? 0.98 : 0.82}
            />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
