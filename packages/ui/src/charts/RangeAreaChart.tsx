import * as React from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatMiles } from '../lib/utils';

export interface RangeDataPoint {
  ts: string;
  range_mi: number;
}

export interface RangeAreaChartProps {
  data: RangeDataPoint[];
  loading?: boolean;
  height?: number;
}

export function RangeAreaChart({
  data,
  loading = false,
  height = 200,
}: RangeAreaChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={CHART_MARGINS.withYAxis}>
        <defs>
          <linearGradient id="rangeGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={CHART_COLORS.accent} stopOpacity={0.2} />
            <stop offset="95%" stopColor={CHART_COLORS.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="ts"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => format(parseISO(v), 'M/d')}
          minTickGap={40}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}mi`}
          width={40}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v) => [formatMiles(v ?? 0), 'Range']} />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Area
          type="monotone"
          dataKey="range_mi"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          fill="url(#rangeGradient)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: '#0A0A0F' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
