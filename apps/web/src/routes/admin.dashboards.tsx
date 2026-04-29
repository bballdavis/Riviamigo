import React from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { PageLayout } from '@riviamigo/ui/primitives';
import { useDashboards } from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { Lock, Unlock, Edit2, ExternalLink } from 'lucide-react';
import { useAuth } from '@riviamigo/hooks';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export const adminDashboardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/dashboards',
  component: AdminDashboardsWrapper,
});

function AdminDashboardsWrapper() {
  return <AuthGuard><AdminDashboardsPage /></AuthGuard>;
}

function AdminDashboardsPage() {
  const navigate = useNavigate();
  const { data: dashboards, isLoading } = useDashboards();
  const { accessToken } = useAuth();
  const qc = useQueryClient();

  const toggleLock = useMutation({
    mutationFn: async ({ id, locked }: { id: string; locked: boolean }) => {
      const res = await fetch(`/v1/admin/dashboards/${id}/lock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ locked }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });

  const defaults = dashboards?.filter((d) => d.isDefault) ?? [];
  const userDashboards = dashboards?.filter((d) => !d.isDefault) ?? [];

  function DashRow({ d }: { d: DashboardConfig }) {
    return (
      <div className="flex items-center gap-3 py-3 px-4 border-b border-border last:border-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-fg truncate">{d.name}</p>
          <p className="text-xs text-fg-tertiary">{d.slug} · {d.widgets.length} widgets</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate({ to: '/d/$slug', params: { slug: d.slug } } as never)}
            className="p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg"
            title="View"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          {d.isDefault && (
            <>
              <button
                onClick={() => navigate({ to: '/d/$slug', params: { slug: d.slug }, search: { edit: '1' } } as never)}
                className="p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg"
                title="Edit (admin)"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => toggleLock.mutate({ id: d.id, locked: !d.isLocked })}
                className="p-1.5 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg"
                title={d.isLocked ? 'Unlock' : 'Lock'}
              >
                {d.isLocked
                  ? <Lock className="h-3.5 w-3.5" />
                  : <Unlock className="h-3.5 w-3.5" />}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <AppLayout activeKey="settings">
      <PageLayout title="Admin: Dashboards">
        {isLoading ? (
          <div className="text-xs text-fg-tertiary p-4">Loading…</div>
        ) : (
          <div className="space-y-6">
            <section>
              <h2 className="text-xs font-medium text-fg-tertiary uppercase tracking-wider mb-2">
                System Defaults
              </h2>
              <div className="rounded-xl border border-border bg-bg divide-y divide-border overflow-hidden">
                {defaults.length === 0 ? (
                  <p className="text-xs text-fg-tertiary p-4">No system defaults found.</p>
                ) : (
                  defaults.map((d) => <DashRow key={d.id} d={d} />)
                )}
              </div>
            </section>

            <section>
              <h2 className="text-xs font-medium text-fg-tertiary uppercase tracking-wider mb-2">
                User Dashboards
              </h2>
              <div className="rounded-xl border border-border bg-bg overflow-hidden">
                {userDashboards.length === 0 ? (
                  <p className="text-xs text-fg-tertiary p-4">No user dashboards yet.</p>
                ) : (
                  userDashboards.map((d) => <DashRow key={d.id} d={d} />)
                )}
              </div>
            </section>
          </div>
        )}
      </PageLayout>
    </AppLayout>
  );
}
