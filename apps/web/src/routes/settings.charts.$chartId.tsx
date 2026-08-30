import { createRoute, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { ChartEditorPage } from '../features/charts/editor/ChartEditorPage';

export const settingsChartsEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/charts/$chartId',
  component: SettingsChartsEditPage,
});

function SettingsChartsEditPage() {
  const { chartId } = useParams({ from: '/settings/charts/$chartId' });
  return <ProtectedRoute><ChartEditorPage mode="edit" chartId={chartId} /></ProtectedRoute>;
}
