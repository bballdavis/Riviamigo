import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { ChargingDashboardPage } from '../components/dashboard/ChargingDashboardPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';

export const chargingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/charging',
  component: () => (
    <ProtectedRoute>
      <ChargingDashboardPage navKey="charging" slug="charging" title="Charging" />
    </ProtectedRoute>
  ),
});
