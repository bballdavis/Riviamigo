import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { EfficiencyDashboardPage } from '../components/dashboard/EfficiencyDashboardPage';

export const efficiencyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/efficiency',
  component: () => <EfficiencyDashboardPage navKey="efficiency" slug="efficiency" title="Efficiency" />,
});
