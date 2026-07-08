import React from 'react';
import { DASHBOARD_GRID_COLUMNS, DASHBOARD_ROW_HEIGHT } from './dashboardModel';
import { WidgetChrome } from './WidgetChrome';
import type { WidgetCtx } from './registry';
import type { WidgetInstance } from './schema';

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640
  );

  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

export interface DashboardGridProps {
  widgets: readonly WidgetInstance[];
  ctx: WidgetCtx;
}

export function DashboardGrid({ widgets, ctx }: DashboardGridProps) {
  const isMobile = useIsMobile();

  return (
    <div
      className="grid gap-4"
      data-dashboard-grid="view"
      style={isMobile ? {
        gridTemplateColumns: 'minmax(0, 1fr)',
        gridAutoRows: 'auto',
      } : {
        gridTemplateColumns: `repeat(${DASHBOARD_GRID_COLUMNS}, minmax(0, 1fr))`,
        gridAutoRows: `${DASHBOARD_ROW_HEIGHT}px`,
      }}
    >
      {widgets.map((widget) => {
        const mobileHeight = Math.min(widget.layout.h * DASHBOARD_ROW_HEIGHT, 480);
        const mobileStyle: React.CSSProperties = widget.componentType === 'chart'
          ? { height: `${mobileHeight}px` }
          : { minHeight: `${mobileHeight}px` };

        return (
          <div
            key={widget.id}
            data-widget-id={widget.id}
            data-widget-type={widget.componentType}
            data-widget-definition={widget.definitionId}
            style={isMobile ? mobileStyle : {
              gridColumn: `${widget.layout.x + 1} / span ${widget.layout.w}`,
              gridRow: `${widget.layout.y + 1} / span ${widget.layout.h}`,
            }}
          >
            <WidgetChrome instance={widget} ctx={ctx} mode="view" />
          </div>
        );
      })}
    </div>
  );
}
