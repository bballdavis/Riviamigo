import { jsx as _jsx } from "react/jsx-runtime";
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DashboardPage } from '../components/dashboard/DashboardPage';
export const batteryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/battery',
    component: () => _jsx(DashboardPage, { navKey: "battery", slug: "battery", title: "Battery" }),
});
