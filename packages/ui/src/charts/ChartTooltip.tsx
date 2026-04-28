import * as React from 'react';

interface TooltipEntry {
  name: string;
  value: number | undefined;
  color?: string | undefined;
}

interface RechartTooltipRenderProps {
  active?: boolean | undefined;
  payload?: TooltipEntry[] | undefined;
  label?: string | number | undefined;
}

export interface ChartTooltipProps {
  title?: string | undefined;
  formatter?: (value: number | undefined, name: string) => [string, string];
}

export function ChartTooltip({
  active,
  payload,
  label,
  title,
  formatter,
}: RechartTooltipRenderProps & ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-border bg-bg-elevated/95 backdrop-blur-md shadow-lg px-3 py-2.5 text-xs min-w-[120px]">
      {(title ?? label) && (
        <p className="text-fg-tertiary mb-1.5 font-medium">{title ?? label}</p>
      )}
      {payload.map((entry) => {
        const [fmtValue, fmtName] = formatter
          ? formatter(entry.value, entry.name)
          : [`${entry.value ?? ''}`, entry.name];

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
