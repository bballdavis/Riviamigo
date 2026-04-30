import * as React from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Brush,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { colors } from '../tokens/colors';

export interface DegradationPoint {
  ts: string;
  usable_kwh: number;
  rated_kwh: number | null;
  capacity_pct: number;
}

export interface DegradationChartProps {
  data: DegradationPoint[];
  ratedKwh?: number;
  loading?: boolean;
  height?: number;
  showBrush?: boolean;
}

export function DegradationChart({
  data,
  ratedKwh,
  loading = false,
  height = 220,
  showBrush = false,
}: DegradationChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;

  const latestPct = data[data.length - 1]?.capacity_pct ?? 100;
  const color = latestPct > 95 ? CHART_COLORS.success
    : latestPct > 88 ? CHART_COLORS.warning
    : CHART_COLORS.danger;

  return (
    <ResponsiveContainer width="100%" height={height + (showBrush ? 36 : 0)}>
      <AreaChart data={data} margin={CHART_MARGINS.withYAxis}>
        <defs>
          <linearGradient id="degradGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.2} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />

        <XAxis
          dataKey="ts"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => format(parseISO(v), 'MMM yyyy')}
          minTickGap={60}
        />
        <YAxis
          domain={[80, 100]}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
          width={36}
        />

        <Tooltip
          content={<ChartTooltip
            labelFormatter={(v: string) => format(parseISO(v), 'MMM d, yyyy')}
            formatter={(v, name) => {
              if (name === 'capacity_pct') return [`${(v ?? 0).toFixed(1)}%`, 'Capacity'];
              return [`${(v ?? 0).toFixed(1)} kWh`, 'Usable'];
            }}
            multiLine
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />

        <ReferenceLine y={95} stroke={CHART_COLORS.muted} strokeDasharray="3 3" strokeOpacity={0.4} />
        <ReferenceLine y={90} stroke={CHART_COLORS.warning} strokeDasharray="3 3" strokeOpacity={0.35} />

        <Area
          type="monotone"
          dataKey="capacity_pct"
          stroke={color}
          strokeWidth={2}
          fill="url(#degradGradient)"
          dot={{ r: 3, fill: color, strokeWidth: 0 }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: colors.slate[950] }}
          isAnimationActive={false}
        />
        {showBrush && (
          <Brush
            dataKey="ts"
            height={28}
            stroke={CHART_COLORS.muted}
            tickFormatter={(v: string) => format(parseISO(v), 'MMM yyyy')}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
