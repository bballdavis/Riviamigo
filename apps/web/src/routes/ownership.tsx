import { createRoute } from '@tanstack/react-router';
import { OwnershipContent } from '../features/ownership/OwnershipPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { rootRoute } from './__root';

export const ownershipRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ownership',
  component: OwnershipPage,
});

function OwnershipPage() {
  return <ProtectedRoute><OwnershipContent /></ProtectedRoute>;
}
