import * as React from 'react';
import type { TooltipProps } from 'recharts';

export interface ChartTooltipProps {
  title?: string;
  formatter?: (value: number, name: string) => [string, string];
}

/**
 * Custom Recharts tooltip with Riviamigo dark glass style.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  title,
  formatter,
}: TooltipProps<number, string> & ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-border bg-bg-elevated/95 backdrop-blur-md shadow-lg px-3 py-2.5 text-xs min-w-[120px]">
      {(title ?? label) && (
        <p className="text-fg-tertiary mb-1.5 font-medium">{title ?? label}</p>
      )}
      {payload.map((entry) => {
        const [fmtValue, fmtName] = formatter
          ? formatter(entry.value as number, entry.name as string)
          : [`${entry.value}`, entry.name as string];

        return (
          <div key={entry.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-fg-secondary">{fmtName}</span>
            </span>
            <span className="font-mono font-medium text-fg tabular-nums">{fmtValue}</span>
          </div>
        );
      })}
    </div>
  );
}
