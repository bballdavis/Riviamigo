import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '@riviamigo/hooks';
import { useCreateDashboard, useUpdateDashboard, useUpdateAdminDashboard } from '@riviamigo/dashboards';
import { createDefaultDashboardEditActions, renderDefaultDashboardTitleAction, type DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

export function DrivesDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();
  const updateAdminDashboard = useUpdateAdminDashboard();
  const createDashboard = useCreateDashboard();
  const qc = useQueryClient();
  const me = useMe();
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
