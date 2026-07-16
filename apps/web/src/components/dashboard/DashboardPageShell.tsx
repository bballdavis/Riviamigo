import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useMe, useResolvedVehicleSelection } from '@riviamigo/hooks';
import { DateRangePicker, PageLayout, SelectPicker, Tooltip } from '@riviamigo/ui/primitives';
import { getEfficiencyDisplay, getUnitPreferences, setEfficiencyDisplay, type EfficiencyDisplay } from '@riviamigo/ui/lib/utils';
import {
  DashboardRenderer,
  findOwnedDashboardBySlug,
  getDefaultBySlug,
  isSystemDefaultDashboard,
  materializeSystemDashboardDraft,
  materializeUserDashboardDraft,
  useCreateDashboard,
  useDashboardById,
  useDashboardBySlug,
  useUpdateAdminDashboard,
  useUpdateDashboard,
} from '@riviamigo/dashboards';
import type { DashboardConfig, WidgetCtx } from '@riviamigo/dashboards';
import { Edit2, Save, Trash2 } from 'lucide-react';
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
  dashboardId?: string | undefined;
  title?: string | undefined;
  isEditMode?: boolean;
  onEditModeChange?: (isEditMode: boolean) => void;
  renderTitleAction?: (state: DashboardPageShellRenderState) => React.ReactNode;
  renderActions?: (state: DashboardPageShellRenderState) => React.ReactNode;
  renderBeforeDashboard?: (state: DashboardPageShellRenderState) => React.ReactNode;
  renderDashboard?: (state: DashboardPageShellRenderState) => boolean;
  enableDashboardEditing?: boolean | undefined;
  showEfficiencyDisplayToggle?: boolean;
}

export interface DashboardEditMutations {
  updateDashboard: ReturnType<typeof useUpdateDashboard>;
  updateAdminDashboard: ReturnType<typeof useUpdateAdminDashboard>;
  createDashboard: ReturnType<typeof useCreateDashboard>;
  qc: ReturnType<typeof useQueryClient>;
  isAdmin: boolean;
}

export function canManageSystemDashboards(role: string | null | undefined) {
  return role === 'admin' || role === 'super_user';
}

export function createDefaultDashboardEditActions({ updateDashboard, updateAdminDashboard, createDashboard, qc, isAdmin }: DashboardEditMutations) {
  return function renderDefaultDashboardEditActions({ isEditMode, isDirty, localConfig, savedConfig, exitEdit, setSaveError }: DashboardPageShellRenderState) {
    if (!isEditMode) return undefined;
    const isPending = updateDashboard.isPending || updateAdminDashboard.isPending || createDashboard.isPending;

    async function handleSave() {
      setSaveError(null);
      if (!localConfig || !savedConfig) { exitEdit(); return; }
      try {
        const isSystemDefault = isSystemDefaultDashboard(savedConfig);

        if (isSystemDefault && isAdmin) {
          await updateAdminDashboard.mutateAsync(materializeSystemDashboardDraft(localConfig, savedConfig));
        } else {
          const ownedCopy = savedConfig?.ownerId != null
            ? savedConfig
            : findOwnedDashboardBySlug(qc.getQueryData<DashboardConfig[]>(['dashboards']), localConfig.slug) ?? null;
          if (ownedCopy) {
            await updateDashboard.mutateAsync(materializeUserDashboardDraft(localConfig, ownedCopy));
          } else {
            try {
              await createDashboard.mutateAsync(materializeUserDashboardDraft(localConfig));
            } catch {
              await qc.refetchQueries({ queryKey: ['dashboards', 'slug', localConfig.slug] });
              const refreshedBySlug = qc.getQueryData<DashboardConfig>(['dashboards', 'slug', localConfig.slug]);
              const refreshedOwned =
                refreshedBySlug?.ownerId != null
                  ? refreshedBySlug
                  : findOwnedDashboardBySlug(qc.getQueryData<DashboardConfig[]>(['dashboards']), localConfig.slug);
              if (!refreshedOwned) throw new Error('Could not find owned dashboard after refetch');
              await updateDashboard.mutateAsync(materializeUserDashboardDraft(localConfig, refreshedOwned));
            }
          }
        }
        exitEdit();
      } catch (error) {
        setSaveError(dashboardSaveErrorMessage(error));
      }
    }

    return (
      <>
        <span className="text-[11px] font-medium text-fg-tertiary">{isDirty ? 'Unsaved' : 'Dashboard'}</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          title="Save changes"
          aria-label="Save dashboard changes"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent/90 disabled:opacity-40"
        >
          <Save className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={exitEdit}
          title="Discard changes"
          aria-label="Discard dashboard changes"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-fg-tertiary transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </>
    );
  };
}

function dashboardSaveErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return `Dashboard save failed: ${error.message}`;
  }
  return 'Dashboard save failed. Your unsaved edits are still open.';
}

export function DashboardPageShell(props: DashboardPageShellProps) {
  return <DashboardPageShellContent {...props} />;
}

function DashboardPageShellContent({
  navKey,
  slug,
  dashboardId,
  title,
  isEditMode: controlledEditMode,
  onEditModeChange,
  renderTitleAction,
  renderActions,
  renderBeforeDashboard,
  renderDashboard,
  enableDashboardEditing = true,
  showEfficiencyDisplayToggle = false,
}: DashboardPageShellProps) {
  const { setActiveVehicleId } = useAuth();
  const setSessionVehicleId = setActiveVehicleId ?? (() => {});
  const {
    authReady,
    effectiveVehicleId,
    vehicleSelectionReady,
    vehicles: availableVehicles,
  } = useResolvedVehicleSelection();
  const updateDashboard = useUpdateDashboard();
  const updateAdminDashboard = useUpdateAdminDashboard();
  const createDashboard = useCreateDashboard();
  const qc = useQueryClient();
  const me = useMe();
  const isAdmin = canManageSystemDashboards(me.data?.role);
  const storedTimeframe = useMemo(() => loadDashboardTimeframe(), []);
  const [timeframe, setTimeframe] = useState<DashboardTimeframe>(
    () => storedTimeframe ?? DEFAULT_TIMEFRAME,
  );
  const [chargeSessionDayLocal, setChargeSessionDayLocal] = useState<string | null>(null);
  const [efficiencyDisplay, setEfficiencyDisplayState] = useState<EfficiencyDisplay>(() => getEfficiencyDisplay());
  const [unitMode, setUnitMode] = useState(() => getUnitPreferences().mode);
  const range = useMemo(() => getTimeframeRange(timeframe), [timeframe]);
  const { from, to } = useMemo(() => timeframeToQuery(timeframe), [timeframe]);

  const hasVehicleChoices = availableVehicles.length > 1;
  const bySlug = useDashboardBySlug(dashboardId ? null : slug);
  const byId = useDashboardById(dashboardId ?? null);
  const apiConfig = dashboardId ? byId.data : bySlug.data;
  const apiConfigForSlug = apiConfig?.slug === slug ? apiConfig : undefined;
  const localDefault = getDefaultBySlug(slug);
  const savedConfig: DashboardConfig | undefined = dashboardId
    ? apiConfigForSlug
    : apiConfigForSlug ?? localDefault;
  const dashboardIsLoading = dashboardId ? byId.isLoading : bySlug.isLoading;
  const exactDashboardUnavailable = Boolean(
    dashboardId && !dashboardIsLoading && (byId.isError || !apiConfigForSlug),
  );

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
      ? Math.max(1, Math.min(20, Math.round(nextHeight)))
      : null;

    if (normalizedHeight == null) return;

    setLocalConfig((current) => {
      const currentConfig = current ?? savedConfig;
      if (!currentConfig) return current;

      const widgets = currentConfig.widgets;
      const widgetIndex = widgets.findIndex((widget) => widget.id === widgetId);
      if (widgetIndex === -1) return current;

      const widget = widgets[widgetIndex];
      if (!widget) return current;
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
      dashboardSlug: slug,
      timeframe,
      from,
      to,
      chargeSessionDayLocal,
      setChargeSessionDayLocal: setChargeSessionDayFilter,
      updateWidgetLayout,
    }),
    [
      effectiveVehicleId,
      slug,
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
  const shouldRenderDashboard = renderDashboard?.(shellState) ?? true;
  const canEditDashboard = enableDashboardEditing
    && shouldRenderDashboard
    && Boolean(activeConfig)
    && Boolean(effectiveVehicleId);

  const dateRangeAction = activeConfig?.controls?.dateRange && !currentEditMode ? (
    <DateRangePicker
      timeframe={timeframe}
      onChange={setTimeframe}
      triggerClassName="h-9"
    />
  ) : null;
  const vehicleAction = hasVehicleChoices && !currentEditMode ? (
    <SelectPicker
      className="min-w-[11rem]"
      value={effectiveVehicleId ?? ''}
      onChange={(vehicleId) => setSessionVehicleId(vehicleId || null)}
      aria-label="Select vehicle"
      options={availableVehicles.map((vehicle) => ({
        value: vehicle.id,
        label: vehicle.display_name || vehicle.model,
        description: vehicle.display_name && vehicle.model !== vehicle.display_name ? vehicle.model : undefined,
      }))}
    />
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
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-elevated text-fg-secondary transition-colors hover:border-border-strong hover:text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
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
  const dashboardEditActions = currentEditMode && canEditDashboard
    ? createDefaultDashboardEditActions({
      updateDashboard,
      updateAdminDashboard,
      createDashboard,
      qc,
      isAdmin,
    })(shellState)
    : undefined;
  const pageExtraActions = currentEditMode ? undefined : renderActions?.(shellState);
  const defaultTitleAction = !currentEditMode && canEditDashboard && activeConfig?.showEditButton === true ? (
    <button
      type="button"
      onClick={enterEdit}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-tertiary/80 transition-colors hover:text-fg hover:bg-bg-elevated"
      title="Edit dashboard"
      aria-label="Edit dashboard"
    >
      <Edit2 className="h-4 w-4" />
    </button>
  ) : null;
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
        titleAction={renderTitleAction?.(shellState) ?? defaultTitleAction}
        actions={pageActions}
      >
        {exactDashboardUnavailable ? (
          <div role="alert" className="rounded-xl border border-status-danger/30 bg-status-danger/10 p-4 text-sm text-status-danger">
            <p>This dashboard could not be opened. It may no longer exist or you may not have access to it.</p>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="mt-3 rounded-lg border border-status-danger/40 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-status-danger/10"
            >
              Back to Dashboards
            </button>
          </div>
        ) : !authReady || !vehicleSelectionReady ? (
          <div className="text-xs text-fg-tertiary p-4">Loading...</div>
        ) : !effectiveVehicleId ? (
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
            {shouldRenderDashboard ? (
              <DashboardRenderer
                config={activeConfig}
                ctx={ctx}
                mode={currentEditMode ? 'edit' : 'view'}
                onConfigChange={setLocalConfig}
                editActions={dashboardEditActions}
              />
            ) : null}
          </>
        ) : null}
      </PageLayout>
    </AppLayout>
  );
}
