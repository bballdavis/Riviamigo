import * as React from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatMph } from '../lib/utils';

export interface SpeedPoint {
  elapsed_s: number;
  speed_mph: number;
}

export interface SpeedProfileChartProps {
  data: SpeedPoint[];
  loading?: boolean;
  height?: number;
}

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec === 0 ? `${m}m` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function SpeedProfileChart({
  data,
  loading = false,
  height = 160,
}: SpeedProfileChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={CHART_MARGINS.withYAxis}>
        <defs>
          <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={CHART_COLORS.amber} stopOpacity={0.2} />
            <stop offset="95%" stopColor={CHART_COLORS.amber} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="elapsed_s"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatElapsed}
          minTickGap={40}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}`}
          width={28}
        />
        <Tooltip
          content={<ChartTooltip formatter={(v) => [formatMph(v ?? 0), 'Speed']} />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Area
          type="monotone"
          dataKey="speed_mph"
          stroke={CHART_COLORS.amber}
          strokeWidth={2}
          fill="url(#speedGradient)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: '#0A0A0F' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
