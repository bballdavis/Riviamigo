import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { OverviewDashboardPage } from '../components/dashboard/OverviewDashboardPage';

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <OverviewDashboardPage navKey="dashboard" slug="dashboard" title="Overview" />,
});
