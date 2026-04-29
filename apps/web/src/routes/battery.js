import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useSocHistory, useRangeHistory, usePhantomDrain, useDegradation, } from '@riviamigo/hooks';
import { PageLayout, StatCardGrid, StatCard, MetricTabs, DateRangePicker, } from '@riviamigo/ui/primitives';
import { SocAreaChart, RangeAreaChart, PhantomDrainChart, DegradationChart, } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { presetToRange, rangeToIso, DEFAULT_PRESET } from '../lib/dates';
import { Battery, TrendingDown, Moon, Activity } from 'lucide-react';
export const batteryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/battery',
    component: BatteryPage,
});
const TABS = [
    { key: 'soc', label: 'State of Charge', icon: _jsx(Battery, {}) },
    { key: 'range', label: 'Range', icon: _jsx(Activity, {}) },
    { key: 'phantom', label: 'Phantom Drain', icon: _jsx(Moon, {}) },
    { key: 'degradation', label: 'Degradation', icon: _jsx(TrendingDown, {}) },
];
function BatteryPage() {
    return _jsx(AuthGuard, { children: _jsx(BatteryContent, {}) });
}
export function BatteryContent() {
    const { defaultVehicleId } = useAuth();
    const [tab, setTab] = useState('soc');
    const [preset, setPreset] = useState(DEFAULT_PRESET);
    const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
    const { from, to } = rangeToIso(range);
    const { data: socData, isLoading: socLoading } = useSocHistory(defaultVehicleId, from, to);
    const { data: rangeData, isLoading: rangeLoading } = useRangeHistory(defaultVehicleId, from, to);
    const { data: drainData, isLoading: drainLoading } = usePhantomDrain(defaultVehicleId, from, to);
    const { data: degradData, isLoading: degradLoading } = useDegradation(defaultVehicleId);
    const latestSoc = socData?.[socData.length - 1]?.soc;
    const latestRange = rangeData?.[rangeData.length - 1]?.range_mi;
    const avgDrain = drainData?.length
        ? drainData.reduce((sum, point) => sum + (point.drain_pct ?? 0), 0) / drainData.length
        : undefined;
    const latestCapacity = degradData?.[degradData.length - 1]?.capacity_pct;
    const hasVehicle = !!defaultVehicleId;
    return (_jsx(AppLayout, { activeKey: "battery", children: _jsx(PageLayout, { title: "Battery", actions: _jsx(DateRangePicker, { value: range, preset: preset, onChange: (r, p) => { setRange(r); if (p)
                    setPreset(p); } }), children: !hasVehicle ? (_jsx(NoVehicleState, { description: "Connect your Rivian account to view battery health, range, and drain analytics." })) : (_jsxs(_Fragment, { children: [_jsxs(StatCardGrid, { children: [_jsx(StatCard, { label: "Current SoC", value: latestSoc !== undefined ? `${Math.round(latestSoc)}%` : '—', accent: true, icon: _jsx(Battery, { className: "h-4 w-4" }) }), _jsx(StatCard, { label: "Est. Range", value: latestRange !== undefined ? `${Math.round(latestRange)} mi` : '—' }), _jsx(StatCard, { label: "Phantom Drain", value: avgDrain !== undefined ? `${avgDrain.toFixed(1)}%` : '—', unit: "/ hr avg" }), _jsx(StatCard, { label: "Capacity Health", value: latestCapacity !== undefined ? `${latestCapacity.toFixed(1)}%` : '—' })] }), _jsxs(MetricTabs, { tabs: TABS, active: tab, onChange: setTab, title: "Battery", subtitle: `${preset} history`, children: [tab === 'soc' && (_jsx(SocAreaChart, { data: socData ?? [], loading: socLoading, height: 240, showBrush: true })), tab === 'range' && (_jsx(RangeAreaChart, { data: rangeData ?? [], loading: rangeLoading, height: 240 })), tab === 'phantom' && (_jsx(PhantomDrainChart, { data: drainData ?? [], loading: drainLoading, height: 240 })), tab === 'degradation' && (_jsx(DegradationChart, { data: degradData ?? [], loading: degradLoading, height: 240 }))] })] })) }) }));
}
