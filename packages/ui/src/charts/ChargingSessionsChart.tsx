/**
 * ChargingSessionsChart — renders every charge session as a bar so you can
 * see at a glance when and how much you charged.  Clicking a bar (or its
 * corresponding row in the sessions table) selects the session and highlights
 * it on the chart.
 */
import * as React from 'react';
import {
  ResponsiveContainer, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { format } from 'date-fns';
import { CHART_COLORS, CHART_MARGINS, TICK_STYLE, TOOLTIP_CURSOR_STYLE } from './ChartProvider';
import { ChartSkeleton } from '../primitives/Skeleton';
import { formatKwh, formatDuration } from '../lib/utils';
import type { ChargeSession } from '@riviamigo/types';

export interface ChargingSessionsChartProps {
  sessions: ChargeSession[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  loading?: boolean;
  height?: number;
  title?: string;
}

interface BarDatum {
  id: string;
  ts: number;
  label: string;
  energy: number;
  duration: number | null;
  location: string | null;
  chargerType: string | null;
  peakKw: number | null;
}

function sessionColor(session: BarDatum, selectedId: string | null | undefined): string {
  if (session.id === selectedId) return CHART_COLORS.accent;
  if (session.chargerType === 'DC' || session.chargerType === 'dcfc') return '#f97316'; // orange for DC
  return CHART_COLORS.sky ?? '#38bdf8';
}

export function ChargingSessionsChart({
  sessions,
  selectedId,
  onSelect,
  loading = false,
  height = 220,
  title,
}: ChargingSessionsChartProps) {
  if (loading) return <ChartSkeleton className={`h-[${height}px]`} />;

  const data: BarDatum[] = [...sessions]
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
    .map((s) => ({
      id: s.id,
      ts: new Date(s.started_at).getTime(),
      label: format(new Date(s.started_at), 'MMM d, yyyy'),
      energy: s.energy_added_kwh ?? 0,
      duration: s.duration_min ?? null,
      location: s.location_name,
      chargerType: s.charger_type,
      peakKw: s.peak_power_kw,
    }));

  return (
    <div>
      {title ? (
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-tertiary">{title}</div>
      ) : null}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={CHART_MARGINS.withYAxis}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
          />
          <YAxis
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}kWh`}
            width={48}
          />
          <Tooltip
            cursor={TOOLTIP_CURSOR_STYLE}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as BarDatum;
              return (
                <div className="min-w-[160px] rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm shadow-lg">
                  <div className="font-semibold text-fg">{d.label}</div>
                  <div className="mt-1.5 space-y-0.5 text-fg-secondary">
                    <div>{formatKwh(d.energy)}</div>
                    {d.duration ? <div>{formatDuration(d.duration)}</div> : null}
                    {d.location ? <div>{d.location}</div> : null}
                    {d.chargerType ? <div>{d.chargerType}</div> : null}
                    {d.peakKw ? <div>Peak {d.peakKw.toFixed(1)} kW</div> : null}
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="energy"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            cursor="pointer"
            onClick={(d: BarDatum) => onSelect?.(d.id)}
          >
            {data.map((entry) => (
              <Cell
                key={entry.id}
                fill={sessionColor(entry, selectedId)}
                fillOpacity={entry.id === selectedId ? 1 : 0.7}
                stroke={entry.id === selectedId ? 'white' : 'none'}
                strokeWidth={entry.id === selectedId ? 1.5 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center gap-4 text-[10px] text-fg-tertiary">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#38bdf8]" />AC / Home</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#f97316]" />DC / Fast</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: CHART_COLORS.accent }} />Selected</span>
      </div>
    </div>
  );
}
