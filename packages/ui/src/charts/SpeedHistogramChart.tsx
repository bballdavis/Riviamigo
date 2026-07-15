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
import { CHART_BAR_STYLE, CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { formatDuration } from '../lib/utils';

function blendColor(fromColor: string, toColor: string, ratio: number) {
  const t = Math.max(0, Math.min(1, ratio));
  return `color-mix(in oklab, ${fromColor} ${(1 - t) * 100}%, ${toColor} ${t * 100}%)`;
}

export interface SpeedHistogramBin {
  label: string;
  min: number;
  max: number;
  count: number;
  duration_seconds: number;
  sample_elapsed_s: number | null;
}

export interface SpeedHistogramChartProps {
  bins: SpeedHistogramBin[];
  loading?: boolean;
  height?: number;
  activeBinLabel?: string | null;
}

export function SpeedHistogramChart({
  bins,
  loading = false,
  height = 280,
  activeBinLabel = null,
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

  const maxDuration = Math.max(...bins.map((bin) => bin.duration_seconds));
  const minDuration = Math.min(...bins.map((bin) => bin.duration_seconds));
  const durationRange = Math.max(1, maxDuration - minDuration);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={bins}
        margin={CHART_MARGINS.withYAxis}
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
          width={52}
          tickFormatter={(value) => formatHistogramDuration(Number(value))}
        />
        <Tooltip
          content={<ChartTooltip
            formatter={(value) => [formatHistogramDuration(Number(value)), 'Time']}
            labelFormatter={(value) => `${String(value)} mph`}
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Bar dataKey="duration_seconds" radius={[CHART_BAR_STYLE.radius, CHART_BAR_STYLE.radius, 0, 0]}>
          {bins.map((bin) => {
            const intensity = (bin.duration_seconds - minDuration) / durationRange;
            const fill = blendColor(CHART_COLORS.success, CHART_COLORS.accent, intensity);
            return (
              <Cell
                key={bin.label}
                fill={fill}
                fillOpacity={bin.label === activeBinLabel ? CHART_BAR_STYLE.activeOpacity : CHART_BAR_STYLE.fillOpacity}
              />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function formatHistogramDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return formatDuration(seconds / 60);
}
