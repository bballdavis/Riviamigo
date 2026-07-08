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
import { getActiveElapsedSFromChartState } from './TripChartSync';

export interface TripDrivePoint {
  elapsed_s: number;
  power_kw: number | null;
  regen_kw: number | null;
  speed_mph: number | null;
}

export interface TripDriveChartProps {
  data: TripDrivePoint[];
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

export function TripDriveChart({
  data,
  loading = false,
  height = 280,
  activeElapsedS = null,
  onActiveElapsedSChange,
}: TripDriveChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        Loading drive chart...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        No drive profile data for this trip.
      </div>
    );
  }

  const hasAnyData = data.some((point) => point.power_kw != null || point.regen_kw != null || point.speed_mph != null);
  if (!hasAnyData) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        No power samples were captured for this trip.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        syncId="trip-timeline-sync"
        syncMethod="value"
        margin={CHART_MARGINS.withYAxis}
        onMouseMove={(state) => {
          const nextElapsed = getActiveElapsedSFromChartState<TripDrivePoint>(
            state as Parameters<typeof getActiveElapsedSFromChartState>[0],
            data,
          );
          onActiveElapsedSChange?.(nextElapsed);
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
          yAxisId="power"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${Math.round(value)}`}
          width={34}
        />
        <YAxis
          yAxisId="speed"
          orientation="right"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${Math.round(value)} mph`}
          width={36}
        />
        <Tooltip
          content={<ChartTooltip
            labelFormatter={(value) => formatElapsed(Number(value))}
            formatter={(value, name) => {
              if (name === 'power_kw') return [`${Number(value).toFixed(1)} kW`, 'Power'];
              if (name === 'regen_kw') return [`${Number(value).toFixed(1)} kW`, 'Regen'];
              if (name === 'speed_mph') return [`${Math.round(Number(value))} mph`, 'Speed'];
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
        {activeElapsedS != null ? <ReferenceLine x={activeElapsedS} stroke={CHART_COLORS.muted} strokeDasharray="4 4" /> : null}
        <Line
          type="monotone"
          dataKey="power_kw"
          name="Power"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
          yAxisId="power"
        />
        <Line
          type="monotone"
          dataKey="regen_kw"
          name="Regen"
          stroke={CHART_COLORS.sky}
          strokeWidth={1.6}
          dot={false}
          isAnimationActive={false}
          connectNulls
          yAxisId="power"
        />
        <Line
          type="monotone"
          dataKey="speed_mph"
          name="Speed"
          stroke={CHART_COLORS.warning}
          strokeWidth={1.4}
          strokeDasharray="4 4"
          dot={false}
          isAnimationActive={false}
          connectNulls
          yAxisId="speed"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
