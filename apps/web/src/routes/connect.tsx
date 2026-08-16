import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ConnectContent } from '../features/connect/ConnectPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { rootRoute } from './__root';

export const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connect',
  validateSearch: z.object({
    mode: z.enum(['add', 'refresh']).optional(),
    vehicle_id: z.string().optional(),
  }),
  component: ConnectPage,
});

function ConnectPage() {
  return <ProtectedRoute><ConnectContent /></ProtectedRoute>;
}

export { ConnectContent } from '../features/connect/ConnectPage';
