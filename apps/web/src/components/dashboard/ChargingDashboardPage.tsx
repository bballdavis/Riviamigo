import React from 'react';
import { DashboardPage, type DashboardPageProps } from './DashboardPage';

export function ChargingDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  return <DashboardPage navKey={navKey} slug={slug} title={title} />;
}
