import { jsx as _jsx } from "react/jsx-runtime";
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { DashboardContent } from '@riviamigo/dashboards';
export const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: DashboardPage,
});
function DashboardPage() {
    return (_jsx(AuthGuard, { children: _jsx(AppLayout, { activeKey: "dashboard", children: _jsx(DashboardContent, {}) }) }));
}
