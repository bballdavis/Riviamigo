import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { ChartEditorPage } from '../features/charts/editor/ChartEditorPage';

export const settingsChartsNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/charts/new',
  component: SettingsChartsNewPage,
});

function SettingsChartsNewPage() {
  return <ProtectedRoute><ChartEditorPage mode="new" /></ProtectedRoute>;
}
