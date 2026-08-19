import { createRoute } from '@tanstack/react-router';
import { ChargeSessionContent } from '../features/charging/ChargeSessionDetailPage';
import { AuthGuard } from '../components/layout/AuthGuard';
import { rootRoute } from './__root';

export const chargingDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/charging/$sessionId',
  component: ChargeSessionDetailPage,
});

function ChargeSessionDetailPage() {
  return <AuthGuard><ChargeSessionContent /></AuthGuard>;
}

export { ChargeSessionContent } from '../features/charging/ChargeSessionDetailPage';
