import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useTrips } from '@riviamigo/hooks';
import { PageLayout, ChartSection, DateRangePicker } from '@riviamigo/ui/primitives';
import { DataTable, tripColumns } from '@riviamigo/ui/tables';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { presetToRange, rangeToIso, DEFAULT_PRESET } from '../lib/dates';
export const tripsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/trips',
    component: TripsPage,
});
function TripsPage() {
    return _jsx(AuthGuard, { children: _jsx(TripsContent, {}) });
}
function TripsContent() {
    const { defaultVehicleId } = useAuth();
    const navigate = useNavigate();
    const [preset, setPreset] = useState(DEFAULT_PRESET);
    const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
    const [page, setPage] = useState(1);
    const { from, to } = rangeToIso(range);
    const { data, isLoading } = useTrips(defaultVehicleId, from, to, page);
    function handleRowClick(row) {
        navigate({ to: '/trips/$tripId', params: { tripId: row.original.id } });
    }
    const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;
    return (_jsx(AppLayout, { activeKey: "trips", children: _jsx(PageLayout, { title: "Trips", subtitle: data ? `${data.total} trips` : undefined, actions: _jsx(DateRangePicker, { value: range, preset: preset, onChange: (r, p) => { setRange(r); if (p)
                    setPreset(p); setPage(1); } }), children: _jsxs(ChartSection, { title: "Trip History", children: [_jsx(DataTable, { data: (data?.items ?? []), columns: tripColumns, loading: isLoading, onRowClick: handleRowClick, emptyTitle: "No trips found", emptyDescription: "Trips will appear here once your vehicle has been driven." }), data && data.total > data.per_page && (_jsxs("div", { className: "flex items-center justify-between mt-4 pt-4 border-t border-border", children: [_jsxs("p", { className: "text-xs text-fg-tertiary", children: ["Page ", page, " of ", totalPages] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { disabled: page <= 1, onClick: () => setPage((p) => p - 1), className: "text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors", children: "Previous" }), _jsx("button", { disabled: page >= totalPages, onClick: () => setPage((p) => p + 1), className: "text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-bg-elevated transition-colors", children: "Next" })] })] }))] }) }) }));
}
