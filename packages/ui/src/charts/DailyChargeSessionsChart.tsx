import * as React from 'react';
import { ChartSkeleton } from '../primitives/Skeleton';
import { CHART_COLORS, CHART_FONT } from './ChartProvider';
import { formatSmartNumber } from '../lib/utils';

export interface DailyChargeSessionsDay {
  day_local: string;
  day_start: string;
  total_energy_kwh: number;
  session_count: number;
}

export interface DailyChargeSessionsSession {
  session_id: string;
  day_local: string;
  day_start: string;
  started_at: string;
  energy_added_kwh: number | null;
  charger_type: string | null;
  location_name: string | null;
}

export interface DailyChargeSessionsChartProps {
  daily: DailyChargeSessionsDay[];
  dailySessions: DailyChargeSessionsSession[];
  height?: number;
  loading?: boolean;
  emptyTitle?: string | undefined;
}

const STACK_COLORS = [
  CHART_COLORS.accent,
  CHART_COLORS.emerald,
  CHART_COLORS.amber,
  CHART_COLORS.sky,
  CHART_COLORS.violet,
  CHART_COLORS.rose,
  CHART_COLORS.teal,
  CHART_COLORS.indigo,
];

function formatDayLabel(dayStart: string, dayLocal: string) {
  const parsed = Number.isNaN(new Date(dayStart).getTime()) ? new Date(`${dayLocal}T00:00:00Z`) : new Date(dayStart);
  return parsed.toLocaleString([], { month: 'short', day: 'numeric' });
}

function formatEnergy(value: number) {
  return `${formatSmartNumber(value, Math.abs(value) >= 100 ? 0 : 1)} kWh`;
}

export function DailyChargeSessionsChart({
  daily,
  dailySessions,
  height = 280,
  loading = false,
  emptyTitle = 'No charging sessions for this period',
}: DailyChargeSessionsChartProps) {
  if (loading) {
    return <ChartSkeleton height={height} />;
  }

  const days = daily
    .map((day) => {
      const sessions = dailySessions
        .filter((session) => session.day_local === day.day_local)
        .sort((left, right) => new Date(left.started_at).getTime() - new Date(right.started_at).getTime());

      const totalEnergyKwh = day.total_energy_kwh > 0
        ? day.total_energy_kwh
        : sessions.reduce((sum, session) => sum + Math.max(0, session.energy_added_kwh ?? 0), 0);

      return {
        ...day,
        totalEnergyKwh,
        sessions,
      };
    })
    .filter((day) => day.totalEnergyKwh > 0 || day.sessions.length > 0);

  if (days.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-tertiary"
        style={{ height }}
      >
        {emptyTitle}
      </div>
    );
  }

  const width = 960;
  const chartHeight = Math.max(220, height);
  const margin = { top: 20, right: 20, bottom: 64, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;
  const maxEnergy = Math.max(1, ...days.map((day) => day.totalEnergyKwh));
  const slotWidth = innerWidth / Math.max(days.length, 1);
  const barWidth = Math.min(78, slotWidth * 0.66);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-3">
      <svg
        aria-label="Daily charge sessions"
        role="img"
        viewBox={`0 0 ${width} ${chartHeight}`}
        width="100%"
        height={chartHeight}
        data-testid="daily-charge-sessions-chart"
      >
        {yTicks.map((fraction) => {
          const y = margin.top + innerHeight - fraction * innerHeight;
          const value = maxEnergy * fraction;
          return (
            <g key={`grid-${fraction}`}>
              <line x1={margin.left} y1={y} x2={width - margin.right} y2={y} stroke={CHART_COLORS.grid} strokeWidth={1} />
              <text
                x={margin.left - 12}
                y={y + 4}
                textAnchor="end"
                fill={CHART_COLORS.muted}
                fontFamily={CHART_FONT.fontFamily}
                fontSize={CHART_FONT.fontSize}
                fontWeight={CHART_FONT.fontWeight}
              >
                {formatSmartNumber(value, value >= 100 ? 0 : 1)}
              </text>
            </g>
          );
        })}

        {days.map((day, dayIndex) => {
          const x = margin.left + slotWidth * dayIndex + (slotWidth - barWidth) / 2;
          let runningHeight = 0;
          const totalLabelY = margin.top + innerHeight - (day.totalEnergyKwh / maxEnergy) * innerHeight - 8;

          return (
            <g key={day.day_local} data-testid="daily-charge-stack">
              {day.sessions.map((session, sessionIndex) => {
                const energy = Math.max(0, session.energy_added_kwh ?? 0);
                const segmentHeight = day.totalEnergyKwh > 0
                  ? (energy / maxEnergy) * innerHeight
                  : 0;
                const y = margin.top + innerHeight - runningHeight - segmentHeight;
                runningHeight += segmentHeight;
                const color = STACK_COLORS[(sessionIndex + dayIndex) % STACK_COLORS.length] ?? CHART_COLORS.accent;

                return (
                  <g key={session.session_id} data-testid="daily-charge-segment">
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={Math.max(segmentHeight, energy > 0 ? 2 : 0)}
                      rx={sessionIndex === day.sessions.length - 1 ? 6 : 0}
                      fill={color}
                      opacity={0.92}
                    >
                      <title>
                        {`${formatDayLabel(day.day_start, day.day_local)}: ${formatEnergy(energy)}${session.location_name ? ` at ${session.location_name}` : ''}`}
                      </title>
                    </rect>
                  </g>
                );
              })}
              <text
                x={x + barWidth / 2}
                y={Math.max(margin.top + 10, totalLabelY)}
                textAnchor="middle"
                fill={CHART_COLORS.muted}
                fontFamily={CHART_FONT.fontFamily}
                fontSize={CHART_FONT.fontSize}
                fontWeight={700}
              >
                {formatSmartNumber(day.totalEnergyKwh, day.totalEnergyKwh >= 100 ? 0 : 1)}
              </text>
              <text
                x={x + barWidth / 2}
                y={chartHeight - 28}
                textAnchor="middle"
                fill={CHART_COLORS.muted}
                fontFamily={CHART_FONT.fontFamily}
                fontSize={CHART_FONT.fontSize}
                fontWeight={CHART_FONT.fontWeight}
              >
                {formatDayLabel(day.day_start, day.day_local)}
              </text>
            </g>
          );
        })}

        <text
          x={24}
          y={margin.top + innerHeight / 2}
          fill={CHART_COLORS.muted}
          fontFamily={CHART_FONT.fontFamily}
          fontSize={CHART_FONT.fontSize + 1}
          fontWeight={700}
          textAnchor="middle"
          transform={`rotate(-90 24 ${margin.top + innerHeight / 2})`}
        >
          Energy charged (kWh)
        </text>
      </svg>
    </div>
  );
}
