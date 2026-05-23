import * as React from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Brush,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';

export interface EfficiencyTrendPoint {
  day: string;
  day_avg_wh_mi: number | null;
  rolling_7d_wh_mi: number | null;
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
          dataKey="day"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => format(parseISO(v), 'MMM d')}
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
            labelFormatter={(v: string) => format(parseISO(v), 'MMM d, yyyy')}
            formatter={(v, name) => [
              v !== undefined ? `${v.toFixed(0)} Wh/mi` : '—',
              name === 'day_avg_wh_mi' ? 'Day avg' : '7-day avg',
            ]}
            multiLine
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />

        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: CHART_COLORS.muted, paddingTop: 8 }}
          formatter={(v) => v === 'day_avg_wh_mi' ? 'Daily' : '7-day avg'}
        />

        <Bar
          dataKey="day_avg_wh_mi"
          fill={CHART_COLORS.sky}
          fillOpacity={0.35}
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="rolling_7d_wh_mi"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
          connectNulls
        />

        {showBrush && (
          <Brush
            dataKey="day"
            height={28}
            stroke={CHART_COLORS.muted}
            tickFormatter={(v: string) => format(parseISO(v), 'MMM d')}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
