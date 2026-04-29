import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DashboardPage } from '../components/dashboard/DashboardPage';

export const tripsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips',
  component: () => <DashboardPage navKey="trips" slug="trips" title="Trips" />,
});
