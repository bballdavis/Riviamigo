import * as React from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Brush,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatPercent } from '../lib/utils';
import { colors } from '../tokens/colors';

export interface SocDataPoint {
  ts: string;
  soc: number;
}

export interface SocAreaChartProps {
  data: SocDataPoint[];
  loading?: boolean;
  height?: number;
  showGrid?: boolean;
  showBrush?: boolean;
  showChargeLimit?: number;
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
  showBrush = false,
  showChargeLimit,
}: SocAreaChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;

  const gradientId = 'socGradient';
  const latestSoc = data[data.length - 1]?.soc ?? 100;
  const color = socColor(latestSoc);

  const brushHeight = showBrush ? 36 : 0;
  const totalHeight = height + brushHeight;

  return (
    <ResponsiveContainer width="100%" height={totalHeight}>
      <AreaChart data={data} margin={CHART_MARGINS.withYAxis}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
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
          tickFormatter={(v: string) => format(parseISO(v), 'MMM d')}
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
            labelFormatter={(v: string) => format(parseISO(v), 'MMM d, h:mma')}
            formatter={(v) => [formatPercent(v ?? 0, 0), 'SoC']}
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />

        <ReferenceLine y={20} stroke={CHART_COLORS.danger} strokeDasharray="4 4" strokeOpacity={0.4} />
        {showChargeLimit !== undefined && (
          <ReferenceLine y={showChargeLimit} stroke={CHART_COLORS.warning} strokeDasharray="4 4" strokeOpacity={0.5} />
        )}

        <Area
          type="monotone"
          dataKey="soc"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: colors.slate[950] }}
          isAnimationActive={false}
        />

        {showBrush && (
          <Brush
            dataKey="ts"
            height={28}
            stroke={colors.slate[700]}
            fill={colors.slate[900]}
            travellerWidth={6}
            tickFormatter={(v: string) => format(parseISO(v), 'MMM d')}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
