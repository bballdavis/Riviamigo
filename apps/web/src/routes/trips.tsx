import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DrivesDashboardPage } from '../components/dashboard/DrivesDashboardPage';

export function TripsContent() {
  return <DrivesDashboardPage navKey="trips" slug="trips" title="Trips" />;
}

export const tripsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips',
  component: TripsContent,
});
