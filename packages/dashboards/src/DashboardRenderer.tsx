import React, { Suspense, lazy } from 'react';
import { useAuth, useCurrentVehicleStatus } from '@riviamigo/hooks';
import type { VehicleStatus } from '@riviamigo/types';
import type { DashboardConfig } from './schema';
import type { WidgetCtx } from './registry';
import { DashboardGrid } from './DashboardGrid';
import {
  hasDashboardVisibilityRules,
  resolveDashboardViewWidgets,
} from './dashboardModel';

const GridEditor = lazy(() => import('./GridEditor'));

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
  const viewWidgets = useDashboardViewWidgets(widgets, ctx);

  if (mode === 'edit') {
    return (
      <Suspense fallback={<div className="text-xs text-fg-tertiary p-4">Loading editor...</div>}>
        <GridEditor
          config={{ ...config, widgets }}
          ctx={ctx}
          onConfigChange={onConfigChange}
          editActions={editActions}
        />
      </Suspense>
    );
  }

  return <DashboardGrid widgets={viewWidgets} ctx={ctx} />;
}

function useDashboardViewWidgets(widgets: DashboardConfig['widgets'], ctx: WidgetCtx) {
  const hasVisibilityRules = hasDashboardVisibilityRules(widgets);
  const { defaultVehicleId } = useAuth();
  const vehicleId = ctx.vehicleId ?? defaultVehicleId;
  const { data: status } = useCurrentVehicleStatus(hasVisibilityRules ? vehicleId : null);
  const pluggedIn = isPluggedIn(status);

  return hasVisibilityRules
    ? resolveDashboardViewWidgets(widgets, { pluggedIn })
    : widgets;
}

function isPluggedIn(status: VehicleStatus | null | undefined) {
  // Keep in sync with ChargingConnectionWidget.isPluggedIn.
  // charger_state_ts is intentionally not checked here: a car in standby while
  // plugged in will not always re-emit charger state events, so timestamp drift
  // must not be treated as a disconnect signal.
  const state = status?.charger_state?.toLowerCase();
  if (state && !['unknown', 'disconnected'].includes(state)) return true;
  return Boolean(status?.charger_status && status.charger_status !== 'chrgr_sts_not_connected');
}
