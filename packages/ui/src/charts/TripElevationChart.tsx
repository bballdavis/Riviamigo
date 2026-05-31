import * as React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { colors } from '../tokens/colors';

export interface TripElevationPoint {
  elapsed_s: number;
  altitude_m: number | null;
}

export interface TripElevationChartProps {
  data: TripElevationPoint[];
  loading?: boolean;
  height?: number;
  activeElapsedS?: number | null;
  onActiveElapsedSChange?: (value: number | null) => void;
}

const M_TO_FT = 3.28084;

function formatElapsed(seconds: number) {
  const min = Math.floor(seconds / 60);
  const sec = Math.max(0, Math.floor(seconds % 60));
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function TripElevationChart({
  data,
  loading = false,
  height = 240,
  activeElapsedS = null,
  onActiveElapsedSChange,
}: TripElevationChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        Loading elevation chart...
      </div>
    );
  }

  const chartData = data.map((point) => ({
    elapsed_s: point.elapsed_s,
    altitude_ft: point.altitude_m != null ? point.altitude_m * M_TO_FT : null,
  }));

  const hasAnyData = chartData.some((point) => point.altitude_ft != null);
  if (!hasAnyData) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        No elevation profile data for this trip.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={chartData}
        margin={CHART_MARGINS.withYAxis}
        onMouseMove={(state) => {
          const payload = state?.activePayload?.[0]?.payload as TripElevationPoint | undefined;
          onActiveElapsedSChange?.(payload?.elapsed_s ?? null);
        }}
        onMouseLeave={() => onActiveElapsedSChange?.(null)}
      >
        <defs>
          <linearGradient id="tripElevationGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.dataViz.teal} stopOpacity={0.35} />
            <stop offset="95%" stopColor={colors.dataViz.teal} stopOpacity={0.03} />
          </linearGradient>
        </defs>
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
          tickFormatter={(value: number) => `${Math.round(value)}`}
          unit="ft"
          width={44}
        />
        <Tooltip
          content={<ChartTooltip
            labelFormatter={(value) => formatElapsed(Number(value))}
            formatter={(value) => [
              Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ft` : '—',
              'Elevation',
            ]}
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        {activeElapsedS != null ? (
          <ReferenceLine x={activeElapsedS} stroke={CHART_COLORS.muted} strokeDasharray="4 4" />
        ) : null}
        <Area
          type="monotone"
          dataKey="altitude_ft"
          name="Elevation"
          stroke={colors.dataViz.teal}
          strokeWidth={1.8}
          fill="url(#tripElevationGradient)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: colors.dataViz.teal }}
          isAnimationActive={false}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
