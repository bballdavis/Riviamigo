import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dashboardKey, type DashboardConfig } from '@riviamigo/dashboards';

export interface UseDashboardEditDraftArgs {
  savedConfig: DashboardConfig | undefined;
  slug: string;
  controlledEditMode?: boolean | undefined;
  onEditModeChange?: ((isEditMode: boolean) => void) | undefined;
}

export function useDashboardEditDraft({
  savedConfig,
  slug,
  controlledEditMode,
  onEditModeChange,
}: UseDashboardEditDraftArgs) {
  const [internalEditMode, setInternalEditMode] = useState(false);
  const isEditMode = controlledEditMode ?? internalEditMode;
  const [localConfig, setLocalConfigState] = useState<DashboardConfig | null>(() =>
    isEditMode ? savedConfig ?? null : null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const previousEditModeRef = useRef(isEditMode);
  const previousDashboardKeyRef = useRef(dashboardKey(savedConfig, slug));

  const setLocalConfig = useCallback<React.Dispatch<React.SetStateAction<DashboardConfig | null>>>(
    (next) => {
      setSaveError(null);
      setLocalConfigState(next);
    },
    [],
  );

  const activeConfig = localConfig ?? savedConfig;

  const setEditMode = useCallback((next: boolean) => {
    if (onEditModeChange) {
      onEditModeChange(next);
      return;
    }
    setInternalEditMode(next);
  }, [onEditModeChange]);

  const enterEdit = useCallback(() => {
    setSaveError(null);
    setLocalConfigState(savedConfig ?? null);
    setEditMode(true);
  }, [savedConfig, setEditMode]);

  const exitEdit = useCallback(() => {
    setSaveError(null);
    setLocalConfigState(null);
    setEditMode(false);
  }, [setEditMode]);

  useEffect(() => {
    const wasEditMode = previousEditModeRef.current;
    const currentDashboardKey = dashboardKey(savedConfig, slug);
    const dashboardChanged = currentDashboardKey !== previousDashboardKeyRef.current;

    if (isEditMode && (!wasEditMode || dashboardChanged)) {
      setSaveError(null);
      setLocalConfigState(savedConfig ?? null);
    }

    if (!isEditMode && (wasEditMode || dashboardChanged)) {
      setSaveError(null);
      setLocalConfigState(null);
    }

    previousEditModeRef.current = isEditMode;
    previousDashboardKeyRef.current = currentDashboardKey;
  }, [isEditMode, savedConfig, slug]);

  const isDirty = useMemo(() => {
    if (!isEditMode || !localConfig || !savedConfig) return false;
    return JSON.stringify(localConfig) !== JSON.stringify(savedConfig);
  }, [isEditMode, localConfig, savedConfig]);

  return {
    activeConfig,
    localConfig,
    setLocalConfig,
    isEditMode,
    isDirty,
    saveError,
    setSaveError,
    enterEdit,
    exitEdit,
  };
}
