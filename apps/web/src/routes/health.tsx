import { createRoute } from '@tanstack/react-router';
import { VehicleHealthContent } from '../features/health/VehicleHealthPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { rootRoute } from './__root';

export const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/vehicle-health',
  component: VehicleHealthPage,
});

function VehicleHealthPage() {
  return <ProtectedRoute><VehicleHealthContent /></ProtectedRoute>;
}
