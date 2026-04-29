import React, { useState } from 'react';
import { useAuth } from '@riviamigo/hooks';
import { PageLayout, DateRangePicker } from '@riviamigo/ui/primitives';
import {
  DashboardRenderer,
  useDashboardBySlug,
  useUpdateDashboard,
  getDefaultBySlug,
} from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';
import { AppLayout } from '../layout/AppLayout';
import { AuthGuard } from '../layout/AuthGuard';
import { NoVehicleState } from '../layout/NoVehicleState';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../../lib/dates';
import { Edit2, Save, Trash2 } from 'lucide-react';

export interface DashboardPageProps {
  /** Sidebar nav key (e.g. "dashboard", "battery"). */
  navKey: string;
  /** Dashboard slug to resolve. */
  slug: string;
  /** Override the page title shown in PageLayout. */
  title?: string | undefined;
}

export function DashboardPage({ navKey, slug, title }: DashboardPageProps) {
  return (
    <AuthGuard>
      <DashboardPageContent navKey={navKey} slug={slug} title={title} />
    </AuthGuard>
  );
}

function DashboardPageContent({ navKey, slug, title }: DashboardPageProps) {
  const { defaultVehicleId } = useAuth();

  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const { from, to } = rangeToIso(range);

  // Try API first; fall back to bundled defaults if API unavailable / loading
  const { data: apiConfig, isLoading } = useDashboardBySlug(slug);
  const localDefault = getDefaultBySlug(slug);
  const savedConfig: DashboardConfig | undefined = apiConfig ?? localDefault;

  const [isEditMode, setIsEditMode] = useState(false);
  const [localConfig, setLocalConfig] = useState<DashboardConfig | null>(null);
  const updateDashboard = useUpdateDashboard();

  const activeConfig = localConfig ?? savedConfig;
  const ctx = { vehicleId: defaultVehicleId, from, to };

  function enterEdit() {
    setLocalConfig(savedConfig ?? null);
    setIsEditMode(true);
  }

  function exitEdit() {
    setIsEditMode(false);
    setLocalConfig(null);
  }

  async function handleSave() {
    if (!localConfig) {
      exitEdit();
      return;
    }
    try {
      await updateDashboard.mutateAsync(localConfig);
      exitEdit();
    } catch {
      // API unavailable or rejected — stay in edit mode so changes aren't lost
    }
  }

  return (
    <AppLayout activeKey={navKey}>
      <PageLayout
        title={title ?? activeConfig?.name ?? slug}
        titleAction={
          !isEditMode ? (
            <button
              onClick={enterEdit}
              className="p-1 rounded-md text-fg-tertiary hover:text-fg hover:bg-bg-elevated transition-colors"
              title="Edit dashboard"
            >
              <Edit2 className="h-4 w-4" />
            </button>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            {activeConfig?.controls?.dateRange && !isEditMode && (
              <DateRangePicker
                value={range}
                preset={preset}
                onChange={(r, p) => { setRange(r); if (p) setPreset(p); }}
              />
            )}
            {isEditMode && (
              <>
                <button
                  onClick={handleSave}
                  disabled={updateDashboard.isPending}
                  title="Save changes"
                  className="p-2 rounded-lg bg-accent text-white disabled:opacity-40 hover:bg-accent/90 transition-colors"
                >
                  <Save className="h-4 w-4" />
                </button>
                <button
                  onClick={exitEdit}
                  title="Discard changes"
                  className="p-2 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        }
      >
        {!defaultVehicleId ? (
          <NoVehicleState />
        ) : isLoading && !activeConfig ? (
          <div className="text-xs text-fg-tertiary p-4">Loading…</div>
        ) : activeConfig ? (
          <DashboardRenderer
            config={activeConfig}
            ctx={ctx}
            mode={isEditMode ? 'edit' : 'view'}
            onConfigChange={setLocalConfig}
          />
        ) : null}
      </PageLayout>
    </AppLayout>
  );
}
