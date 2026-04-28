import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useNavigate } from '@tanstack/react-router';
import { Sidebar, StatusBar, AmbientOrbs, ThemeToggle } from '@riviamigo/ui/primitives';
import { useAuth } from '@riviamigo/hooks';
import { useVehicleStatus } from '@riviamigo/hooks';
export function AppLayout({ children, activeKey }) {
    const navigate = useNavigate();
    const { accessToken, defaultVehicleId } = useAuth();
    const { status, connected } = useVehicleStatus(defaultVehicleId, accessToken);
    const onlineState = !defaultVehicleId
        ? 'offline'
        : connected
            ? 'online'
            : 'connecting';
    return (_jsxs("div", { className: "min-h-screen bg-bg-page text-fg", children: [_jsx(AmbientOrbs, {}), _jsx(Sidebar, { activeKey: activeKey, onNavigate: (href) => navigate({ to: href }), bottomSlot: _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx(StatusBar, { onlineState: onlineState, socPercent: status?.battery_level ?? undefined, isCharging: status?.charger_state === 'Charging', rangeEstimateMi: status?.range_miles ?? undefined }), _jsx(ThemeToggle, {})] }) }), _jsx("main", { className: "lg:pl-64 transition-all duration-200", children: _jsx("div", { className: "p-4 sm:p-6 max-w-7xl mx-auto", children: children }) })] }));
}
