import React, { Suspense, lazy } from 'react';
import type { DashboardConfig } from './schema';
import type { WidgetCtx } from './registry';
import { WidgetHost } from './WidgetHost';

const GridEditor = lazy(() => import('./GridEditor'));

/** Row height in pixels for the CSS grid. */
const ROW_HEIGHT = 40;

export interface DashboardRendererProps {
  config: DashboardConfig;
  ctx: WidgetCtx;
  mode?: 'view' | 'edit';
  onConfigChange?: (next: DashboardConfig) => void;
  editActions?: React.ReactNode;
}

export function DashboardRenderer({
  config,
  ctx,
  mode = 'view',
  onConfigChange,
  editActions,
}: DashboardRendererProps) {
  const widgets = Array.isArray(config.widgets) ? config.widgets : [];

  if (mode === 'edit') {
    return (
      <Suspense fallback={<div className="text-xs text-fg-tertiary p-4">Loading editor…</div>}>
        <GridEditor config={{ ...config, widgets }} ctx={ctx} onConfigChange={onConfigChange} editActions={editActions} />
      </Suspense>
    );
  }

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
        gridAutoRows: `${ROW_HEIGHT}px`,
      }}
    >
      {widgets.map((widget) => (
        <div
          key={widget.id}
          style={{
            gridColumn: `${widget.layout.x + 1} / span ${widget.layout.w}`,
            gridRow: `${widget.layout.y + 1} / span ${widget.layout.h}`,
          }}
        >
          <WidgetHost instance={widget} ctx={ctx} />
        </div>
      ))}
    </div>
  );
}
