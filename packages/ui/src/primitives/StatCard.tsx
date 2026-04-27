import * as React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card } from './Card';

export interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number;
  deltaLabel?: string;
  icon?: React.ReactNode;
  accent?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  icon,
  accent = false,
  className,
}: StatCardProps) {
  const hasDelta = delta !== undefined;
  const isPositive = (delta ?? 0) > 0;
  const isNeutral = delta === 0;

  return (
    <Card
      className={cn(
        accent && 'border-accent/30 shadow-glow-sm',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-fg-tertiary uppercase tracking-wider">{label}</p>
        {icon && (
          <span className={cn('text-fg-tertiary', accent && 'text-accent')}>
            {icon}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-1">
        <span className={cn(
          'text-2xl font-semibold font-mono tabular-nums tracking-tight',
          accent ? 'text-accent' : 'text-fg'
        )}>
          {value}
        </span>
        {unit && <span className="text-sm text-fg-tertiary">{unit}</span>}
      </div>

      {hasDelta && (
        <div className={cn(
          'mt-2 flex items-center gap-1 text-xs font-medium',
          isNeutral ? 'text-fg-tertiary' : isPositive ? 'text-[#10B981]' : 'text-[#F87171]'
        )}>
          {isNeutral ? (
            <Minus className="h-3 w-3" />
          ) : isPositive ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          <span>
            {isPositive ? '+' : ''}{delta}
            {deltaLabel && ` ${deltaLabel}`}
          </span>
        </div>
      )}
    </Card>
  );
}
