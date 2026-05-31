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

export interface SpeedHistogramBin {
  label: string;
  min: number;
  max: number;
  count: number;
  sample_elapsed_s: number | null;
}

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

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={bins}
        margin={CHART_MARGINS.withYAxis}
        onMouseMove={(state) => {
          const payload = state?.activePayload?.[0]?.payload as SpeedHistogramBin | undefined;
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
          {bins.map((bin) => (
            <Cell
              key={bin.label}
              fill={bin.label === activeBinLabel ? CHART_COLORS.accent : CHART_COLORS.sky}
              fillOpacity={bin.label === activeBinLabel ? 0.95 : 0.72}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
