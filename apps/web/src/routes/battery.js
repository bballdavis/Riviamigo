import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useSocHistory, useRangeHistory, usePhantomDrain } from '@riviamigo/hooks';
import { PageLayout, ChartSection, StatCardGrid, StatCard, DateRangePicker, } from '@riviamigo/ui/primitives';
import { SocAreaChart, RangeAreaChart, PhantomDrainChart } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { presetToRange, rangeToIso, DEFAULT_PRESET } from '../lib/dates';
import { Battery } from 'lucide-react';
export const batteryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/battery',
    component: BatteryPage,
});
function BatteryPage() {
    return _jsx(AuthGuard, { children: _jsx(BatteryContent, {}) });
}
function BatteryContent() {
    const { defaultVehicleId } = useAuth();
    const [preset, setPreset] = useState(DEFAULT_PRESET);
    const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
    const { from, to } = rangeToIso(range);
    const { data: socData, isLoading: socLoading } = useSocHistory(defaultVehicleId, from, to);
    const { data: rangeData, isLoading: rangeLoading } = useRangeHistory(defaultVehicleId, from, to);
    const { data: drainData, isLoading: drainLoading } = usePhantomDrain(defaultVehicleId, from, to);
    const latestSoc = socData?.[socData.length - 1]?.soc;
    const latestRange = rangeData?.[rangeData.length - 1]?.range_mi;
    const avgDrain = drainData?.length
        ? drainData.reduce((s, d) => s + d.drain_pct, 0) / drainData.length
        : undefined;
    return (_jsx(AppLayout, { activeKey: "battery", children: _jsxs(PageLayout, { title: "Battery", actions: _jsx(DateRangePicker, { value: range, preset: preset, onChange: (r, p) => { setRange(r); if (p)
                    setPreset(p); } }), children: [_jsxs(StatCardGrid, { children: [_jsx(StatCard, { label: "Current SoC", value: latestSoc !== undefined ? `${Math.round(latestSoc)}%` : '—', accent: true, icon: _jsx(Battery, { className: "h-4 w-4" }) }), _jsx(StatCard, { label: "Est. Range", value: latestRange !== undefined ? `${Math.round(latestRange)} mi` : '—' }), _jsx(StatCard, { label: "Avg Phantom Drain", value: avgDrain !== undefined ? `${avgDrain.toFixed(1)}%` : '—', unit: "/ night" })] }), _jsx(ChartSection, { title: "State of Charge", subtitle: `${preset} history`, children: _jsx(SocAreaChart, { data: socData ?? [], loading: socLoading, height: 240 }) }), _jsx(ChartSection, { title: "Estimated Range", subtitle: `${preset} history`, children: _jsx(RangeAreaChart, { data: rangeData ?? [], loading: rangeLoading, height: 200 }) }), _jsx(ChartSection, { title: "Phantom Drain", subtitle: "Overnight SoC loss", children: _jsx(PhantomDrainChart, { data: drainData ?? [], loading: drainLoading, height: 200 }) })] }) }));
}
