import React from 'react';
import { useAuth, useCurrentVehicleStatus, useVehicles } from '@riviamigo/hooks';
import { useUpdateDashboard } from '@riviamigo/dashboards';
import { DashboardPageShell } from './DashboardPageShell';
import {
  createDefaultDashboardEditActions,
  CurrentVehicleStatePanel,
  renderDefaultDashboardTitleAction,
  type DashboardPageProps,
} from './DashboardPage';

export function OverviewDashboardPage({ navKey, slug, title }: DashboardPageProps) {
  const { defaultVehicleId } = useAuth();
  const updateDashboard = useUpdateDashboard();
  const { data: currentStatus } = useCurrentVehicleStatus(defaultVehicleId);
  const { data: vehicles } = useVehicles();
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === defaultVehicleId);

  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      renderTitleAction={renderDefaultDashboardTitleAction}
      renderActions={createDefaultDashboardEditActions(updateDashboard)}
      renderBeforeDashboard={({ isEditMode }) => (
        !isEditMode ? (
          <CurrentVehicleStatePanel status={currentStatus} images={activeVehicle?.images} />
        ) : null
      )}
    />
  );
}