import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@riviamigo/hooks';
import { PageLayout, DateRangePicker } from '@riviamigo/ui/primitives';
import {
  DashboardRenderer,
  useDashboardBySlug,
  useUpdateDashboard,
  useCloneDashboard,
  getDefaultBySlug,
  downloadDashboardYaml,
  importDashboardYaml,
} from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';
import { AppLayout } from '../layout/AppLayout';
import { AuthGuard } from '../layout/AuthGuard';
import { NoVehicleState } from '../layout/NoVehicleState';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../../lib/dates';
import { Edit2, Lock, Copy, Download, Upload } from 'lucide-react';

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
  const navigate = useNavigate();

  const [preset, setPreset] = useState<PresetKey>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const { from, to } = rangeToIso(range);

  // Try API first; fall back to bundled defaults if API unavailable / loading
  const { data: apiConfig, isLoading } = useDashboardBySlug(slug);
  const localDefault = getDefaultBySlug(slug);
  const config: DashboardConfig | undefined = apiConfig ?? localDefault;

  const updateDashboard = useUpdateDashboard();
  const cloneDashboard = useCloneDashboard();

  const ctx = { vehicleId: defaultVehicleId, from, to };

  async function handleClone() {
    if (!config) return;
    const cloned = await cloneDashboard.mutateAsync(config.id);
    navigate({ to: '/d/$slug', params: { slug: cloned.slug }, search: { edit: '1' } } as never);
  }

  function handleExport() {
    if (config) downloadDashboardYaml(config);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const imported = importDashboardYaml(text);
      await updateDashboard.mutateAsync(imported);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    e.target.value = '';
  }

  const canEdit = config && !config.isLocked;
  const isLocked = config?.isLocked;

  return (
    <AppLayout activeKey={navKey}>
      <PageLayout
        title={title ?? config?.name ?? slug}
        actions={
          <div className="flex items-center gap-2">
            {config?.controls.dateRange && (
              <DateRangePicker
                value={range}
                preset={preset}
                onChange={(r, p) => { setRange(r); if (p) setPreset(p); }}
              />
            )}

            {isLocked && (
              <button
                onClick={handleClone}
                title="Customize (creates your own copy)"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                Customize
              </button>
            )}

            {canEdit && (
              <button
                onClick={() => navigate({ to: '/d/$slug', params: { slug: config!.slug }, search: { edit: '1' } } as never)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </button>
            )}

            {isLocked && (
              <Lock className="h-3.5 w-3.5 text-fg-tertiary" aria-label="Default dashboard (locked)" />
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
          </div>
        }
      >
        {!defaultVehicleId ? (
          <NoVehicleState />
        ) : isLoading && !config ? (
          <div className="text-xs text-fg-tertiary p-4">Loading…</div>
        ) : config ? (
          <DashboardRenderer config={config} ctx={ctx} mode="view" />
        ) : null}
      </PageLayout>
    </AppLayout>
  );
}
