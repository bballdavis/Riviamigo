import React from 'react';
import { Download, ExternalLink, Lock, Pencil, RotateCcw, Trash2, Unlock } from 'lucide-react';
import { Badge, Button } from '@riviamigo/ui/primitives';
import { downloadDashboardYaml, getDefaultBySlug } from '@riviamigo/dashboards';
import type {
  DashboardConfig,
  useCloneDashboard,
  useCreateDashboard,
  useDeleteDashboard,
  useRestoreAdminDashboardDefault,
  useSetAdminDashboardLock,
} from '@riviamigo/dashboards';
import { SettingsConfirmationDialog, type SettingsConfirmation } from './SettingsConfirmationDialog';

export function dashboardActionId(dashboard: DashboardConfig) {
  if (!dashboard.isDefault) return dashboard.id;
  return getDefaultBySlug(dashboard.slug)?.id ?? dashboard.id;
}

export function DashboardSettingsList({
  title,
  dashboards,
  canManageDefaults,
  cloneDashboard,
  deleteDashboard,
  setDashboardLock,
  restoreDefaultDashboard,
  createDashboard,
  userBySlug,
  defaultBySlug,
  onCustomize,
  onDuplicate,
  onEdit,
}: {
  title: string;
  dashboards: DashboardConfig[];
  canManageDefaults: boolean;
  cloneDashboard: ReturnType<typeof useCloneDashboard>;
  deleteDashboard: ReturnType<typeof useDeleteDashboard>;
  setDashboardLock: ReturnType<typeof useSetAdminDashboardLock>;
  restoreDefaultDashboard: ReturnType<typeof useRestoreAdminDashboardDefault>;
  createDashboard: ReturnType<typeof useCreateDashboard>;
  userBySlug: Map<string, DashboardConfig>;
  defaultBySlug: Map<string, DashboardConfig>;
  onCustomize: (dashboard: DashboardConfig) => Promise<void>;
  onDuplicate: (dashboard: DashboardConfig) => void;
  onEdit: (dashboard: DashboardConfig, edit: boolean) => void;
}) {
  const [confirmation, setConfirmation] = React.useState<SettingsConfirmation | null>(null);
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-fg-tertiary">{title}</h3>
        <span className="text-xs text-fg-tertiary">{dashboards.length}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        {dashboards.length === 0 ? (
          <div className="p-4 text-sm text-fg-tertiary">No dashboards here yet.</div>
        ) : (
          dashboards.map((dashboard) => {
            const isUserOwned = dashboard.ownerId != null;
            const canEdit = isUserOwned || (dashboard.isDefault && canManageDefaults);
            const personalCopy = userBySlug.get(dashboard.slug);
            const systemDefault = defaultBySlug.get(dashboard.slug);
            const isActive = isUserOwned || !personalCopy;
            return (
              <div
                key={dashboard.id}
                className="grid gap-3 border-b border-border bg-bg last:border-0 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-fg">{dashboard.name}</p>
                    <Badge variant={dashboard.isDefault ? 'info' : 'default'} size="sm">
                      {dashboard.isDefault ? 'Default' : 'User'}
                    </Badge>
                    {dashboard.isLocked ? <Badge variant="warning" size="sm">Locked</Badge> : null}
                    {isActive ? <Badge variant="success" size="sm">Active for you</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-fg-tertiary">
                    {dashboard.slug} &middot; {dashboard.widgets.length} widgets
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 [&>button]:min-h-11 sm:[&>button]:min-h-8">
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<ExternalLink className="h-3.5 w-3.5" />}
                    onClick={() => onEdit(dashboard, false)}
                  >
                    {dashboard.isDefault ? 'Open default' : 'Open'}
                  </Button>
                  {canEdit ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      iconLeft={<Pencil className="h-3.5 w-3.5" />}
                      onClick={() => onEdit(dashboard, true)}
                    >
                      {dashboard.isDefault ? 'Edit default' : 'Edit'}
                    </Button>
                  ) : null}
                  {dashboard.isDefault ? (
                    personalCopy ? null : (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={createDashboard.isPending}
                        onClick={() => { void onCustomize(dashboard); }}
                      >
                        Customize
                      </Button>
                    )
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={cloneDashboard.isPending && cloneDashboard.variables === dashboard.id}
                      onClick={() => { void onDuplicate(dashboard); }}
                    >
                      Duplicate
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<Download className="h-3.5 w-3.5" />}
                    onClick={() => downloadDashboardYaml(dashboard)}
                  >
                    Export
                  </Button>
                  {dashboard.isDefault && canManageDefaults ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        iconLeft={dashboard.isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                        loading={setDashboardLock.isPending && setDashboardLock.variables?.id === dashboardActionId(dashboard)}
                        onClick={() => setDashboardLock.mutate({ id: dashboardActionId(dashboard), locked: !dashboard.isLocked })}
                      >
                        {dashboard.isLocked ? 'Unlock' : 'Lock'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
                        loading={restoreDefaultDashboard.isPending && restoreDefaultDashboard.variables === dashboardActionId(dashboard)}
                        onClick={() => setConfirmation({
                          title: `Restore "${dashboard.name}" to the bundled default layout?`,
                          confirmLabel: 'Restore bundled',
                          run: () => restoreDefaultDashboard.mutateAsync(dashboardActionId(dashboard)),
                        })}
                      >
                        Restore bundled
                      </Button>
                    </>
                  ) : null}
                  {isUserOwned ? (
                    <Button
                      variant="danger"
                      size="sm"
                      iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                      loading={deleteDashboard.isPending && deleteDashboard.variables === dashboard.id}
                      onClick={() => setConfirmation({
                        title: systemDefault
                          ? `Reset "${dashboard.name}" to the system default? This removes your personal dashboard copy.`
                          : `Delete "${dashboard.name}"? This removes your saved dashboard.`,
                        confirmLabel: systemDefault ? 'Reset to default' : 'Delete',
                        run: () => deleteDashboard.mutateAsync(dashboard.id),
                      })}
                    >
                      {systemDefault ? 'Reset to default' : 'Delete'}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      {confirmation ? (
        <SettingsConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
      ) : null}
    </section>
  );
}
