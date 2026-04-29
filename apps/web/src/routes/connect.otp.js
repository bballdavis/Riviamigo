import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root';
import { api, useAuth } from '@riviamigo/hooks';
import { PageLayout, Button, Input, Card } from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { ConnectedVehicleSuccess } from '../components/connect/ConnectedVehicleSuccess';
import { Car, Check, KeyRound, ShieldCheck } from 'lucide-react';
const searchSchema = z.object({
    challenge_id: z.string(),
    email: z.string().optional(),
});
export const connectOtpRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/connect/otp',
    validateSearch: searchSchema,
    component: ConnectOtpPage,
});
function ConnectOtpPage() {
    return _jsx(AuthGuard, { children: _jsx(ConnectOtpContent, {}) });
}
export function ConnectOtpContent() {
    const navigate = useNavigate();
    const { challenge_id, email } = useSearch({ from: '/connect/otp' });
    const setDefaultVehicleId = useAuth((state) => state.setDefaultVehicleId);
    const [otp, setOtp] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [vehicles, setVehicles] = useState([]);
    const [successVehicleName, setSuccessVehicleName] = useState('');
    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const result = await api.connectRivianOtp(challenge_id, otp);
            await finishConnectedResult(result);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'OTP verification failed');
        }
        finally {
            setLoading(false);
        }
    }
    async function finishConnectedResult(result) {
        if (!result.vehicles.length) {
            setError('Rivian verification succeeded, but no vehicles were returned for this account.');
            return;
        }
        if (result.vehicles.length > 1) {
            setVehicles(result.vehicles);
            return;
        }
        const vehicle = result.vehicles[0];
        if (!vehicle)
            return;
        await persistVehicle(vehicle);
    }
    async function persistVehicle(vehicle) {
        setLoading(true);
        const added = await api.addVehicle({
            rivian_vehicle_id: vehicle.id,
            name: vehicle.name,
            model: vehicle.model,
            vin: vehicle.vin,
        });
        setDefaultVehicleId(added.vehicle_id);
        setSuccessVehicleName(formatVehicleName(vehicle));
        setVehicles([]);
    }
    return (_jsx(AppLayout, { activeKey: "settings", children: _jsx(PageLayout, { title: "Add a Vehicle", subtitle: "Complete Rivian verification so encrypted vehicle access can be saved.", className: "min-h-[calc(100vh-3rem)] justify-center [&>div:first-child]:justify-center [&>div:first-child>div]:text-center", children: _jsx("div", { className: "mx-auto w-full max-w-xl", children: _jsxs(Card, { padding: "lg", className: "shadow-lg", children: [_jsx(ConnectOtpProgress, { loading: loading, success: Boolean(successVehicleName) }), successVehicleName ? (_jsx(ConnectedVehicleSuccess, { vehicleName: successVehicleName, onOpenDashboard: () => navigate({ to: '/' }) })) : vehicles.length > 1 ? (_jsx(VehiclePicker, { vehicles: vehicles, loading: loading, error: error, onSelect: (vehicle) => {
                                setError('');
                                persistVehicle(vehicle).catch((err) => {
                                    setError(err instanceof Error ? err.message : 'Vehicle add failed');
                                    setLoading(false);
                                });
                            } })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "mt-8", children: [_jsx("p", { className: "text-sm font-medium text-fg", children: "Verification code" }), _jsx("p", { className: "mt-1 text-sm text-fg-secondary", children: email ? (_jsxs(_Fragment, { children: ["Enter the code Rivian sent for ", _jsx("span", { className: "font-medium text-fg", children: email }), "."] })) : ('Enter the code from your Rivian email or authenticator app.') })] }), _jsxs("form", { onSubmit: handleSubmit, className: "mt-5 flex flex-col gap-4", children: [_jsx(Input, { label: "Verification Code", type: "text", inputMode: "numeric", pattern: "[0-9]*", value: otp, onChange: (e) => setOtp(e.target.value), placeholder: "123456", required: true, autoFocus: true }), error && _jsx("p", { className: "text-xs text-[#F87171]", children: error }), _jsx(Button, { type: "submit", loading: loading, iconLeft: _jsx(ShieldCheck, { className: "h-4 w-4" }), children: loading ? 'Verifying code' : 'Verify and Connect' })] })] }))] }) }) }) }));
}
function ConnectOtpProgress({ loading, success }) {
    const items = [
        { label: 'Credentials accepted', icon: Check, complete: true },
        { label: loading ? 'Verifying code' : 'MFA required', icon: loading ? ShieldCheck : KeyRound, complete: false },
        { label: success ? 'Vehicle saved' : 'Save vehicle', icon: Car, complete: success },
    ];
    return (_jsxs("div", { "aria-label": "Add vehicle progress", children: [_jsx("div", { className: "h-2 overflow-hidden rounded-full bg-bg-elevated", children: _jsx("div", { className: "h-full w-full rounded-full bg-accent transition-all duration-300" }) }), _jsx("div", { className: "mt-5 grid gap-3 sm:grid-cols-3", children: items.map((item) => {
                    const Icon = item.icon;
                    return (_jsxs("div", { className: "flex gap-3 rounded-lg border border-accent/50 bg-accent-muted/20 p-3", children: [_jsx("div", { className: `mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.complete ? 'bg-accent text-fg-on-accent' : 'bg-bg-surface text-accent'}`, children: _jsx(Icon, { className: "h-4 w-4" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-fg", children: item.label }), _jsx("p", { className: "mt-1 text-xs leading-5 text-fg-tertiary", children: item.complete
                                            ? 'Rivian accepted the account credentials.'
                                            : 'This protects accounts that use email codes or authenticator apps.' })] })] }, item.label));
                }) })] }));
}
function VehiclePicker({ vehicles, loading, error, onSelect, }) {
    return (_jsxs("div", { className: "mt-8", children: [_jsx("p", { className: "text-sm font-medium text-fg", children: "Choose a vehicle" }), _jsx("p", { className: "mt-1 text-xs leading-5 text-fg-tertiary", children: "Rivian returned multiple vehicles for this account. Pick the one to add first." }), _jsx("div", { className: "mt-4 grid gap-3", children: vehicles.map((vehicle) => (_jsxs("button", { type: "button", disabled: loading, onClick: () => onSelect(vehicle), className: "flex items-center justify-between rounded-lg border border-border bg-bg-elevated/40 p-4 text-left transition hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-60", children: [_jsxs("span", { children: [_jsx("span", { className: "block text-sm font-medium text-fg", children: formatVehicleName(vehicle) }), _jsx("span", { className: "mt-1 block text-xs text-fg-tertiary", children: vehicle.vin ?? vehicle.id })] }), _jsx(Car, { className: "h-5 w-5 text-accent" })] }, vehicle.id))) }), error && _jsx("p", { className: "mt-4 text-xs text-[#F87171]", children: error })] }));
}
function formatVehicleName(vehicle) {
    return vehicle.name || [vehicle.model_year, vehicle.model].filter(Boolean).join(' ') || 'Rivian vehicle';
}
