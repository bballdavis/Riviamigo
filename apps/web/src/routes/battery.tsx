import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DashboardPage } from '../components/dashboard/DashboardPage';

export const batteryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/battery',
  component: () => <DashboardPage navKey="battery" slug="battery" title="Battery" />,
});
