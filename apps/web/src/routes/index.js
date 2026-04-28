import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useSummaryStats, useVehicles, useSocHistory } from '@riviamigo/hooks';
import { PageLayout, StatCardGrid, StatCard, ChartSection, StatCardSkeleton, EmptyState, DateRangePicker, } from '@riviamigo/ui/primitives';
import { SocAreaChart } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { formatMiles, formatKwh } from '@riviamigo/ui/lib/utils';
import { presetToRange, rangeToIso, DEFAULT_PRESET } from '../lib/dates';
import { Car } from 'lucide-react';
export const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: DashboardPage,
});
function DashboardPage() {
    return (_jsx(AuthGuard, { children: _jsx(DashboardContent, {}) }));
}
function DashboardContent() {
    const { defaultVehicleId } = useAuth();
    const navigate = useNavigate();
    const [preset, setPreset] = useState(DEFAULT_PRESET);
    const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
    const { from, to } = rangeToIso(range);
    const { data: stats, isLoading: statsLoading } = useSummaryStats(defaultVehicleId);
    const { data: socData, isLoading: socLoading } = useSocHistory(defaultVehicleId, from, to);
    const { data: vehicles } = useVehicles();
    const hasVehicle = !!defaultVehicleId;
    return (_jsx(AppLayout, { activeKey: "dashboard", children: _jsx(PageLayout, { title: "Dashboard", subtitle: vehicles?.[0]?.display_name ?? undefined, actions: _jsx(DateRangePicker, { value: range, preset: preset, onChange: (r, p) => { setRange(r); if (p)
                    setPreset(p); } }), children: !hasVehicle ? (_jsx(EmptyState, { icon: _jsx(Car, {}), title: "No vehicle connected", description: "Connect your Rivian account to start tracking telemetry.", action: { label: 'Connect Rivian', onClick: () => navigate({ to: '/connect' }) } })) : (_jsxs(_Fragment, { children: [_jsx(StatCardGrid, { children: statsLoading ? (Array.from({ length: 4 }).map((_, i) => _jsx(StatCardSkeleton, {}, i))) : (_jsxs(_Fragment, { children: [_jsx(StatCard, { label: "Total Miles", value: formatMiles(stats?.total_miles ?? 0), accent: true }), _jsx(StatCard, { label: "Total Trips", value: stats?.total_trips ?? 0 }), _jsx(StatCard, { label: "Energy Used", value: formatKwh(stats?.total_energy_kwh ?? 0) }), _jsx(StatCard, { label: "Avg Efficiency", value: stats?.avg_efficiency_wh_mi?.toFixed(0) ?? '—', unit: "Wh/mi" })] })) }), _jsx(ChartSection, { title: "State of Charge", subtitle: `Last ${preset}`, children: _jsx(SocAreaChart, { data: socData ?? [], loading: socLoading, height: 240 }) })] })) }) }));
}
