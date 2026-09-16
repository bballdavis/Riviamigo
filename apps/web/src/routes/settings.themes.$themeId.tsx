import { createRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { ThemeStudioPage } from '../features/settings/ThemeStudioPage';
import { rootRoute } from './__root';

export const settingsThemeStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/themes/$themeId',
  component: ThemeStudioRoute,
});

function ThemeStudioRoute() {
  const { themeId } = settingsThemeStudioRoute.useParams();
  return <ProtectedRoute><ThemeStudioPage themeId={themeId} /></ProtectedRoute>;
}
