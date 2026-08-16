import React from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { DashboardPageShell } from '../components/dashboard/DashboardPageShell';
import { useResolvedVehicleSelection } from '@riviamigo/hooks';

const searchSchema = z.object({
  tag_ids: z.string().optional(),
  tag_match: z.enum(['all', 'any']).optional(),
  untagged: z.literal('1').optional(),
});

export function TripsContent() {
  return <ProtectedRoute><TripsDashboardPage /></ProtectedRoute>;
}

function TripsDashboardPage() {
  const search = useSearch({ from: '/trips' });
  const navigate = useNavigate();
  const { effectiveVehicleId, vehicles } = useResolvedVehicleSelection();
  const tagIds = React.useMemo(() => [...new Set((search.tag_ids ?? '').split(',').filter(Boolean))].sort(), [search.tag_ids]);
  const untagged = search.untagged === '1' && tagIds.length === 0;
  const membership = vehicles.find((vehicle) => vehicle.id === effectiveVehicleId)?.membership_role;
  const canManageTripTags = membership === 'owner' || membership === 'manager';
  const setFilter = React.useCallback((next: { tagIds: string[]; tagMatch: 'all' | 'any'; untagged: boolean }) => {
    const sortedIds = [...new Set(next.tagIds)].sort();
    navigate({
      to: '/trips',
      search: sortedIds.length
        ? { tag_ids: sortedIds.join(','), ...(next.tagMatch === 'any' ? { tag_match: 'any' as const } : {}) }
        : next.untagged ? { untagged: '1' as const } : {},
      replace: true,
    });
  }, [navigate]);

  return (
    <DashboardPageShell
      navKey="trips"
      slug="trips"
      title="Trips"
      showEfficiencyDisplayToggle
      widgetCtx={{
        tripTagFilter: { tagIds, tagMatch: search.tag_match ?? 'all', untagged, setFilter },
        canManageTripTags,
      }}
    />
  );
}

export const tripsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trips',
  validateSearch: searchSchema,
  component: TripsContent,
});
