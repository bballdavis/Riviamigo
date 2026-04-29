import { jsx as _jsx } from "react/jsx-runtime";
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DashboardPage } from '../components/dashboard/DashboardPage';
export const chargingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/charging',
    component: () => _jsx(DashboardPage, { navKey: "charging", slug: "charging", title: "Charging" }),
});
