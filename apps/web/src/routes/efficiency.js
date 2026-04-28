import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useEfficiencySummary, useEfficiencyByMode } from '@riviamigo/hooks';
import { PageLayout, ChartSection, StatCardGrid, StatCard, DateRangePicker, } from '@riviamigo/ui/primitives';
import { EfficiencyChart } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { presetToRange, rangeToIso, DEFAULT_PRESET } from '../lib/dates';
export const efficiencyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/efficiency',
    component: EfficiencyPage,
});
function EfficiencyPage() {
    return _jsx(AuthGuard, { children: _jsx(EfficiencyContent, {}) });
}
function EfficiencyContent() {
    const { defaultVehicleId } = useAuth();
    const [preset, setPreset] = useState(DEFAULT_PRESET);
    const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
    const { from, to } = rangeToIso(range);
    const { data: summary, isLoading: summaryLoading } = useEfficiencySummary(defaultVehicleId, from, to);
    const { data: byMode, isLoading: byModeLoading } = useEfficiencyByMode(defaultVehicleId, from, to);
    return (_jsx(AppLayout, { activeKey: "efficiency", children: _jsxs(PageLayout, { title: "Efficiency", actions: _jsx(DateRangePicker, { value: range, preset: preset, onChange: (r, p) => { setRange(r); if (p)
                    setPreset(p); } }), children: [_jsxs(StatCardGrid, { children: [_jsx(StatCard, { label: "Avg Efficiency", value: summary ? `${summary.avg.toFixed(0)}` : '—', unit: "Wh/mi", accent: true }), _jsx(StatCard, { label: "Best 10%", value: summary ? `${summary.p10.toFixed(0)}` : '—', unit: "Wh/mi" }), _jsx(StatCard, { label: "Worst 10%", value: summary ? `${summary.p90.toFixed(0)}` : '—', unit: "Wh/mi" })] }), _jsx(ChartSection, { title: "Efficiency by Drive Mode", subtitle: "Average with p10\u2013p90 range", children: _jsx(EfficiencyChart, { data: byMode ?? [], loading: byModeLoading, height: 280 }) })] }) }));
}
