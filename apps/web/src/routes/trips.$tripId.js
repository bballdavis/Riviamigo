import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useTrip, useTripTrack, useSpeedProfile, useElevationProfile, } from '@riviamigo/hooks';
import { PageLayout, StatCardGrid, StatCard, MetricTabs, Button, } from '@riviamigo/ui/primitives';
import { TripMapChart, SpeedProfileChart, ElevationProfileChart, } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { formatMiles, formatDuration, formatKwh } from '@riviamigo/ui/lib/utils';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Map, Gauge, Mountain } from 'lucide-react';
export const tripDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/trips/$tripId',
    component: TripDetailPage,
});
const TABS = [
    { key: 'map', label: 'Route Map', icon: _jsx(Map, {}) },
    { key: 'speed', label: 'Speed', icon: _jsx(Gauge, {}) },
    { key: 'elevation', label: 'Elevation', icon: _jsx(Mountain, {}) },
];
function TripDetailPage() {
    return _jsx(AuthGuard, { children: _jsx(TripDetailContent, {}) });
}
export function TripDetailContent() {
    const { defaultVehicleId } = useAuth();
    const navigate = useNavigate();
    const { tripId } = useParams({ from: '/trips/$tripId' });
    const [tab, setTab] = useState('map');
    const { data: trip } = useTrip(tripId, defaultVehicleId);
    const { data: track, isLoading: trackLoading } = useTripTrack(tripId, defaultVehicleId);
    const { data: speed, isLoading: speedLoading } = useSpeedProfile(tripId, defaultVehicleId);
    const { data: elev, isLoading: elevLoading } = useElevationProfile(tripId, defaultVehicleId);
    const hasVehicle = !!defaultVehicleId;
    const title = trip
        ? format(parseISO(trip.started_at), 'MMMM d, yyyy · h:mm a')
        : 'Trip Detail';
    const durationSec = trip?.duration_seconds;
    const durationMin = durationSec !== undefined ? Math.round(durationSec / 60) : undefined;
    return (_jsx(AppLayout, { activeKey: "trips", children: _jsx(PageLayout, { title: title, actions: _jsx(Button, { variant: "ghost", size: "sm", iconLeft: _jsx(ArrowLeft, { className: "h-4 w-4" }), onClick: () => navigate({ to: '/trips' }), children: "Back" }), children: !hasVehicle ? (_jsx(NoVehicleState, { title: "No vehicle selected", description: "Connect your Rivian account before opening trip details." })) : (_jsxs(_Fragment, { children: [_jsxs(StatCardGrid, { children: [_jsx(StatCard, { label: "Distance", value: trip ? formatMiles(trip.distance_mi) : '—', accent: true }), _jsx(StatCard, { label: "Duration", value: durationMin !== undefined ? formatDuration(durationMin) : '—' }), _jsx(StatCard, { label: "Energy Used", value: trip ? formatKwh(trip.energy_used_kwh ?? 0) : '—' }), _jsx(StatCard, { label: "Efficiency", value: trip?.efficiency_wh_mi ? `${trip.efficiency_wh_mi.toFixed(0)}` : '—', unit: "Wh/mi" })] }), _jsxs(MetricTabs, { tabs: TABS, active: tab, onChange: setTab, title: "Trip Analysis", children: [tab === 'map' && (_jsx(TripMapChart, { track: (track ?? []).map((p) => ({ lat: p.lat, lng: p.lng })), height: 360 })), tab === 'speed' && (_jsx(SpeedProfileChart, { data: speed ?? [], loading: speedLoading, height: 280 })), tab === 'elevation' && (_jsx(ElevationProfileChart, { data: elev ?? [], loading: elevLoading, height: 280 }))] })] })) }) }));
}
