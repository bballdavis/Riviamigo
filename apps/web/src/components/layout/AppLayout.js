import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useNavigate } from '@tanstack/react-router';
import { Sidebar, StatusBar, AmbientOrbs, ThemeToggle } from '@riviamigo/ui/primitives';
import { useAuth } from '@riviamigo/hooks';
import { useVehicleStatus } from '@riviamigo/hooks';
import { LogOut, Settings } from 'lucide-react';
export function AppLayout({ children, activeKey }) {
    const navigate = useNavigate();
    const { accessToken, defaultVehicleId, logout } = useAuth();
    const { status, connected } = useVehicleStatus(defaultVehicleId, accessToken);
    const onlineState = !defaultVehicleId
        ? 'offline'
        : connected
            ? 'online'
            : 'connecting';
    async function handleLogout() {
        await logout();
        navigate({ to: '/login' });
    }
    return (_jsxs("div", { className: "min-h-screen bg-bg-page text-fg", children: [_jsx(AmbientOrbs, {}), _jsx(Sidebar, { activeKey: activeKey, onNavigate: (href) => navigate({ to: href }), bottomSlot: ({ collapsed }) => (_jsxs("div", { className: "flex flex-col gap-2", children: [_jsxs("button", { type: "button", onClick: () => navigate({ to: '/settings' }), title: "Settings", "aria-label": "Open settings", className: collapsed
                                ? 'w-full flex items-center justify-center py-2 rounded-lg text-fg-secondary hover:text-fg hover:bg-bg-elevated transition-colors'
                                : 'w-full flex items-center gap-2 px-2 py-2 rounded-lg text-fg-secondary hover:text-fg hover:bg-bg-elevated transition-colors', children: [_jsx(Settings, { className: "h-4 w-4 shrink-0" }), !collapsed && _jsx("span", { className: "text-xs font-medium", children: "Settings" })] }), _jsx(StatusBar, { onlineState: onlineState, socPercent: status?.battery_level ?? undefined, isCharging: status?.charger_state === 'Charging', rangeEstimateMi: status?.range_miles ?? undefined, compact: collapsed }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("button", { type: "button", onClick: handleLogout, title: "Sign out", "aria-label": "Sign out", className: "flex items-center justify-center w-8 h-8 rounded-lg text-fg-tertiary hover:text-fg hover:bg-bg-elevated transition-colors duration-150", children: _jsx(LogOut, { className: "h-4 w-4" }) }), _jsx(ThemeToggle, {})] })] })) }), _jsx("main", { className: "lg:pl-64 transition-all duration-200", children: _jsx("div", { className: "p-4 sm:p-6 max-w-7xl mx-auto", children: children }) })] }));
}
