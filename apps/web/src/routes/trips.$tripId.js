import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useTrip, useTripTrack, useSpeedProfile } from '@riviamigo/hooks';
import { PageLayout, ChartSection, StatCardGrid, StatCard, Button, } from '@riviamigo/ui/primitives';
import { TripMapChart, SpeedProfileChart } from '@riviamigo/ui/charts';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { formatMiles, formatDuration, formatKwh } from '@riviamigo/ui/lib/utils';
import { format, parseISO } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
export const tripDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/trips/$tripId',
    component: TripDetailPage,
});
function TripDetailPage() {
    return _jsx(AuthGuard, { children: _jsx(TripDetailContent, {}) });
}
function TripDetailContent() {
    const { defaultVehicleId } = useAuth();
    const navigate = useNavigate();
    const { tripId } = useParams({ from: '/trips/$tripId' });
    const { data: trip } = useTrip(tripId, defaultVehicleId);
    const { data: track } = useTripTrack(tripId, defaultVehicleId);
    const { data: speed, isLoading: speedLoading } = useSpeedProfile(tripId, defaultVehicleId);
    const title = trip
        ? format(parseISO(trip.started_at), 'MMMM d, yyyy · h:mm a')
        : 'Trip Detail';
    const durationMin = trip?.duration_min;
    return (_jsx(AppLayout, { activeKey: "trips", children: _jsxs(PageLayout, { title: title, actions: _jsx(Button, { variant: "ghost", size: "sm", iconLeft: _jsx(ArrowLeft, { className: "h-4 w-4" }), onClick: () => navigate({ to: '/trips' }), children: "Back" }), children: [_jsxs(StatCardGrid, { children: [_jsx(StatCard, { label: "Distance", value: trip ? formatMiles(trip.distance_mi) : '—', accent: true }), _jsx(StatCard, { label: "Duration", value: durationMin !== undefined ? formatDuration(durationMin) : '—' }), _jsx(StatCard, { label: "Energy Used", value: trip ? formatKwh(trip.energy_used_kwh ?? 0) : '—' }), _jsx(StatCard, { label: "Efficiency", value: trip?.efficiency_wh_mi ? `${trip.efficiency_wh_mi.toFixed(0)}` : '—', unit: "Wh/mi" })] }), (track?.length ?? 0) > 0 && (_jsx(ChartSection, { title: "Route Map", children: _jsx(TripMapChart, { track: (track ?? []).map((p) => ({ lat: p.lat, lng: p.lng })), height: 360 }) })), _jsx(ChartSection, { title: "Speed Profile", children: _jsx(SpeedProfileChart, { data: speed ?? [], loading: speedLoading, height: 200 }) })] }) }));
}
