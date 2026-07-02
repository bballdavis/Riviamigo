import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { OverviewDashboardPage } from '../components/dashboard/OverviewDashboardPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <ProtectedRoute>
      <OverviewDashboardPage navKey="dashboard" slug="dashboard" title="Overview" />
    </ProtectedRoute>
  ),
});
