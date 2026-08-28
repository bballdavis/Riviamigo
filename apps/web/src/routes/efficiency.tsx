import React from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { EfficiencyDashboardPage } from '../components/dashboard/EfficiencyDashboardPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { useResolvedVehicleSelection } from '@riviamigo/hooks';
import { createTripTagFilterAdapter, tripTagSearchSchema } from '../features/trip-tags/tripTagFilter';

function EfficiencyContent() {
  const search = useSearch({ from: '/efficiency' });
  const navigate = useNavigate();
  const { effectiveVehicleId, vehicles } = useResolvedVehicleSelection();
  const tripTagFilter = React.useMemo(
    () => createTripTagFilterAdapter(search, (nextSearch) => navigate({ to: '/efficiency', search: nextSearch, replace: true })),
    [navigate, search],
  );
  const membership = vehicles.find((vehicle) => vehicle.id === effectiveVehicleId)?.membership_role;
  const canManageTripTags = membership === 'owner' || membership === 'manager';

  return (
    <ProtectedRoute>
      <EfficiencyDashboardPage
        navKey="efficiency"
        slug="efficiency"
        title="Efficiency"
        widgetCtx={{
          tripTagFilter,
          canManageTripTags,
        }}
      />
    </ProtectedRoute>
  );
}

export const efficiencyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/efficiency',
  validateSearch: tripTagSearchSchema,
  component: EfficiencyContent,
});
