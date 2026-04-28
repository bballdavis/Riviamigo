import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useChargeSessions, useChargingSummary } from '@riviamigo/hooks';
import { PageLayout, ChartSection, StatCardGrid, StatCard, DateRangePicker, } from '@riviamigo/ui/primitives';
import { EnergyBarChart } from '@riviamigo/ui/charts';
import { DataTable, chargingColumns } from '@riviamigo/ui/tables';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { presetToRange, rangeToIso, DEFAULT_PRESET } from '../lib/dates';
import { formatKwh, formatCurrency } from '@riviamigo/ui/lib/utils';
export const chargingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/charging',
    component: ChargingPage,
});
function ChargingPage() {
    return _jsx(AuthGuard, { children: _jsx(ChargingContent, {}) });
}
function ChargingContent() {
    const { defaultVehicleId } = useAuth();
    const navigate = useNavigate();
    const [preset, setPreset] = useState(DEFAULT_PRESET);
    const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
    const [page, setPage] = useState(1);
    const { from, to } = rangeToIso(range);
    const { data, isLoading } = useChargeSessions(defaultVehicleId, from, to, page);
    const { data: summary } = useChargingSummary(defaultVehicleId, from, to);
    const energyData = [...(data?.items ?? [])].reverse().map((s) => ({
        ts: s.started_at,
        energy_added_kwh: s.energy_added_kwh ?? 0,
    }));
    const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;
    function handleRowClick(row) {
        navigate({ to: '/charging/$sessionId', params: { sessionId: row.original.id } });
    }
    return (_jsx(AppLayout, { activeKey: "charging", children: _jsxs(PageLayout, { title: "Charging", subtitle: data ? `${data.total} sessions` : undefined, actions: _jsx(DateRangePicker, { value: range, preset: preset, onChange: (r, p) => { setRange(r); if (p)
                    setPreset(p); setPage(1); } }), children: [_jsxs(StatCardGrid, { children: [_jsx(StatCard, { label: "Total Energy", value: formatKwh(summary?.total_energy_kwh ?? 0), accent: true }), _jsx(StatCard, { label: "Sessions", value: summary?.session_count ?? 0 }), _jsx(StatCard, { label: "Total Cost", value: formatCurrency(summary?.total_cost_usd ?? 0) }), _jsx(StatCard, { label: "Avg Session", value: formatKwh(summary && summary.session_count > 0
                                ? summary.total_energy_kwh / summary.session_count
                                : 0) })] }), _jsx(ChartSection, { title: "Energy Added Per Session", children: _jsx(EnergyBarChart, { data: energyData, loading: isLoading, height: 200 }) }), _jsxs(ChartSection, { title: "Sessions", children: [_jsx(DataTable, { data: (data?.items ?? []), columns: chargingColumns, loading: isLoading, onRowClick: handleRowClick, emptyTitle: "No charging sessions", emptyDescription: "Sessions will appear here after your vehicle has charged." }), data && data.total > data.per_page && (_jsxs("div", { className: "flex items-center justify-between mt-4 pt-4 border-t border-border", children: [_jsxs("p", { className: "text-xs text-fg-tertiary", children: ["Page ", page, " of ", totalPages] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { disabled: page <= 1, onClick: () => setPage((p) => p - 1), className: "text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated", children: "Previous" }), _jsx("button", { disabled: page >= totalPages, onClick: () => setPage((p) => p + 1), className: "text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated", children: "Next" })] })] }))] })] }) }));
}
