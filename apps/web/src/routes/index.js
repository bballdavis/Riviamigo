import { jsx as _jsx } from "react/jsx-runtime";
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DashboardPage } from '../components/dashboard/DashboardPage';
export const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => _jsx(DashboardPage, { navKey: "dashboard", slug: "dashboard", title: "Dashboard" }),
});
