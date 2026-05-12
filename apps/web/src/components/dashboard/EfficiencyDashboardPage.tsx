import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateDashboard, useUpdateDashboard } from '@riviamigo/dashboards';
import { createDefaultDashboardEditActions, renderDefaultDashboardTitleAction, type DashboardPageProps } from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

export function EfficiencyDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();
  const createDashboard = useCreateDashboard();
  const qc = useQueryClient();

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions({ updateDashboard, createDashboard, qc })}
      showEfficiencyDisplayToggle
    />
  );
}
