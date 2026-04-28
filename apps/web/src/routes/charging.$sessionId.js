import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useChargeSession, useChargeCurve } from '@riviamigo/hooks';
import { PageLayout, ChartSection, StatCardGrid, StatCard, Button, } from '@riviamigo/ui/primitives';
import { ChargeCurveChart } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { formatKwh, formatDuration, formatCurrency, formatPercent } from '@riviamigo/ui/lib/utils';
import { format, parseISO } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
export const chargingDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/charging/$sessionId',
    component: ChargeSessionDetailPage,
});
function ChargeSessionDetailPage() {
    return _jsx(AuthGuard, { children: _jsx(ChargeSessionContent, {}) });
}
function ChargeSessionContent() {
    const { defaultVehicleId } = useAuth();
    const navigate = useNavigate();
    const { sessionId } = useParams({ from: '/charging/$sessionId' });
    const { data: session } = useChargeSession(sessionId, defaultVehicleId);
    const { data: curve, isLoading: curveLoading } = useChargeCurve(sessionId, defaultVehicleId);
    const title = session
        ? format(parseISO(session.started_at), 'MMMM d, yyyy · h:mm a')
        : 'Charge Session';
    return (_jsx(AppLayout, { activeKey: "charging", children: _jsxs(PageLayout, { title: title, subtitle: session?.location_name ?? undefined, actions: _jsx(Button, { variant: "ghost", size: "sm", iconLeft: _jsx(ArrowLeft, { className: "h-4 w-4" }), onClick: () => navigate({ to: '/charging' }), children: "Back" }), children: [_jsxs(StatCardGrid, { children: [_jsx(StatCard, { label: "Energy Added", value: session ? formatKwh(session.energy_added_kwh ?? 0) : '—', accent: true }), _jsx(StatCard, { label: "SoC", value: session?.soc_start != null && session?.soc_end != null
                                ? `${formatPercent(session.soc_start, 0)} → ${formatPercent(session.soc_end, 0)}`
                                : '—' }), _jsx(StatCard, { label: "Duration", value: session ? formatDuration(session.duration_min ?? 0) : '—' }), _jsx(StatCard, { label: "Cost", value: session?.cost_usd !== undefined ? formatCurrency(session.cost_usd ?? 0) : '—' })] }), _jsx(ChartSection, { title: "Charge Curve", subtitle: "Power vs state of charge", children: _jsx(ChargeCurveChart, { data: (curve ?? []).map((p) => ({ soc: p.soc_pct, power_kw: p.power_kw })), loading: curveLoading, height: 240 }) })] }) }));
}
