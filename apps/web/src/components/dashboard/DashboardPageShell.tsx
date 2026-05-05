import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@riviamigo/hooks';
import { PageLayout, DateRangePicker } from '@riviamigo/ui/primitives';
import { getEfficiencyDisplay, setEfficiencyDisplay, type EfficiencyDisplay } from '@riviamigo/ui/lib/utils';
import {
  DashboardRenderer,
  getDefaultBySlug,
  useDashboardBySlug,
} from '@riviamigo/dashboards';
import type { DashboardConfig, WidgetCtx } from '@riviamigo/dashboards';
import { AppLayout } from '../layout/AppLayout';
import { AuthGuard } from '../layout/AuthGuard';
import { NoVehicleState } from '../layout/NoVehicleState';
import {
  DEFAULT_PRESET,
  presetToRange,
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

export function DashboardPageShell({
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
  const { defaultVehicleId } = useAuth();
  const [internalEditMode, setInternalEditMode] = useState(false);
  const [preset, setPreset] = useState<PresetKey | undefined>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const [efficiencyDisplay, setEfficiencyDisplayState] = useState<EfficiencyDisplay>(() => getEfficiencyDisplay());
  const { from, to } = rangeToIso(range);

  const { data: apiConfig, isLoading } = useDashboardBySlug(slug);
  const localDefault = getDefaultBySlug(slug);
  const savedConfig: DashboardConfig | undefined = apiConfig ?? localDefault;

  const [localConfig, setLocalConfig] = useState<DashboardConfig | null>(null);
  const currentEditMode = controlledEditMode ?? internalEditMode;
  const activeConfig = localConfig ?? savedConfig;
  const ctx = useMemo<WidgetCtx>(
    () => ({ vehicleId: defaultVehicleId, from, to }),
    [defaultVehicleId, from, to],
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
    const wasEditMode = previousEditModeRef.current;

    if (currentEditMode && !wasEditMode) {
      setLocalConfig(savedConfig ?? null);
    }

    if (!currentEditMode && wasEditMode) {
      setLocalConfig(null);
    }

    previousEditModeRef.current = currentEditMode;
  }, [currentEditMode, savedConfig]);

  const shellState: DashboardPageShellRenderState = {
    activeConfig,
    savedConfig,
    localConfig,
    setLocalConfig,
    isEditMode: currentEditMode,
    isLoading,
    vehicleId: defaultVehicleId,
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
    />
  ) : null;
  const efficiencyDisplayAction = showEfficiencyDisplayToggle && !currentEditMode ? (
    <button
      type="button"
      className="h-9 rounded-lg border border-border bg-bg-surface px-3 text-xs font-medium text-fg-secondary transition-colors hover:border-border-strong hover:text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      onClick={() => {
        const next = efficiencyDisplay === 'distance_per_energy' ? 'energy_per_distance' : 'distance_per_energy';
        setEfficiencyDisplay(next);
        setEfficiencyDisplayState(next);
      }}
      aria-label="Toggle efficiency units"
      title="Toggle efficiency units"
    >
      {efficiencyDisplay === 'distance_per_energy' ? 'mi/kWh' : 'Wh/mi'}
    </button>
  ) : null;
  const extraActions = renderActions?.(shellState);
  const pageActions = efficiencyDisplayAction || dateRangeAction || extraActions ? (
    <div className="flex items-center gap-2">
      {efficiencyDisplayAction}
      {dateRangeAction}
      {extraActions}
    </div>
  ) : undefined;

  return (
    <AuthGuard>
      <AppLayout activeKey={navKey}>
        <PageLayout
          title={title ?? activeConfig?.name ?? slug}
          titleAction={renderTitleAction?.(shellState)}
          actions={pageActions}
        >
          {!defaultVehicleId ? (
            <NoVehicleState />
          ) : isLoading && !activeConfig ? (
            <div className="text-xs text-fg-tertiary p-4">Loading…</div>
          ) : activeConfig ? (
            <>
              {renderBeforeDashboard?.(shellState)}
              {(renderDashboard?.(shellState) ?? true) ? (
                <DashboardRenderer
                  config={activeConfig}
                  ctx={ctx}
                  mode={currentEditMode ? 'edit' : 'view'}
                  onConfigChange={setLocalConfig}
                />
              ) : null}
            </>
          ) : null}
        </PageLayout>
      </AppLayout>
    </AuthGuard>
  );
}
