import * as React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { formatTemp } from '../lib/utils';
import { getActiveElapsedSFromChartState } from './TripChartSync';

export interface TripTemperaturePoint {
  elapsed_s: number;
  outside_temp_c: number | null;
  cabin_temp_c: number | null;
  driver_temp_c?: number | null;
  hvac_active?: boolean | null;
}

export interface TripTemperatureChartProps {
  data: TripTemperaturePoint[];
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

export function TripTemperatureChart({
  data,
  loading = false,
  height = 240,
  activeElapsedS = null,
  onActiveElapsedSChange,
}: TripTemperatureChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        Loading temperature chart...
      </div>
    );
  }

  const hasAnyData = data.some((point) => point.outside_temp_c != null || point.cabin_temp_c != null || point.driver_temp_c != null);
  if (!hasAnyData) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border bg-bg-elevated text-sm text-fg-tertiary" style={{ height }}>
        Outside temp unavailable for this trip.
      </div>
    );
  }

  const chartData = data.map((point) => ({
    ...point,
    hvac_on: point.hvac_active ? 1 : 0,
  }));

  const measuredData = React.useMemo(
    () => data.filter((point) => point.outside_temp_c != null || point.cabin_temp_c != null || point.driver_temp_c != null),
    [data],
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={chartData}
        syncId="trip-timeline-sync"
        syncMethod="value"
        margin={CHART_MARGINS.withYAxis}
        onMouseMove={(state) => {
          const nextElapsed = getActiveElapsedSFromChartState<TripTemperaturePoint>(
            state as Parameters<typeof getActiveElapsedSFromChartState>[0],
            measuredData,
            activeElapsedS,
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
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => formatTemp(value)}
          width={34}
        />
        <YAxis yAxisId="climate" domain={[0, 1]} hide />
        <Tooltip
          content={<ChartTooltip
            labelFormatter={(value) => formatElapsed(Number(value))}
            formatter={(value, name) => {
              if (name === 'outside_temp_c' || name === 'Outside Temp') return [formatTemp(Number(value)), 'Outside'];
              if (name === 'cabin_temp_c' || name === 'Cabin Temp') return [formatTemp(Number(value)), 'Cabin'];
              if (name === 'driver_temp_c' || name === 'Driver Setpoint') return [formatTemp(Number(value)), 'Driver Set'];
              if (name === 'hvac_on' || name === 'Climate On') return [Number(value) > 0 ? 'On' : 'Off', 'Climate'];
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
        {activeElapsedS != null ? (
          <ReferenceLine x={activeElapsedS} stroke={CHART_COLORS.muted} strokeDasharray="4 4" />
        ) : null}
        <Area
          yAxisId="climate"
          type="stepAfter"
          dataKey="hvac_on"
          name="Climate On"
          stroke="none"
          fill={CHART_COLORS.violet}
          fillOpacity={0.16}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="outside_temp_c"
          name="Outside Temp"
          stroke={CHART_COLORS.emerald}
          strokeWidth={1.8}
          dot={{ r: 2, strokeWidth: 0, fill: CHART_COLORS.emerald }}
          activeDot={{ r: 3.8, fill: CHART_COLORS.emerald, stroke: 'var(--rm-bg)', strokeWidth: 2 }}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="cabin_temp_c"
          name="Cabin Temp"
          stroke={CHART_COLORS.orange}
          strokeWidth={1.8}
          dot={{ r: 2, strokeWidth: 0, fill: CHART_COLORS.orange }}
          activeDot={{ r: 3.8, fill: CHART_COLORS.orange, stroke: 'var(--rm-bg)', strokeWidth: 2 }}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="driver_temp_c"
          name="Driver Setpoint"
          stroke={CHART_COLORS.yellow}
          strokeWidth={1.6}
          strokeDasharray="4 4"
          dot={{ r: 2, strokeWidth: 0, fill: CHART_COLORS.yellow }}
          activeDot={{ r: 3.8, fill: CHART_COLORS.yellow, stroke: 'var(--rm-bg)', strokeWidth: 2 }}
          isAnimationActive={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
