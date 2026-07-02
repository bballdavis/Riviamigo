import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DrivesDashboardPage } from '../components/dashboard/DrivesDashboardPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';

export function TripsContent() {
  return (
    <ProtectedRoute>
      <DrivesDashboardPage navKey="trips" slug="trips" title="Trips" />
    </ProtectedRoute>
  );
}

export const tripsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips',
  component: TripsContent,
});
