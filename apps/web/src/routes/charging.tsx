import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { ChargingDashboardPage } from '../components/dashboard/ChargingDashboardPage';

export const chargingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/charging',
  component: () => <ChargingDashboardPage navKey="charging" slug="charging" title="Charging" />,
});
