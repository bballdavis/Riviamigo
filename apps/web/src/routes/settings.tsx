import { createRoute } from '@tanstack/react-router';
import { SettingsContent } from '../features/settings/SettingsPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { rootRoute } from './__root';

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

function SettingsPage() {
  return <ProtectedRoute><SettingsContent /></ProtectedRoute>;
}

export { SettingsContent } from '../features/settings/SettingsPage';
