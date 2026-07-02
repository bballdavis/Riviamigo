import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  DEFAULT_PRESET,
  loadDashboardTimeframe,
  presetToRange,
  saveDashboardTimeframe,
  rangeToIso,
  type DateRange,
  type PresetKey,
} from '../../lib/dates';

export interface DashboardPageShellRenderState {
  activeConfig: DashboardConfig | undefined;
  savedConfig: DashboardConfig | undefined;
  localConfig: DashboardConfig | null;
  setLocalConfig: React.Dispatch<React.SetStateAction<DashboardConfig | null>>;
  isEditMode: boolean;
  isLoading: boolean;
  vehicleId: string | null;
  ctx: WidgetCtx;
  range: DateRange;
  preset: PresetKey | undefined;
  setRange: React.Dispatch<React.SetStateAction<DateRange>>;
  setPreset: React.Dispatch<React.SetStateAction<PresetKey | undefined>>;
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
  const [internalEditMode, setInternalEditMode] = useState(false);
  const storedTimeframe = useMemo(() => loadDashboardTimeframe(), []);
  const [preset, setPreset] = useState<PresetKey | undefined>(() => storedTimeframe?.preset ?? DEFAULT_PRESET);
  const [range, setRange] = useState<DateRange>(() =>
    storedTimeframe?.preset
      ? presetToRange(storedTimeframe.preset)
      : storedTimeframe?.range ?? presetToRange(DEFAULT_PRESET)
  );
  const [efficiencyDisplay, setEfficiencyDisplayState] = useState<EfficiencyDisplay>(() => getEfficiencyDisplay());
  const [unitMode, setUnitMode] = useState(() => getUnitPreferences().mode);
  const { from, to } = rangeToIso(range);

  const availableVehicles = vehicles ?? [];
  const hasVehicleChoices = availableVehicles.length > 1;
  const effectiveVehicleId = activeVehicleId ?? defaultVehicleId;
  const { data: apiConfig, isLoading } = useDashboardBySlug(slug);
  const localDefault = getDefaultBySlug(slug);
  const savedConfig: DashboardConfig | undefined = apiConfig ?? localDefault;

  const [localConfig, setLocalConfig] = useState<DashboardConfig | null>(null);
  const currentEditMode = controlledEditMode ?? internalEditMode;
  const activeConfig = localConfig ?? savedConfig;
  const ctx = useMemo<WidgetCtx>(
    () => ({ vehicleId: effectiveVehicleId, from, to }),
    [effectiveVehicleId, from, to],
  );
  const previousEditModeRef = useRef(currentEditMode);

  function setEditMode(next: boolean) {
    if (onEditModeChange) {
      onEditModeChange(next);
      return;
    }
    setInternalEditMode(next);
  }

  function enterEdit() {
    setLocalConfig(savedConfig ?? null);
    setEditMode(true);
  }

  function exitEdit() {
    setLocalConfig(null);
    setEditMode(false);
  }

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
    const wasEditMode = previousEditModeRef.current;

    if (currentEditMode && !wasEditMode) {
      setLocalConfig(savedConfig ?? null);
    }

    if (!currentEditMode && wasEditMode) {
      setLocalConfig(null);
    }

    previousEditModeRef.current = currentEditMode;
  }, [currentEditMode, savedConfig]);

  useEffect(() => {
    saveDashboardTimeframe(preset, range);
  }, [preset, range]);

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
    isLoading,
    vehicleId: effectiveVehicleId,
    ctx,
    range,
    preset,
    setRange,
    setPreset,
    enterEdit,
    exitEdit,
  };

  const dateRangeAction = activeConfig?.controls?.dateRange && !currentEditMode ? (
    <DateRangePicker
      value={range}
      preset={preset}
      onChange={(nextRange, nextPreset) => {
        setRange(nextRange);
        setPreset(nextPreset);
      }}
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
        ) : isLoading && !activeConfig ? (
          <div className="text-xs text-fg-tertiary p-4">Loading...</div>
        ) : activeConfig ? (
          <>
            {renderBeforeDashboard?.(shellState)}
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
