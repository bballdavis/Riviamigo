import * as React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { formatTemp } from '../lib/utils';

export interface TripTemperaturePoint {
  elapsed_s: number;
  outside_temp_c: number | null;
  cabin_temp_c: number | null;
}

export interface TripTemperatureChartProps {
  data: TripTemperaturePoint[];
  loading?: boolean;
  height?: number;
  activeElapsedS?: number | null;
  onActiveElapsedSChange?: (value: number | null) => void;
}

function formatElapsed(seconds: number) {
  const min = Math.floor(seconds / 60);
  const sec = Math.max(0, Math.floor(seconds % 60));
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function TripTemperatureChart({
  data,
  loading = false,
  height = 240,
  activeElapsedS = null,
  onActiveElapsedSChange,
}: TripTemperatureChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        Loading temperature chart...
      </div>
    );
  }

  const hasAnyData = data.some((point) => point.outside_temp_c != null || point.cabin_temp_c != null);
  if (!hasAnyData) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        No temperature profile data for this trip.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={CHART_MARGINS.withYAxis}
        onMouseMove={(state) => {
          const payload = state?.activePayload?.[0]?.payload as TripTemperaturePoint | undefined;
          onActiveElapsedSChange?.(payload?.elapsed_s ?? null);
        }}
        onMouseLeave={() => onActiveElapsedSChange?.(null)}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="elapsed_s"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatElapsed}
          minTickGap={45}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatTemp(value)}
          width={34}
        />
        <Tooltip
          content={<ChartTooltip
            labelFormatter={(value) => formatElapsed(Number(value))}
            formatter={(value, name) => {
              if (name === 'outside_temp_c') return [formatTemp(Number(value)), 'Outside'];
              if (name === 'cabin_temp_c') return [formatTemp(Number(value)), 'Cabin'];
              return [String(value), String(name)];
            }}
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Legend
          verticalAlign="top"
          height={22}
          wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted, paddingTop: 8 }}
          iconType="line"
        />
        {activeElapsedS != null ? (
          <ReferenceLine x={activeElapsedS} stroke={CHART_COLORS.muted} strokeDasharray="4 4" />
        ) : null}
        <Line
          type="monotone"
          dataKey="outside_temp_c"
          name="outside_temp_c"
          stroke={CHART_COLORS.sky}
          strokeWidth={1.8}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="cabin_temp_c"
          name="cabin_temp_c"
          stroke={CHART_COLORS.accent}
          strokeWidth={1.8}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
