import React, { Suspense, lazy } from 'react';
import { useAuth, useCurrentVehicleStatus } from '@riviamigo/hooks';
import type { DashboardConfig } from './schema';
import type { WidgetCtx } from './registry';
import { DashboardGrid } from './DashboardGrid';
import { DashboardDataProvider, collectDashboardDataRequirements } from './dashboardData';
import {
  resolveDashboardViewWidgets,
} from './dashboardModel';
import {
  DASHBOARD_VISIBILITY_CONDITIONS,
  dashboardVisibilityStateFromStatus,
  getDashboardVisibilityRuleTypes,
  getDashboardVisibilityOptionLabel,
  hasDashboardVisibilityRules,
  type DashboardPreviewState,
} from './dashboardVisibility';

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
  const {
    liveWidgets,
    previewWidgets,
    previewScenario,
    setPreviewScenarioValue,
    visibilityTypes,
  } = useDashboardViewWidgets(config.id, widgets, ctx, mode);
  const dataWidgets = mode === 'edit' ? previewWidgets : liveWidgets;
  const requirements = React.useMemo(
    () => collectDashboardDataRequirements(dataWidgets),
    [dataWidgets],
  );

  return (
    <DashboardDataProvider ctx={ctx} requirements={requirements}>
      {mode === 'edit' ? (
      <Suspense fallback={<div className="text-xs text-fg-tertiary p-4">Loading editor...</div>}>
        <GridEditor
          config={{ ...config, widgets }}
          ctx={{ ...ctx, visibilityState: previewScenario }}
          onConfigChange={onConfigChange}
          editActions={editActions}
          visibleWidgetIds={previewWidgets.map((widget) => widget.id)}
          visibilityState={previewScenario}
          onVisibilityStateChange={setPreviewScenarioValue}
          previewControls={visibilityTypes.length > 0 ? (
            <DashboardVisibilityPreview
              types={visibilityTypes}
              state={previewScenario}
              onChange={setPreviewScenarioValue}
            />
          ) : undefined}
        />
      </Suspense>
      ) : <DashboardGrid widgets={liveWidgets} ctx={ctx} />}
    </DashboardDataProvider>
  );
}

function useDashboardViewWidgets(
  dashboardId: string,
  widgets: DashboardConfig['widgets'],
  ctx: WidgetCtx,
  mode: 'view' | 'edit',
) {
  const hasVisibilityRules = hasDashboardVisibilityRules(widgets);
  const visibilityTypes = React.useMemo(
    () => getDashboardVisibilityRuleTypes(widgets),
    [widgets],
  );
  const { defaultVehicleId } = useAuth();
  const vehicleId = ctx.vehicleId ?? defaultVehicleId;
  const { data: status } = useCurrentVehicleStatus(hasVisibilityRules ? vehicleId : null);
  const liveState = React.useMemo(
    () => dashboardVisibilityStateFromStatus(status),
    [status],
  );
  const [previewScenario, setPreviewScenario] = React.useState<DashboardPreviewState>(liveState);
  const previewTouchedRef = React.useRef(false);
  const previewKey = `${dashboardId}:${mode}`;
  const previousPreviewKeyRef = React.useRef(previewKey);

  React.useEffect(() => {
    if (previousPreviewKeyRef.current !== previewKey) {
      previousPreviewKeyRef.current = previewKey;
      previewTouchedRef.current = false;
      setPreviewScenario(liveState);
    }
  }, [liveState, previewKey]);

  React.useEffect(() => {
    if (!previewTouchedRef.current) setPreviewScenario(liveState);
  }, [liveState]);

  const setPreviewScenarioValue = React.useCallback((
    type: 'vehicle-connection',
    value: DashboardPreviewState['vehicle-connection'],
  ) => {
    previewTouchedRef.current = true;
    setPreviewScenario((current) => ({ ...current, [type]: value }));
  }, []);

  const liveWidgets = hasVisibilityRules
    ? resolveDashboardViewWidgets(widgets, liveState)
    : widgets;
  const previewWidgets = hasVisibilityRules
    ? resolveDashboardViewWidgets(widgets, previewScenario)
    : widgets;

  return {
    liveWidgets,
    previewWidgets,
    previewScenario,
    setPreviewScenarioValue,
    visibilityTypes,
  };
}

function DashboardVisibilityPreview({
  types,
  state,
  onChange,
}: {
  types: Array<'vehicle-connection'>;
  state: DashboardPreviewState;
  onChange: (
    type: 'vehicle-connection',
    value: DashboardPreviewState['vehicle-connection'],
  ) => void;
}) {
  const activeScenario = types
    .map((type) => getDashboardVisibilityOptionLabel(type, state[type]))
    .join(' · ');

  return (
    <div className="grid gap-2" aria-label="Dashboard scenario preview" data-dashboard-preview-state={activeScenario}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-tertiary">
          Scenario preview
        </span>
        <span className="truncate text-xs font-medium text-fg" data-dashboard-preview-label>
          Previewing: {activeScenario}
        </span>
      </div>
      {types.map((type) => {
        const definition = DASHBOARD_VISIBILITY_CONDITIONS[type];
        return (
          <div key={type} className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium text-fg-tertiary">{definition.label}</span>
            <div className="inline-flex rounded-lg border border-border bg-bg p-0.5">
              {definition.values.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={state[type] === option.value}
                  onClick={() => onChange(type, option.value)}
                  className={`min-h-8 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
                    state[type] === option.value
                      ? 'bg-accent text-white'
                      : 'text-fg-secondary hover:bg-bg-elevated hover:text-fg'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
