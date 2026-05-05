import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { BatteryDashboardPage } from '../components/dashboard/BatteryDashboardPage';

export const batteryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/battery',
  component: () => <BatteryDashboardPage navKey="battery" slug="battery" title="Battery" />,
});
