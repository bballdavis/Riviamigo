import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { UserManagementPage } from '../components/users/UserManagementPage';

export const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  component: UsersPage,
});

function UsersPage() {
  return <ProtectedRoute><UserManagementPage /></ProtectedRoute>;
}
