import React from 'react';
import { useCreateDashboard, useUpdateDashboard } from '@riviamigo/dashboards';
import {
  createDefaultDashboardEditActions,
  renderDefaultDashboardTitleAction,
  type DashboardPageProps,
} from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

export function OverviewDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();
  const createDashboard = useCreateDashboard();

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions({ updateDashboard, createDashboard })}
      showEfficiencyDisplayToggle
    />
  );
}
