/** One vehicle's maintenance as a compact tile: each item that fell due as a chip that shrinks to fit. */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Disc, Droplet, LifeBuoy, Wrench } from 'lucide-react';
import { CHART_COLORS } from '@riviamigo/ui/charts';
import { formatUsd, type VehicleLedger } from './model';
import { MAINTENANCE_ITEMS } from './ownershipCostColumns';

const MAINTENANCE_COLORS: Record<string, string> = {
  oil: CHART_COLORS.amber,
  brakes: CHART_COLORS.rose,
  tires: CHART_COLORS.violet,
  service: CHART_COLORS.sky,
};

const MAINTENANCE_ICONS: Record<string, React.ReactElement<{ className?: string }>> = {
  oil: <Droplet />,
  brakes: <Disc />,
  tires: <LifeBuoy />,
  service: <Wrench />,
};

/** How the maintenance chips fit their row: full labels, icons only, or (last resort) a second line. */
type ChipFit = 'full' | 'icons' | 'wrap';

/**
 * Maintenance as one full-width, compact tile under the main three: its
 * total on the right and a colored chip for each item that fell due. When
 * the labeled chips do not fit on one line they drop to icon and amount
 * first, and wrap only if even that does not fit.
 */
export function MaintenanceTile({ entry }: { entry: VehicleLedger }) {
  const due = MAINTENANCE_ITEMS.filter((column) => column.value(entry) > 0);
  const total = MAINTENANCE_ITEMS.reduce((sum, column) => sum + column.value(entry), 0);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<ChipFit>('full');
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  // Start from full labels whenever the row's width changes...
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([item]) => {
      const next = Math.round(item?.contentRect.width ?? 0);
      if (next === widthRef.current) return;
      widthRef.current = next;
      setFit('full');
      setWidth(next);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // ...then step down, before paint, until the chips fit on one line.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || fit === 'wrap') return;
    if (row.scrollWidth > row.clientWidth + 1) setFit(fit === 'full' ? 'icons' : 'wrap');
  }, [fit, width, due.length]);

  return (
    <div className="mt-2 flex min-w-0 items-center gap-1 rounded-lg bg-bg-elevated/70 px-2 py-2">
      <span className="mr-0.5 shrink-0 text-xs font-medium tracking-tight text-fg-secondary">Maintenance</span>
      <div
        ref={rowRef}
        className={`flex min-w-0 flex-1 items-center ${fit === 'full' ? 'gap-1.5' : 'gap-1'} ${fit === 'wrap' ? 'flex-wrap' : 'overflow-hidden'}`}
      >
        {due.length === 0 ? (
          <span className="text-sm text-fg-secondary">None due yet</span>
        ) : (
          due.map((column) => {
            const count = column.count?.(entry) ?? 0;
            const color = MAINTENANCE_COLORS[column.key] ?? CHART_COLORS.muted;
            const label = `${column.key === 'oil' && count <= 1 ? 'Oil change' : column.label}${count > 1 ? ` ×${count}` : ''}`;
            const icon = MAINTENANCE_ICONS[column.key];
            const iconOnly = fit !== 'full';
            return (
              <span
                key={column.key}
                title={iconOnly ? label : undefined}
                className={`inline-flex shrink-0 items-center rounded-md border py-0.5 text-sm ${iconOnly ? 'gap-0.5 px-1' : 'gap-1 px-1.5'}`}
                style={{ borderColor: color, backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)` }}
              >
                {icon ? (
                  <span aria-hidden style={{ color }}>
                    {React.cloneElement(icon, { className: 'h-3.5 w-3.5' })}
                  </span>
                ) : null}
                {iconOnly ? (
                  <>
                    <span className="sr-only">{label}</span>
                    {count > 1 ? <span className="text-xs font-semibold text-fg">×{count}</span> : null}
                  </>
                ) : (
                  <span className="font-medium text-fg">{label}</span>
                )}
                <span className="font-mono tabular-nums text-fg-secondary">{formatUsd(column.value(entry))}</span>
              </span>
            );
          })
        )}
      </div>
      <span className="shrink-0 pl-0.5 font-mono text-base font-semibold tabular-nums text-fg">{formatUsd(total)}</span>
    </div>
  );
}
