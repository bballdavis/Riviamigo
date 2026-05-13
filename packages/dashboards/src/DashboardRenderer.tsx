import React, { Suspense, lazy } from 'react';
import { useAuth, useCurrentVehicleStatus } from '@riviamigo/hooks';
import type { VehicleStatus } from '@riviamigo/types';
import type { DashboardConfig } from './schema';
import type { WidgetCtx } from './registry';
import { WidgetHost } from './WidgetHost';

const GridEditor = lazy(() => import('./GridEditor'));

/** Row height in pixels for the CSS grid. */
const ROW_HEIGHT = 40;
const CHARGING_CONNECTION_VISIBILITY_OPTION = 'chargingConnectionVisibility';

type ChargingConnectionVisibility = 'plugged' | 'unplugged';

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

  return <DashboardGrid config={config} widgets={widgets} ctx={ctx} />;
}

function DashboardGrid({
  config,
  widgets,
  ctx,
}: {
  config: DashboardConfig;
  widgets: DashboardConfig['widgets'];
  ctx: WidgetCtx;
}) {
  const hasChargingSwap = widgets.some((widget) => getChargingConnectionVisibility(widget));

  if (config.slug === 'charging' && hasChargingSwap) {
    return <ChargingConnectionSwapGrid widgets={widgets} ctx={ctx} />;
  }

  return <WidgetGrid widgets={widgets} ctx={ctx} />;
}

function ChargingConnectionSwapGrid({
  widgets,
  ctx,
}: {
  widgets: DashboardConfig['widgets'];
  ctx: WidgetCtx;
}) {
  const { defaultVehicleId } = useAuth();
  const vehicleId = ctx.vehicleId ?? defaultVehicleId;
  const { data: status } = useCurrentVehicleStatus(vehicleId);
  const pluggedIn = isPluggedIn(status);
  const visibleWidgets = widgets.filter((widget) => {
    const visibility = getChargingConnectionVisibility(widget);
    if (visibility === 'plugged') return pluggedIn;
    if (visibility === 'unplugged') return !pluggedIn;
    return true;
  });

  return <WidgetGrid widgets={expandUnpluggedChargingMixRow(visibleWidgets, pluggedIn)} ctx={ctx} />;
}

function expandUnpluggedChargingMixRow(
  widgets: DashboardConfig['widgets'],
  pluggedIn: boolean,
): DashboardConfig['widgets'] {
  if (pluggedIn) return widgets;

  return widgets.map((widget) => {
    if (widget.componentType === 'charging' && widget.definitionId === 'home_share') {
      return { ...widget, layout: { ...widget.layout, x: 0, w: 6 } };
    }
    if (widget.componentType === 'charging' && widget.definitionId === 'dc_share') {
      return { ...widget, layout: { ...widget.layout, x: 6, w: 6 } };
    }
    return widget;
  });
}

function WidgetGrid({
  widgets,
  ctx,
}: {
  widgets: DashboardConfig['widgets'];
  ctx: WidgetCtx;
}) {
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
          data-widget-id={widget.id}
          data-widget-type={widget.componentType}
          data-widget-definition={widget.definitionId}
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

function getChargingConnectionVisibility(widget: DashboardConfig['widgets'][number]) {
  const value = widget.options?.[CHARGING_CONNECTION_VISIBILITY_OPTION];
  return value === 'plugged' || value === 'unplugged'
    ? (value as ChargingConnectionVisibility)
    : null;
}

function isPluggedIn(status: VehicleStatus | null | undefined) {
  const state = status?.charger_state?.toLowerCase();
  if (state && !['unknown', 'disconnected'].includes(state)) return true;
  return Boolean(status?.charger_status && status.charger_status !== 'chrgr_sts_not_connected');
}
