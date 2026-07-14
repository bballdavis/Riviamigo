import * as React from 'react';
import { ChartSkeleton } from '../primitives/Skeleton';
import { CHART_BAR_STYLE, CHART_COLORS, CHART_FONT } from './ChartProvider';
import { formatCurrency, formatSmartNumber } from '../lib/utils';

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
  cost_usd: number | null;
  charger_type: string | null;
  location_name: string | null;
}

export interface DailyChargeSessionsChartProps {
  daily: DailyChargeSessionsDay[];
  dailySessions: DailyChargeSessionsSession[];
  height?: number;
  loading?: boolean;
  emptyTitle?: string | undefined;
  selectedDayLocal?: string | null;
  onDayClick?: (dayLocal: string | null) => void;
}

export interface DailyEnergyBarChartProps {
  daily: DailyChargeSessionsDay[];
  height?: number;
  loading?: boolean;
  emptyTitle?: string | undefined;
  yRange?: [number, number] | undefined;
}

export interface DailyChargingBarChartProps extends Omit<DailyChargeSessionsChartProps, 'dailySessions'> {
  dailySessions?: DailyChargeSessionsSession[];
  variant: 'total' | 'stacked';
  yRange?: [number, number] | undefined;
}

type ChargerGroupKey = 'ac' | 'dc' | 'unknown';

interface ChargerGroupMeta {
  key: ChargerGroupKey;
  label: string;
  color: string;
}

interface ChargerGroup {
  key: ChargerGroupKey;
  label: string;
  color: string;
  energyKwh: number;
  costUsd: number | null;
  sessionCount: number;
  sessions: DailyChargeSessionsSession[];
}

interface PreparedDay extends DailyChargeSessionsDay {
  totalEnergyKwh: number;
  groups: ChargerGroup[];
}

interface HoverState {
  dayLocal: string;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
}

const GROUP_ORDER: ChargerGroupKey[] = ['ac', 'dc', 'unknown'];

const GROUP_META: Record<ChargerGroupKey, ChargerGroupMeta> = {
  ac: {
    key: 'ac',
    label: 'AC',
    color: CHART_COLORS.emerald,
  },
  dc: {
    key: 'dc',
    label: 'DC',
    color: CHART_COLORS.amber,
  },
  unknown: {
    key: 'unknown',
    label: 'Unknown',
    color: CHART_COLORS.muted,
  },
};

function formatDayLabel(dayStart: string, dayLocal: string) {
  const parsed = Number.isNaN(new Date(dayStart).getTime()) ? new Date(`${dayLocal}T00:00:00Z`) : new Date(dayStart);
  return parsed.toLocaleString([], { month: 'short', day: 'numeric' });
}

function formatEnergy(value: number) {
  return `${formatSmartNumber(value, Math.abs(value) >= 100 ? 0 : 1)} kWh`;
}

function normalizeChargerType(chargerType: string | null | undefined): ChargerGroupKey {
  const normalized = chargerType?.trim().toLowerCase();
  if (normalized === 'ac' || normalized === 'ac_l2') return 'ac';
  if (normalized === 'dc' || normalized === 'dcfc') return 'dc';
  return 'unknown';
}

function formatSessionCount(count: number) {
  return `${count} session${count === 1 ? '' : 's'}`;
}

function nextAxisMax(value: number) {
  if (value <= 0) return 1;
  return Math.ceil(value / 100) * 100;
}

export function DailyChargingBarChart({
  daily,
  dailySessions = [],
  height = 280,
  loading = false,
  emptyTitle = 'No charging sessions for this period',
  selectedDayLocal,
  onDayClick,
  variant,
  yRange,
}: DailyChargingBarChartProps) {
  const chartRef = React.useRef<HTMLDivElement | null>(null);
  const [hoverState, setHoverState] = React.useState<HoverState | null>(null);
  const clipPathPrefix = React.useId().replace(/:/g, '');

  const days = React.useMemo<PreparedDay[]>(() => {
    return daily
      .map((day) => {
        const sessions = dailySessions
          .filter((session) => session.day_local === day.day_local)
          .sort((left, right) => new Date(left.started_at).getTime() - new Date(right.started_at).getTime());

        const totalEnergyKwh = day.total_energy_kwh > 0
          ? day.total_energy_kwh
          : sessions.reduce((sum, session) => sum + Math.max(0, session.energy_added_kwh ?? 0), 0);

        const groupsByKey = new Map<ChargerGroupKey, ChargerGroup>();
        for (const session of sessions) {
          const groupKey = normalizeChargerType(session.charger_type);
          const meta = GROUP_META[groupKey];
          const current = groupsByKey.get(groupKey);
          const energy = Math.max(0, session.energy_added_kwh ?? 0);
          const cost = Number.isFinite(session.cost_usd) ? session.cost_usd : null;
          if (current) {
            current.energyKwh += energy;
            if (cost != null) current.costUsd = (current.costUsd ?? 0) + cost;
            current.sessionCount += 1;
            current.sessions.push(session);
          } else {
            groupsByKey.set(groupKey, {
              key: groupKey,
              label: meta.label,
              color: meta.color,
              energyKwh: energy,
              costUsd: cost,
              sessionCount: 1,
              sessions: [session],
            });
          }
        }

        const groups = GROUP_ORDER
          .map((key) => groupsByKey.get(key))
          .filter((group): group is ChargerGroup => group != null && (group.energyKwh > 0 || group.sessionCount > 0));

        return {
          ...day,
          totalEnergyKwh,
          groups,
        };
      })
      .filter((day) => day.totalEnergyKwh > 0 || day.groups.length > 0);
  }, [daily, dailySessions]);

  const legendItems = React.useMemo(() => {
    const presentKeys = new Set<ChargerGroupKey>();
    for (const day of days) {
      for (const group of day.groups) {
        presentKeys.add(group.key);
      }
    }

    if (variant !== 'stacked') return [];

    return GROUP_ORDER
      .filter((key) => presentKeys.has(key))
      .map((key) => GROUP_META[key]);
  }, [days, variant]);

  const activeDay = React.useMemo(
    () => (hoverState ? days.find((day) => day.day_local === hoverState.dayLocal) ?? null : null),
    [days, hoverState],
  );

  const setDayHoverFromEvent = React.useCallback(
    (dayLocal: string, event: React.MouseEvent<SVGElement> | React.PointerEvent<SVGElement>) => {
      const bounds = chartRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      setHoverState({
        dayLocal,
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        containerWidth: bounds.width,
        containerHeight: bounds.height,
      });
    },
    [],
  );

  const isDaySelected = React.useCallback(
    (dayLocal: string) => selectedDayLocal != null && selectedDayLocal === dayLocal,
    [selectedDayLocal],
  );

  const handleDaySelect = React.useCallback(
    (dayLocal: string) => {
      if (!onDayClick) return;
      onDayClick(isDaySelected(dayLocal) ? null : dayLocal);
    },
    [isDaySelected, onDayClick],
  );

  if (loading) {
    return <ChartSkeleton height={height} />;
  }

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
  const margin = { top: 20, right: 24, bottom: 64, left: 70 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;
  const maxEnergy = Math.max(1, ...days.map((day) => day.totalEnergyKwh));
  const axisMinEnergy = Math.min(0, yRange?.[0] ?? 0);
  const axisMaxEnergy = Math.max(
    axisMinEnergy + 1,
    maxEnergy,
    yRange?.[1] ?? nextAxisMax(maxEnergy),
  );
  const axisSpan = axisMaxEnergy - axisMinEnergy;
  const topPaddingPx = 8;
  const renderHeight = Math.max(1, innerHeight - topPaddingPx);
  const slotWidth = innerWidth / Math.max(days.length, 1);
  const barWidth = Math.min(CHART_BAR_STYLE.maxWidth, slotWidth * CHART_BAR_STYLE.slotRatio);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const tooltipHeight = activeDay
    ? variant === 'stacked'
      ? 96 + activeDay.groups.length * 28 + activeDay.groups.reduce((sum, group) => sum + Math.max(0, group.sessions.length - 1) * 6, 0)
      : 74
    : 0;
  const tooltipWidth = 288;

  return (
    <div ref={chartRef} className="relative rounded-lg border border-border bg-bg-surface p-3 shadow-[inset_0_-1px_0_var(--rm-border)]">
      {legendItems.length > 0 ? (
        <div className="pointer-events-none absolute right-3 top-3 z-20 flex flex-wrap justify-end gap-2 rounded-full border border-border bg-bg-surface/95 px-2 py-1 text-[11px] text-fg-secondary shadow-sm backdrop-blur">
          {legendItems.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </span>
          ))}
        </div>
      ) : null}

      {activeDay && hoverState ? (
        <div
          role="tooltip"
          aria-live="polite"
          className="pointer-events-none absolute z-30 w-72 rounded-lg border border-border bg-bg-surface/95 px-3 py-2 text-[11px] text-fg shadow-lg backdrop-blur"
          style={{
            left: Math.min(
              Math.max(hoverState.x + 14, 8),
              Math.max(8, hoverState.containerWidth - tooltipWidth - 8),
            ),
            top: Math.min(
              Math.max(hoverState.y + 14, 8),
              Math.max(8, hoverState.containerHeight - tooltipHeight - 8),
            ),
          }}
        >
          <div className="mb-1 font-medium text-fg">{formatDayLabel(activeDay.day_start, activeDay.day_local)}</div>
          {variant === 'stacked' ? (
            <>
              <div className="mb-2 text-fg-tertiary">
                {formatEnergy(activeDay.totalEnergyKwh)} total, {formatSessionCount(activeDay.groups.reduce((sum, group) => sum + group.sessionCount, 0))}
              </div>
              <div className="space-y-1">
                {activeDay.groups.map((group) => {
                  return (
                    <div key={group.key} className="flex items-start gap-2">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: group.color }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="text-fg">
                          <span className="font-medium text-fg">{group.label}</span>
                          {group.costUsd != null ? <span className="text-fg-tertiary"> · {formatCurrency(group.costUsd)}</span> : null}
                          <span className="text-fg-tertiary"> {formatEnergy(group.energyKwh)}</span>
                        </div>
                        <div className="text-fg-tertiary">
                          {formatSessionCount(group.sessionCount)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-fg-tertiary">Energy Charged: {formatEnergy(activeDay.totalEnergyKwh)}</div>
          )}
        </div>
      ) : null}

      <svg
        aria-label={variant === 'stacked' ? 'Daily charge sessions' : 'Daily energy charged'}
        role="img"
        viewBox={`0 0 ${width} ${chartHeight}`}
        width="100%"
        height={chartHeight}
        data-testid={variant === 'stacked' ? 'daily-charge-sessions-chart' : 'daily-energy-chart'}
      >
        <defs>
          {days.map((day, dayIndex) => {
            const x = margin.left + slotWidth * dayIndex + (slotWidth - barWidth) / 2;
            const barHeight = (day.totalEnergyKwh / axisSpan) * renderHeight;
            if (barHeight <= 0) return null;
            const y = margin.top + innerHeight - barHeight;
            const clipId = `${clipPathPrefix}-daily-charge-stack-${dayIndex}`;
            return (
              <clipPath key={clipId} id={clipId}>
                <rect x={x} y={y} width={barWidth} height={barHeight} rx={8} ry={8} />
              </clipPath>
            );
          })}
        </defs>

        {yTicks.map((fraction) => {
          const y = margin.top + innerHeight - fraction * innerHeight;
          const value = axisMinEnergy + axisSpan * fraction;
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
          const barHeight = (day.totalEnergyKwh / axisSpan) * renderHeight;
          const clippedBarHeight = Math.max(0, barHeight);
          const clipId = `${clipPathPrefix}-daily-charge-stack-${dayIndex}`;
          const isActive = hoverState?.dayLocal === day.day_local;
          const totalLabelY = margin.top + innerHeight - (day.totalEnergyKwh / axisSpan) * renderHeight - 8;
          const sessionCount = day.groups.reduce((sum, group) => sum + group.sessionCount, 0);
          const isSelected = isDaySelected(day.day_local);

          return (
            <g key={day.day_local}>
              <g data-testid="daily-charge-stack">
                <rect
                  x={x}
                  y={margin.top + innerHeight - clippedBarHeight}
                  width={barWidth}
                  height={clippedBarHeight}
                  fill="transparent"
                  pointerEvents="all"
                  role="button"
                  tabIndex={0}
                  onPointerEnter={(event) => setDayHoverFromEvent(day.day_local, event)}
                  onPointerMove={(event) => setDayHoverFromEvent(day.day_local, event)}
                  onPointerDown={(event) => setDayHoverFromEvent(day.day_local, event)}
                  onPointerLeave={() => setHoverState((current) => (current?.dayLocal === day.day_local ? null : current))}
                  onMouseEnter={(event) => setDayHoverFromEvent(day.day_local, event)}
                  onMouseMove={(event) => setDayHoverFromEvent(day.day_local, event)}
                  onMouseLeave={() => setHoverState((current) => (current?.dayLocal === day.day_local ? null : current))}
                  onClick={() => handleDaySelect(day.day_local)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    handleDaySelect(day.day_local);
                  }}
                  aria-label={variant === 'stacked'
                    ? `${formatDayLabel(day.day_start, day.day_local)}: ${formatEnergy(day.totalEnergyKwh)} across ${formatSessionCount(sessionCount)}`
                    : `${formatDayLabel(day.day_start, day.day_local)}: ${formatEnergy(day.totalEnergyKwh)} energy charged`}
                  className={onDayClick ? 'cursor-pointer' : undefined}
                />
                <g clipPath={`url(#${clipId})`} opacity={isActive || isSelected ? CHART_BAR_STYLE.activeOpacity : CHART_BAR_STYLE.fillOpacity}>
                {variant === 'stacked' ? day.groups.map((group, groupIndex) => {
                  const segmentHeight = day.totalEnergyKwh > 0
                    ? (group.energyKwh / axisSpan) * renderHeight
                    : 0;
                  if (segmentHeight <= 0) return null;

                  const y = margin.top + innerHeight - clippedBarHeight
                    + day.groups
                      .slice(0, groupIndex)
                      .reduce((sum, candidate) => sum + (day.totalEnergyKwh > 0 ? (candidate.energyKwh / axisSpan) * renderHeight : 0), 0);

                  return (
                    <rect
                      key={`${day.day_local}-${group.key}`}
                      data-testid="daily-charge-segment"
                      data-group-key={group.key}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={Math.max(segmentHeight, group.energyKwh > 0 ? 2 : 0)}
                      fill={group.color}
                      pointerEvents="none"
                    />
                  );
                }) : (
                  <rect
                    data-testid="daily-energy-bar"
                    x={x}
                    y={margin.top + innerHeight - clippedBarHeight}
                    width={barWidth}
                    height={clippedBarHeight}
                    fill={CHART_COLORS.accent}
                    pointerEvents="none"
                  />
                )}
                </g>
              </g>
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

export function DailyChargeSessionsChart(props: DailyChargeSessionsChartProps) {
  return <DailyChargingBarChart {...props} variant="stacked" />;
}

export function DailyEnergyBarChart({
  daily,
  height,
  loading,
  emptyTitle = 'No charging energy for this period',
  yRange,
}: DailyEnergyBarChartProps) {
  return (
    <DailyChargingBarChart
      daily={daily}
      emptyTitle={emptyTitle}
      variant="total"
      {...(height !== undefined ? { height } : {})}
      {...(loading !== undefined ? { loading } : {})}
      {...(yRange !== undefined ? { yRange } : {})}
    />
  );
}
