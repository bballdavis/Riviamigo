import { createRoute } from '@tanstack/react-router';
import { TripDetailContent } from '../features/trips/TripDetailPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { rootRoute } from './__root';

export const tripDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips/$tripId',
  component: TripDetailPage,
});

function TripDetailPage() {
  return <ProtectedRoute><TripDetailContent /></ProtectedRoute>;
}

export { TripDetailContent } from '../features/trips/TripDetailPage';
