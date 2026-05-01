import React from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root';
import {
  useUpdateDashboard,
  useCloneDashboard,
  downloadDashboardYaml,
  importDashboardYaml,
} from '@riviamigo/dashboards';
import { AuthGuard } from '../components/layout/AuthGuard';
import { Edit2, Lock, Copy, Check, X, Download, Upload } from 'lucide-react';
import { DashboardPageShell } from '../components/dashboard/DashboardPageShell';

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

  const isEditMode = search.edit === '1';
  const updateDashboard = useUpdateDashboard();
  const cloneDashboard = useCloneDashboard();

  return (
    <DashboardPageShell
      navKey="dashboard"
      slug={slug}
      isEditMode={isEditMode}
      onEditModeChange={(next) => {
        navigate({
          to: '/d/$slug',
          params: { slug },
          search: next ? { edit: '1' } : {},
        });
      }}
      renderActions={({ activeConfig, localConfig, setLocalConfig, isEditMode: editing, enterEdit, exitEdit }) => {
        const isLocked = activeConfig?.isLocked ?? false;

        async function handleClone() {
          if (!activeConfig) return;
          const cloned = await cloneDashboard.mutateAsync(activeConfig.id);
          navigate({ to: '/d/$slug', params: { slug: cloned.slug }, search: { edit: '1' } });
        }

        async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
          const file = event.target.files?.[0];
          if (!file) return;
          const text = await file.text();
          try {
            const imported = importDashboardYaml(text);
            setLocalConfig(imported);
            navigate({ to: '/d/$slug', params: { slug }, search: { edit: '1' } });
          } catch (err) {
            alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          event.target.value = '';
        }

        if (editing) {
          return (
            <>
              <button
                onClick={async () => {
                  if (!localConfig) return;
                  await updateDashboard.mutateAsync(localConfig);
                  exitEdit();
                }}
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
          );
        }

        return (
          <>
            {isLocked ? (
              <>
                <button
                  onClick={() => {
                    void handleClone();
                  }}
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
              onClick={() => {
                if (activeConfig) downloadDashboardYaml(activeConfig);
              }}
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
              <input type="file" accept=".yaml,.yml" className="sr-only" onChange={(event) => {
                void handleImport(event);
              }} />
            </label>
          </>
        );
      }}
    />
  );
}
