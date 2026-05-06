import React from 'react';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import {
  createDefaultDashboardEditActions,
  renderDefaultDashboardTitleAction,
  type DashboardPageProps,
} from './DashboardPage';
import { DashboardPageShell } from './DashboardPageShell';

export function OverviewDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const updateDashboard = useUpdateDashboard();

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions(updateDashboard)}
      showEfficiencyDisplayToggle
    />
  );
}
