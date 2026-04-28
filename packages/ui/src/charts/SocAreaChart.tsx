import * as React from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatPercent } from '../lib/utils';

export interface SocDataPoint {
  ts: string;
  soc: number;
}

export interface SocAreaChartProps {
  data: SocDataPoint[];
  loading?: boolean;
  height?: number;
  showGrid?: boolean;
}

function socColor(soc: number): string {
  if (soc > 50) return CHART_COLORS.success;
  if (soc > 20) return CHART_COLORS.warning;
  return CHART_COLORS.danger;
}

export function SocAreaChart({
  data,
  loading = false,
  height = 200,
  showGrid = true,
}: SocAreaChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;

  const gradientId = 'socGradient';
  const latestSoc = data[data.length - 1]?.soc ?? 100;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={CHART_MARGINS.withYAxis}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={socColor(latestSoc)} stopOpacity={0.25} />
            <stop offset="95%" stopColor={socColor(latestSoc)} stopOpacity={0} />
          </linearGradient>
        </defs>

        {showGrid && (
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        )}

        <XAxis
          dataKey="ts"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => format(parseISO(v), 'h:mma').toLowerCase()}
          minTickGap={60}
        />
        <YAxis
          domain={[0, 100]}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
          width={36}
        />

        <Tooltip
          content={<ChartTooltip
            formatter={(v) => [formatPercent(v ?? 0, 0), 'SoC']}
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />

        <ReferenceLine y={20} stroke={CHART_COLORS.danger} strokeDasharray="4 4" strokeOpacity={0.4} />

        <Area
          type="monotone"
          dataKey="soc"
          stroke={socColor(latestSoc)}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: '#0A0A0F' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
