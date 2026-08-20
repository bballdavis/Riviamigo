import React from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { DashboardPageShell } from '../components/dashboard/DashboardPageShell';
import { useResolvedVehicleSelection } from '@riviamigo/hooks';
import { createTripTagFilterAdapter, tripTagSearchSchema } from '../features/trip-tags/tripTagFilter';

export function TripsContent() {
  return <ProtectedRoute><TripsDashboardPage /></ProtectedRoute>;
}

function TripsDashboardPage() {
  const search = useSearch({ from: '/trips' });
  const navigate = useNavigate();
  const { effectiveVehicleId, vehicles } = useResolvedVehicleSelection();
  const tripTagFilter = React.useMemo(
    () => createTripTagFilterAdapter(search, (nextSearch) => navigate({ to: '/trips', search: nextSearch, replace: true })),
    [navigate, search],
  );
  const membership = vehicles.find((vehicle) => vehicle.id === effectiveVehicleId)?.membership_role;
  const canManageTripTags = membership === 'owner' || membership === 'manager';

  return (
    <DashboardPageShell
      navKey="trips"
      slug="trips"
      title="Trips"
      showEfficiencyDisplayToggle
      widgetCtx={{
        tripTagFilter,
        canManageTripTags,
      }}
    />
  );
}

export const tripsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips',
  validateSearch: tripTagSearchSchema,
  component: TripsContent,
});
