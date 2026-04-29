import React, { useState } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root';
import { useAuth } from '@riviamigo/hooks';
import { PageLayout, DateRangePicker } from '@riviamigo/ui/primitives';
import {
  DashboardRenderer,
  useDashboardBySlug,
  useUpdateDashboard,
  useCloneDashboard,
  downloadDashboardYaml,
  importDashboardYaml,
} from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../lib/dates';
import { Edit2, Lock, Copy, Check, X, Download, Upload } from 'lucide-react';

const searchSchema = z.object({ edit: z.string().optional() });

export const userDashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/d/$slug',
  validateSearch: searchSchema,
  component: UserDashboardPageWrapper,
});

function UserDashboardPageWrapper() {
  return <AuthGuard><UserDashboardPage /></AuthGuard>;
}

function UserDashboardPage() {
  const { slug } = useParams({ from: '/d/$slug' });
  const search = useSearch({ from: '/d/$slug' });
  const navigate = useNavigate();
  const { defaultVehicleId } = useAuth();

  const isEditMode = search.edit === '1';

  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const { from, to } = rangeToIso(range);

  const { data: config, isLoading } = useDashboardBySlug(slug);
  const [localConfig, setLocalConfig] = useState<DashboardConfig | null>(null);
  const updateDashboard = useUpdateDashboard();
  const cloneDashboard = useCloneDashboard();

  const activeConfig = localConfig ?? config;
  const ctx = { vehicleId: defaultVehicleId, from, to };

  function enterEdit() {
    if (config?.isLocked) {
      handleClone();
      return;
    }
    navigate({ to: '/d/$slug', params: { slug }, search: { edit: '1' } });
  }

  function exitEdit() {
    navigate({ to: '/d/$slug', params: { slug }, search: {} });
    setLocalConfig(null);
  }

  async function handleSave() {
    if (!localConfig) return;
    await updateDashboard.mutateAsync(localConfig);
    exitEdit();
  }

  async function handleClone() {
    if (!config) return;
    const cloned = await cloneDashboard.mutateAsync(config.id);
    navigate({ to: '/d/$slug', params: { slug: cloned.slug }, search: { edit: '1' } });
  }

  function handleExport() {
    if (activeConfig) downloadDashboardYaml(activeConfig);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const imported = importDashboardYaml(text);
      setLocalConfig(imported);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    e.target.value = '';
  }

  const isLocked = activeConfig?.isLocked ?? false;

  return (
    <AppLayout activeKey="dashboard">
      <PageLayout
        title={activeConfig?.name ?? slug}
        actions={
          <div className="flex items-center gap-2">
            {activeConfig?.controls?.dateRange && !isEditMode && (
              <DateRangePicker
                value={range}
                preset={preset}
                onChange={(r, p) => { setRange(r); if (p) setPreset(p); }}
              />
            )}

            {isEditMode ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={!localConfig || updateDashboard.isPending}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent text-white disabled:opacity-40 hover:bg-accent/90 transition-colors"
                >
                  <Check className="h-3.5 w-3.5" />
                  Save
                </button>
                <button
                  onClick={exitEdit}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </button>
              </>
            ) : (
              <>
                {isLocked ? (
                  <>
                    <button
                      onClick={handleClone}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Customize
                    </button>
                    <Lock className="h-3.5 w-3.5 text-fg-tertiary" />
                  </>
                ) : (
                  <button
                    onClick={enterEdit}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                )}

                <button
                  onClick={handleExport}
                  title="Export as YAML"
                  className="p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                <label
                  title="Import from YAML"
                  className="cursor-pointer p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <input type="file" accept=".yaml,.yml" className="sr-only" onChange={handleImport} />
                </label>
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
