import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useVehicles } from '@riviamigo/hooks';
import { PageLayout, Card, CardHeader, CardTitle, CardContent, Button, Badge, ThemeToggle, } from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { Car, LogOut, Plus } from 'lucide-react';
export const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsPage,
});
function SettingsPage() {
    return _jsx(AuthGuard, { children: _jsx(SettingsContent, {}) });
}
function SettingsContent() {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const { data: vehicles } = useVehicles();
    async function handleLogout() {
        await logout();
        navigate({ to: '/login' });
    }
    return (_jsx(AppLayout, { activeKey: "settings", children: _jsxs(PageLayout, { title: "Settings", children: [_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Vehicles" }), _jsx(Button, { variant: "secondary", size: "sm", iconLeft: _jsx(Plus, { className: "h-3.5 w-3.5" }), onClick: () => navigate({ to: '/connect' }), children: "Add Vehicle" })] }), _jsxs(CardContent, { children: [(vehicles?.length ?? 0) === 0 && (_jsx("p", { className: "text-sm text-fg-tertiary", children: "No vehicles connected yet." })), vehicles?.map((v) => (_jsxs("div", { className: "flex items-center gap-3 py-3 border-b border-border last:border-0", children: [_jsx("div", { className: "w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center", children: _jsx(Car, { className: "h-4 w-4 text-fg-secondary" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("p", { className: "text-sm font-medium text-fg truncate", children: v.display_name }), _jsxs("p", { className: "text-xs text-fg-tertiary", children: [v.model, " \u00B7 ", v.year] })] }), _jsx(Badge, { variant: "success", dot: true, children: "Active" })] }, v.id)))] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Appearance" }) }), _jsx(CardContent, { children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-fg", children: "Theme" }), _jsx("p", { className: "text-xs text-fg-tertiary mt-0.5", children: "Toggle between dark and light mode" })] }), _jsx(ThemeToggle, {})] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Account" }) }), _jsx(CardContent, { children: _jsx(Button, { variant: "danger", size: "sm", iconLeft: _jsx(LogOut, { className: "h-3.5 w-3.5" }), onClick: handleLogout, children: "Sign Out" }) })] })] }) }));
}
