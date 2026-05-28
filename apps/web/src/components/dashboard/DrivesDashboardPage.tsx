import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, useAuth } from '@riviamigo/hooks';
import { useCreateDashboard, useUpdateDashboard, useUpdateAdminDashboard } from '@riviamigo/dashboards';
import { createDefaultDashboardEditActions, renderDefaultDashboardTitleAction, type DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

export function DrivesDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();
  const updateAdminDashboard = useUpdateAdminDashboard();
  const createDashboard = useCreateDashboard();
  const qc = useQueryClient();
  const isAuthenticated = useAuth((state) => state.isAuthenticated);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), enabled: isAuthenticated });
  const isAdmin = me.data?.role === 'admin';

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions({ updateDashboard, updateAdminDashboard, createDashboard, qc, isAdmin })}
      showEfficiencyDisplayToggle
    />
  );
}
