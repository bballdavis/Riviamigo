import { jsx as _jsx } from "react/jsx-runtime";
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DashboardPage } from '../components/dashboard/DashboardPage';
export function TripsContent() {
    return _jsx(DashboardPage, { navKey: "trips", slug: "trips", title: "Trips" });
}
export const tripsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/trips',
    component: TripsContent,
});
