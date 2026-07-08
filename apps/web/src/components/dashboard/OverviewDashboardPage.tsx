import React from 'react';
import { DashboardPage, type DashboardPageProps } from './DashboardPage';

export function OverviewDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  return (
    <DashboardPage
      navKey={navKey}
      slug={slug}
      title={title}
      showEfficiencyDisplayToggle
    />
  );
}
