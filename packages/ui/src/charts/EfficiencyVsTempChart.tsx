import * as React from 'react';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { colors } from '../tokens/colors';
import { getUnitSystem, whPerMileToKmPerKwh, whPerMileToMiPerKwh } from '../lib/utils';

export interface EfficiencyVsTempPoint {
  temp_c_low: number;
  temp_c_high: number;
  avg_efficiency_wh_mi: number | null;
  trip_count: number;
}

export interface EfficiencyVsTempChartProps {
  data: EfficiencyVsTempPoint[];
  loading?: boolean;
  height?: number;
  unit?: 'c' | 'f';
}

function toF(c: number) {
  return Math.round(c * 9 / 5 + 32);
}

function barColor(efficiency: number): string {
  if (efficiency > 3.3) return colors.soc.high;
  if (efficiency > 2.6) return colors.soc.mid;
  return colors.soc.low;
}

export function EfficiencyVsTempChart({
  data,
  loading = false,
  height = 200,
  unit = 'f',
}: EfficiencyVsTempChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;
  const isMetric = getUnitSystem() === 'metric';
  const efficiencyUnit = isMetric ? 'km/kWh' : 'mi/kWh';

  const chartData = data.map((d) => ({
    ...d,
    label: unit === 'f'
      ? `${toF(d.temp_c_low)} F`
      : `${d.temp_c_low} C`,
    efficiency: isMetric ? whPerMileToKmPerKwh(d.avg_efficiency_wh_mi) : whPerMileToMiPerKwh(d.avg_efficiency_wh_mi),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={CHART_MARGINS.withYAxis}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          label={{ value: unit === 'f' ? 'F' : 'C', position: 'insideBottomRight', offset: 0, style: TICK_STYLE }}
        />
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}`}
          unit={` ${efficiencyUnit}`}
          width={52}
        />
        <Tooltip
          content={<ChartTooltip
            formatter={(v, _) => [
              typeof v === 'number' ? `${v.toFixed(1)} ${efficiencyUnit}` : '-',
              'Avg efficiency',
            ]}
          />}
          cursor={TOOLTIP_CURSOR_STYLE}
        />
        <Bar dataKey="efficiency" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {chartData.map((entry, idx) => (
            <Cell
              key={`cell-${idx}`}
              fill={entry.efficiency !== null ? barColor(entry.efficiency) : CHART_COLORS.muted}
              fillOpacity={0.8}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
