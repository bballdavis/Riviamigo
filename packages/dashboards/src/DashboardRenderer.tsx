import React, { Suspense, lazy } from 'react';
import type { DashboardConfig } from './schema';
import type { WidgetCtx } from './registry';
import { WidgetHost } from './WidgetHost';

const GridEditor = lazy(() => import('./GridEditor'));

/** Row height in pixels for the CSS grid. */
const ROW_HEIGHT = 40;

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640
  );
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

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

  const isMobile = useIsMobile();

  return (
    <div
      className="grid gap-4"
      style={isMobile ? {
        gridTemplateColumns: 'minmax(0, 1fr)',
        gridAutoRows: 'auto',
      } : {
        gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
        gridAutoRows: `${ROW_HEIGHT}px`,
      }}
    >
      {widgets.map((widget) => {
        const mobileHeight = Math.min(widget.layout.h * ROW_HEIGHT, 480);
        // Chart widgets need explicit height so h-full resolves through the flex chain.
        // Content-driven widgets (overview, tables) need minHeight so they can grow past config height.
        const mobileStyle = widget.componentType === 'chart'
          ? { height: `${mobileHeight}px` }
          : { minHeight: `${mobileHeight}px` };
        return (
        <div
          key={widget.id}
          style={isMobile ? mobileStyle : {
            gridColumn: `${widget.layout.x + 1} / span ${widget.layout.w}`,
            gridRow: `${widget.layout.y + 1} / span ${widget.layout.h}`,
          }}
        >
          <WidgetHost instance={widget} ctx={ctx} />
        </div>
        );
      })}
    </div>
  );
}
