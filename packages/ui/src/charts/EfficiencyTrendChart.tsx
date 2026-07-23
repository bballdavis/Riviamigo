import * as React from 'react';
import {
  ResponsiveContainer, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Brush,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatAppDate, formatAppDateTime } from '../lib/dateTime';

export interface EfficiencyTrendPoint {
  ts: string;
  trip_efficiency_wh_mi: number | null;
  rolling_24h_wh_mi: number | null;
}

export interface EfficiencyTrendChartProps {
  data: EfficiencyTrendPoint[];
  loading?: boolean;
  height?: number;
  showBrush?: boolean;
}

export function EfficiencyTrendChart({
  data,
  loading = false,
  height = 220,
  showBrush = false,
}: EfficiencyTrendChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;

  return (
    <ResponsiveContainer width="100%" height={height + (showBrush ? 36 : 0)}>
      <ComposedChart data={data} margin={CHART_MARGINS.withYAxis}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />

        <XAxis
          dataKey="ts"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => formatAppDate(v, { month: 'short', day: 'numeric' })}
          minTickGap={40}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}`}
          unit=" Wh"
          width={52}
        />

        <Tooltip
          content={<ChartTooltip
            labelFormatter={(v: string) => formatAppDateTime(v)}
            formatter={(v, name) => [
              v !== undefined ? `${v.toFixed(0)} Wh/mi` : '—',
              name === 'trip_efficiency_wh_mi' ? 'Trip efficiency' : '24-hour avg',
            ]}
            multiLine
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />

        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted, paddingTop: 8 }}
          formatter={(v) => v === 'trip_efficiency_wh_mi' ? 'Trip efficiency' : '24-hour avg'}
        />

        <Line
          type="linear"
          dataKey="trip_efficiency_wh_mi"
          stroke={CHART_COLORS.sky}
          strokeWidth={1.5}
          dot={{ r: 2 }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="rolling_24h_wh_mi"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
          connectNulls
        />

        {showBrush && (
          <Brush
            dataKey="ts"
            height={28}
            stroke={CHART_COLORS.muted}
            tickFormatter={(v: string) => formatAppDate(v, { month: 'short', day: 'numeric' })}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
