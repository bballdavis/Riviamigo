import React from 'react';
import { Icon } from '@iconify/react';
import { cn } from '@riviamigo/ui/lib/utils';
import { Card } from '@riviamigo/ui/primitives';
import { resolveIconId } from '../../editor/iconMigration';
import type { SensorIconKey, SensorValueColor } from './sensorDefinitions';

export interface SensorChipSummaryProps {
  title: string;
  value: string;
  icon?: SensorIconKey;
  secondary?: string;
  labelSuffix?: string;
  subtitle?: string;
  accentBorder?: boolean;
  valueColor?: SensorValueColor;
  valueSize?: 'sm' | 'md' | 'lg';
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
  valueSize = 'md',
}: SensorChipSummaryProps) {
  return (
    <Card
      padding="none"
      className={cn(
        'relative flex h-full min-h-[72px] flex-col overflow-hidden border p-3',
        accentBorder ? 'border-accent/60 shadow-[inset_0_0_0_1px_var(--rm-border-accent)]' : 'border-border'
      )}
      data-testid="sensor-chip"
    >
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
          <Icon icon={resolveIconId(icon)} className="h-4 w-4 shrink-0 text-accent" />
        </div>

        <div className="mt-1.5 flex items-baseline gap-1">
          <span
            className={cn(
              'font-mono font-semibold tabular-nums tracking-tight',
              valueColor === 'accent' ? 'text-accent' : 'text-fg',
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
