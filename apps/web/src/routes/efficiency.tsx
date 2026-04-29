import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DashboardPage } from '../components/dashboard/DashboardPage';

export const efficiencyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/efficiency',
  component: () => <DashboardPage navKey="efficiency" slug="efficiency" title="Efficiency" />,
});
