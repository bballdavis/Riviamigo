import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DashboardPage } from '../components/dashboard/DashboardPage';

export const chargingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/charging',
  component: () => <DashboardPage navKey="charging" slug="charging" title="Charging" />,
});
