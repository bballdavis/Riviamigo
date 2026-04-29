import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useEfficiencySummary, useEfficiencyByMode, useEfficiencyTrend, useEfficiencyVsTemp, } from '@riviamigo/hooks';
import { PageLayout, StatCardGrid, StatCard, MetricTabs, DateRangePicker, } from '@riviamigo/ui/primitives';
import { EfficiencyChart, EfficiencyTrendChart, EfficiencyVsTempChart, } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { presetToRange, rangeToIso, DEFAULT_PRESET } from '../lib/dates';
import { BarChart2, TrendingUp, Thermometer, Gauge } from 'lucide-react';
export const efficiencyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/efficiency',
    component: EfficiencyPage,
});
const TABS = [
    { key: 'by-mode', label: 'By Drive Mode', icon: _jsx(BarChart2, {}) },
    { key: 'trend', label: 'Trend', icon: _jsx(TrendingUp, {}) },
    { key: 'vs-temp', label: 'vs Temperature', icon: _jsx(Thermometer, {}) },
];
function EfficiencyPage() {
    return _jsx(AuthGuard, { children: _jsx(EfficiencyContent, {}) });
}
export function EfficiencyContent() {
    const { defaultVehicleId } = useAuth();
    const [tab, setTab] = useState('by-mode');
    const [preset, setPreset] = useState(DEFAULT_PRESET);
    const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
    const { from, to } = rangeToIso(range);
    const { data: summary } = useEfficiencySummary(defaultVehicleId, from, to);
    const { data: byMode, isLoading: byModeLoading } = useEfficiencyByMode(defaultVehicleId, from, to);
    const { data: trend, isLoading: trendLoading } = useEfficiencyTrend(defaultVehicleId, from, to);
    const { data: vsTemp, isLoading: vsTempLoading } = useEfficiencyVsTemp(defaultVehicleId, from, to);
    const hasVehicle = !!defaultVehicleId;
    return (_jsx(AppLayout, { activeKey: "efficiency", children: _jsx(PageLayout, { title: "Efficiency", actions: _jsx(DateRangePicker, { value: range, preset: preset, onChange: (r, p) => { setRange(r); if (p)
                    setPreset(p); } }), children: !hasVehicle ? (_jsx(NoVehicleState, { description: "Connect your Rivian account to unlock efficiency trends, drive mode breakdowns, and temperature comparisons." })) : (_jsxs(_Fragment, { children: [_jsxs(StatCardGrid, { children: [_jsx(StatCard, { label: "Avg Efficiency", value: summary ? `${summary.avg.toFixed(0)}` : '—', unit: "Wh/mi", accent: true, icon: _jsx(Gauge, { className: "h-4 w-4" }) }), _jsx(StatCard, { label: "Best 10%", value: summary ? `${summary.p10.toFixed(0)}` : '—', unit: "Wh/mi" }), _jsx(StatCard, { label: "Worst 10%", value: summary ? `${summary.p90.toFixed(0)}` : '—', unit: "Wh/mi" }), _jsx(StatCard, { label: "Total Miles", value: "\u2014", unit: "mi" })] }), _jsxs(MetricTabs, { tabs: TABS, active: tab, onChange: setTab, title: "Efficiency", subtitle: `${preset} breakdown`, children: [tab === 'by-mode' && (_jsx(EfficiencyChart, { data: byMode ?? [], loading: byModeLoading, height: 280 })), tab === 'trend' && (_jsx(EfficiencyTrendChart, { data: trend ?? [], loading: trendLoading, height: 280, showBrush: true })), tab === 'vs-temp' && (_jsx(EfficiencyVsTempChart, { data: vsTemp ?? [], loading: vsTempLoading, height: 280 }))] })] })) }) }));
}
