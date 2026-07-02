import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { BatteryDashboardPage } from '../components/dashboard/BatteryDashboardPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';

export const batteryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/battery',
  component: () => (
    <ProtectedRoute>
      <BatteryDashboardPage navKey="battery" slug="battery" title="Battery" />
    </ProtectedRoute>
  ),
});
