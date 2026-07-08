import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useVehicles } from '@riviamigo/hooks';
import { PageLayout, DateRangePicker, Tooltip } from '@riviamigo/ui/primitives';
import { getEfficiencyDisplay, getUnitPreferences, setEfficiencyDisplay, type EfficiencyDisplay } from '@riviamigo/ui/lib/utils';
import {
  DashboardRenderer,
  getDefaultBySlug,
  useDashboardBySlug,
} from '@riviamigo/dashboards';
import type { DashboardConfig, WidgetCtx } from '@riviamigo/dashboards';
import { PiSpeedometerFill, PiSpeedometerLight } from 'react-icons/pi';
import { AppLayout } from '../layout/AppLayout';
import { NoVehicleState } from '../layout/NoVehicleState';
import {
  DEFAULT_TIMEFRAME,
  getTimeframeRange,
  loadDashboardTimeframe,
  saveDashboardTimeframe,
  timeframeToQuery,
  type DateRange,
  type DashboardTimeframe,
} from '../../lib/dates';
import { useDashboardEditDraft } from './useDashboardEditDraft';

export interface DashboardPageShellRenderState {
  activeConfig: DashboardConfig | undefined;
  savedConfig: DashboardConfig | undefined;
  localConfig: DashboardConfig | null;
  setLocalConfig: React.Dispatch<React.SetStateAction<DashboardConfig | null>>;
  isEditMode: boolean;
  isDirty: boolean;
  isLoading: boolean;
  saveError: string | null;
  setSaveError: React.Dispatch<React.SetStateAction<string | null>>;
  vehicleId: string | null;
  ctx: WidgetCtx;
  timeframe: DashboardTimeframe;
  range: DateRange | null;
  chargeSessionDayLocal?: string | null;
  setChargeSessionDayLocal?: (dayLocal: string | null) => void;
  setTimeframe: React.Dispatch<React.SetStateAction<DashboardTimeframe>>;
  enterEdit: () => void;
  exitEdit: () => void;
}

export interface DashboardPageShellProps {
  navKey: string;
  slug: string;
  title?: string | undefined;
  isEditMode?: boolean;
  onEditModeChange?: (isEditMode: boolean) => void;
  renderTitleAction?: (state: DashboardPageShellRenderState) => React.ReactNode;
  renderActions?: (state: DashboardPageShellRenderState) => React.ReactNode;
  renderBeforeDashboard?: (state: DashboardPageShellRenderState) => React.ReactNode;
  renderDashboard?: (state: DashboardPageShellRenderState) => boolean;
  showEfficiencyDisplayToggle?: boolean;
}

export function DashboardPageShell(props: DashboardPageShellProps) {
  return <DashboardPageShellContent {...props} />;
}

function DashboardPageShellContent({
  navKey,
  slug,
  title,
  isEditMode: controlledEditMode,
  onEditModeChange,
  renderTitleAction,
  renderActions,
  renderBeforeDashboard,
  renderDashboard,
  showEfficiencyDisplayToggle = false,
}: DashboardPageShellProps) {
  const { defaultVehicleId, activeVehicleId, setActiveVehicleId } = useAuth();
  const setSessionVehicleId = setActiveVehicleId ?? (() => {});
  const { data: vehicles } = useVehicles();
  const storedTimeframe = useMemo(() => loadDashboardTimeframe(), []);
  const [timeframe, setTimeframe] = useState<DashboardTimeframe>(
    () => storedTimeframe ?? DEFAULT_TIMEFRAME,
  );
  const [chargeSessionDayLocal, setChargeSessionDayLocal] = useState<string | null>(null);
  const [efficiencyDisplay, setEfficiencyDisplayState] = useState<EfficiencyDisplay>(() => getEfficiencyDisplay());
  const [unitMode, setUnitMode] = useState(() => getUnitPreferences().mode);
  const range = useMemo(() => getTimeframeRange(timeframe), [timeframe]);
  const { from, to } = useMemo(() => timeframeToQuery(timeframe), [timeframe]);

  const availableVehicles = vehicles ?? [];
  const hasVehicleChoices = availableVehicles.length > 1;
  const effectiveVehicleId = activeVehicleId ?? defaultVehicleId;
  const { data: apiConfig, isLoading } = useDashboardBySlug(slug);
  const apiConfigForSlug = apiConfig?.slug === slug ? apiConfig : undefined;
  const localDefault = getDefaultBySlug(slug);
  const savedConfig: DashboardConfig | undefined = apiConfigForSlug ?? localDefault;
  const dashboardIsLoading = isLoading || Boolean(apiConfig && !apiConfigForSlug);

  const {
    activeConfig,
    localConfig,
    setLocalConfig,
    isEditMode: currentEditMode,
    isDirty,
    saveError,
    setSaveError,
    enterEdit,
    exitEdit,
  } = useDashboardEditDraft({
    savedConfig,
    slug,
    controlledEditMode,
    onEditModeChange,
  });

  const setChargeSessionDayFilter = React.useCallback((next: string | null) => {
    setChargeSessionDayLocal(next);
  }, []);

  const updateWidgetLayout = useCallback((widgetId: string, nextHeight: number) => {
    const normalizedHeight = Number.isFinite(nextHeight)
      ? Math.max(1, Math.min(10, Math.round(nextHeight)))
      : null;

    if (normalizedHeight == null) return;

    setLocalConfig((current) => {
      const currentConfig = current ?? savedConfig;
      if (!currentConfig) return current;

      const widgets = currentConfig.widgets;
      const widgetIndex = widgets.findIndex((widget) => widget.id === widgetId);
      if (widgetIndex === -1) return current;

      const widget = widgets[widgetIndex];
      if (widget.layout.h === normalizedHeight) return current;

      const nextWidgets = [...widgets];
      nextWidgets[widgetIndex] = {
        ...widget,
        layout: {
          ...widget.layout,
          h: normalizedHeight,
        },
      };

      return {
        ...currentConfig,
        widgets: nextWidgets,
      };
    });
  }, [setLocalConfig, savedConfig]);

  useEffect(() => {
    const handleUnits = () => {
      setUnitMode(getUnitPreferences().mode);
      setEfficiencyDisplayState(getEfficiencyDisplay());
    };
    window.addEventListener('rm-units-change', handleUnits as EventListener);
    window.addEventListener('storage', handleUnits);
    return () => {
      window.removeEventListener('rm-units-change', handleUnits as EventListener);
      window.removeEventListener('storage', handleUnits);
    };
  }, []);

  useEffect(() => {
    setChargeSessionDayLocal(null);
  }, [effectiveVehicleId, timeframe]);

  const ctx = useMemo<WidgetCtx>(
    () => ({
      vehicleId: effectiveVehicleId,
      timeframe,
      from,
      to,
      chargeSessionDayLocal,
      setChargeSessionDayLocal: setChargeSessionDayFilter,
      updateWidgetLayout,
    }),
    [
      effectiveVehicleId,
      timeframe,
      from,
      to,
      chargeSessionDayLocal,
      setChargeSessionDayFilter,
      updateWidgetLayout,
    ],
  );

  useEffect(() => {
    saveDashboardTimeframe(timeframe);
  }, [timeframe]);

  useEffect(() => {
    if (!availableVehicles.length) {
      if (activeVehicleId) setSessionVehicleId(null);
      return;
    }
    if (activeVehicleId && !availableVehicles.some((vehicle) => vehicle.id === activeVehicleId)) {
      setSessionVehicleId(null);
      return;
    }
    if (!defaultVehicleId) return;
    if (!activeVehicleId && !availableVehicles.some((vehicle) => vehicle.id === defaultVehicleId)) {
      setSessionVehicleId(availableVehicles[0]?.id ?? null);
    }
  }, [activeVehicleId, availableVehicles, defaultVehicleId, setSessionVehicleId]);

  const shellState: DashboardPageShellRenderState = {
    activeConfig,
    savedConfig,
    localConfig,
    setLocalConfig,
    isEditMode: currentEditMode,
    isDirty,
    isLoading: dashboardIsLoading,
    saveError,
    setSaveError,
    vehicleId: effectiveVehicleId,
    ctx,
    timeframe,
    range,
    chargeSessionDayLocal,
    setChargeSessionDayLocal: setChargeSessionDayFilter,
    setTimeframe,
    enterEdit,
    exitEdit,
  };

  const dateRangeAction = activeConfig?.controls?.dateRange && !currentEditMode ? (
    <DateRangePicker
      timeframe={timeframe}
      onChange={setTimeframe}
      triggerClassName="h-9"
    />
  ) : null;
  const vehicleAction = hasVehicleChoices && !currentEditMode ? (
    <label className="inline-flex items-center">
      <span className="sr-only">Selected vehicle</span>
      <select
        className="h-9 min-w-[11rem] rounded-lg border border-border bg-bg-surface px-3 text-sm text-fg-secondary transition-colors hover:border-border-strong hover:text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        value={effectiveVehicleId ?? ''}
        onChange={(event) => setSessionVehicleId(event.target.value || null)}
        aria-label="Select vehicle"
      >
        {availableVehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {vehicle.display_name || vehicle.model}
          </option>
        ))}
      </select>
    </label>
  ) : null;
  const EfficiencyDisplayIcon = efficiencyDisplay === 'distance_per_energy' ? PiSpeedometerFill : PiSpeedometerLight;
  const efficiencyDisplayLabel = efficiencyDisplay === 'distance_per_energy' ? 'mi/kWh' : 'Wh/mi';
  const efficiencyDisplayTooltip = efficiencyDisplay === 'distance_per_energy'
    ? 'Showing mi/kWh. Click to switch to Wh/mi.'
    : 'Showing Wh/mi. Click to switch to mi/kWh.';
  const efficiencyDisplayAction = showEfficiencyDisplayToggle && !currentEditMode && unitMode !== 'custom' ? (
    <Tooltip
      content={(
        <div className="grid gap-1">
          <span className="text-xs font-medium text-fg">Efficiency units</span>
          <span className="text-[11px] text-fg-secondary">{efficiencyDisplayTooltip}</span>
        </div>
      )}
      contentClassName="w-60"
    >
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-surface text-fg-secondary transition-colors hover:border-border-strong hover:text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        onClick={() => {
          const next = efficiencyDisplay === 'distance_per_energy' ? 'energy_per_distance' : 'distance_per_energy';
          setEfficiencyDisplay(next);
          setEfficiencyDisplayState(next);
        }}
        aria-label={`Toggle efficiency units, currently ${efficiencyDisplayLabel}`}
        aria-pressed={efficiencyDisplay === 'distance_per_energy'}
      >
        <EfficiencyDisplayIcon className="h-4 w-4" />
      </button>
    </Tooltip>
  ) : null;
  const editActions = currentEditMode ? renderActions?.(shellState) : undefined;
  const pageExtraActions = currentEditMode ? undefined : renderActions?.(shellState);
  const pageActions = vehicleAction || efficiencyDisplayAction || dateRangeAction || pageExtraActions ? (
    <div className="flex items-center gap-2">
      {vehicleAction}
      {efficiencyDisplayAction}
      {dateRangeAction}
      {pageExtraActions}
    </div>
  ) : undefined;

  return (
    <AppLayout activeKey={navKey}>
      <PageLayout
        title={title ?? activeConfig?.name ?? slug}
        titleAction={renderTitleAction?.(shellState)}
        actions={pageActions}
      >
        {!effectiveVehicleId ? (
          <NoVehicleState />
        ) : dashboardIsLoading && !activeConfig ? (
          <div className="text-xs text-fg-tertiary p-4">Loading...</div>
        ) : activeConfig ? (
          <>
            {renderBeforeDashboard?.(shellState)}
            {currentEditMode && saveError ? (
              <div
                role="alert"
                className="mb-3 rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger"
              >
                {saveError}
              </div>
            ) : null}
            {(renderDashboard?.(shellState) ?? true) ? (
              <DashboardRenderer
                config={activeConfig}
                ctx={ctx}
                mode={currentEditMode ? 'edit' : 'view'}
                onConfigChange={setLocalConfig}
                editActions={editActions}
              />
            ) : null}
          </>
        ) : null}
      </PageLayout>
    </AppLayout>
  );
}
