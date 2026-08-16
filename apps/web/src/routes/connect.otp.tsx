import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ConnectOtpContent } from '../features/connect/ConnectOtpPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { rootRoute } from './__root';

const searchSchema = z.object({
  challenge_id: z.string(),
  email: z.string().optional(),
  mode: z.enum(['add', 'refresh']).optional(),
  vehicle_id: z.string().optional(),
});

export const connectOtpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connect/otp',
  validateSearch: searchSchema,
  component: ConnectOtpPage,
});

function ConnectOtpPage() {
  return <ProtectedRoute><ConnectOtpContent /></ProtectedRoute>;
}

export { ConnectOtpContent } from '../features/connect/ConnectOtpPage';
