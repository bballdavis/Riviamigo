import React from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@riviamigo/ui/lib/utils';
import { Card } from '@riviamigo/ui/primitives';
import {
  CHART_COLORS,
  MiniSparkline,
  type MiniSparklineYDomain,
  type TimeFilterWindow,
} from '@riviamigo/ui/charts';
import { resolveIconId } from '../../editor/iconMigration';
import type { SensorIconKey, SensorValueColor } from './sensorDefinitions';

type SensorChipHistoryPoint = { ts?: string; value: number | null | undefined };
type SensorValueTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface SensorChipSummaryProps {
  title: string;
  value: string;
  icon?: SensorIconKey;
  secondary?: string | undefined;
  labelSuffix?: string;
  subtitle?: string;
  accentBorder?: boolean;
  valueColor?: SensorValueColor;
  valueTone?: SensorValueTone;
  valueSize?: 'sm' | 'md' | 'lg';
  history?: SensorChipHistoryPoint[];
  historyColor?: string;
  historyDomain?: MiniSparklineYDomain;
  historyTimeFilter?: TimeFilterWindow;
}

export function SensorChipSummary({
  title,
  value,
  icon = 'lucide:activity',
  secondary,
  labelSuffix,
  subtitle,
  accentBorder = false,
  valueColor = 'accent',
  valueTone,
  valueSize = 'md',
  history,
  historyColor = CHART_COLORS.accent,
  historyDomain,
  historyTimeFilter,
}: SensorChipSummaryProps) {
  return (
    <Card
      padding="none"
      className={cn(
        'relative flex h-full min-h-[72px] flex-col overflow-hidden border p-3',
        accentBorder
          ? 'border-accent/60 shadow-[inset_0_0_0_1px_var(--rm-border-accent)]'
          : 'border-border'
      )}
      data-testid="sensor-chip"
    >
      {history?.length ? (
        <div
          className="pointer-events-none absolute h-9"
          style={{ left: 0, right: 0, bottom: 0, zIndex: 0, opacity: 0.82 }}
          data-testid="sensor-sprite-layer"
        >
          <MiniSparkline
            data={history}
            type="line"
            height={36}
            color={historyColor}
            showFallback
            {...(historyTimeFilter ? { timeFilter: historyTimeFilter } : {})}
            yDomain={historyDomain}
          />
          <div className="absolute inset-x-0 bottom-[2px] h-px bg-accent/35" aria-hidden="true" />
        </div>
      ) : null}
      <div className="relative z-10 flex flex-col flex-1 justify-center">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium uppercase tracking-wider text-fg-tertiary">
              {title}
              {labelSuffix ? (
                <span className="ml-1 text-[10px] font-normal normal-case tracking-normal">
                  ({labelSuffix})
                </span>
              ) : null}
            </p>
            {subtitle ? <p className="mt-1 truncate text-xs text-fg-tertiary">{subtitle}</p> : null}
          </div>
          <Icon
            icon={resolveIconId(icon)}
            className={cn(
              'h-4 w-4 shrink-0',
              valueTone === 'success'
                ? 'text-status-positive'
                : valueTone === 'warning'
                  ? 'text-status-warning'
                  : valueTone === 'danger'
                    ? 'text-status-danger'
                    : valueTone === 'info'
                      ? 'text-status-info'
                      : 'text-accent'
            )}
          />
        </div>

        <div className="mt-1.5 flex items-baseline gap-1">
          <span
            className={cn(
              'font-mono font-semibold tabular-nums tracking-tight',
              valueTone === 'success'
                ? 'text-status-positive'
                : valueTone === 'warning'
                  ? 'text-status-warning'
                  : valueTone === 'danger'
                    ? 'text-status-danger'
                    : valueTone === 'info'
                      ? 'text-status-info'
                      : valueColor === 'accent'
                        ? 'text-accent'
                        : 'text-fg',
              valueSize === 'sm' ? 'text-xl' : valueSize === 'lg' ? 'text-3xl' : 'text-2xl'
            )}
            style={{ textShadow: 'var(--rm-value-halo)' }}
          >
            {value}
          </span>
        </div>
        {secondary ? <p className="mt-0.5 truncate text-xs text-fg-tertiary">{secondary}</p> : null}
      </div>
    </Card>
  );
}
