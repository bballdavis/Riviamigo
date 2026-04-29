import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { api, useAuth } from '@riviamigo/hooks';
import { PageLayout, Button, Input, Card } from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { ConnectedVehicleSuccess } from '../components/connect/ConnectedVehicleSuccess';
import { Car, Check, KeyRound, ShieldCheck, Zap } from 'lucide-react';
export const connectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/connect',
    component: ConnectPage,
});
function ConnectPage() {
    return _jsx(AuthGuard, { children: _jsx(ConnectContent, {}) });
}
export function ConnectContent() {
    const navigate = useNavigate();
    const setDefaultVehicleId = useAuth((state) => state.setDefaultVehicleId);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [vehicles, setVehicles] = useState([]);
    const [successVehicleName, setSuccessVehicleName] = useState('');
    const currentStep = successVehicleName ? 2 : loading ? 1 : 0;
    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const result = await api.connectRivian(email, password);
            if (result.requires_otp && result.challenge_id) {
                navigate({ to: '/connect/otp', search: { challenge_id: result.challenge_id, email } });
            }
            else {
                await finishConnectedResult(result);
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Connection failed');
        }
        finally {
            setLoading(false);
        }
    }
    async function finishConnectedResult(result) {
        if (!result.vehicles.length) {
            setError('Rivian sign-in succeeded, but no vehicles were returned for this account.');
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
    return (_jsx(AppLayout, { activeKey: "settings", children: _jsx(PageLayout, { title: "Add a Vehicle", subtitle: "Connect your Rivian account so Riviamigo can securely prepare telemetry access.", className: "min-h-[calc(100vh-3rem)] justify-center [&>div:first-child]:justify-center [&>div:first-child>div]:text-center", children: _jsx("div", { className: "mx-auto w-full max-w-xl", children: _jsxs(Card, { padding: "lg", className: "shadow-lg", children: [_jsx(ConnectProgress, { currentStep: currentStep }), successVehicleName ? (_jsx(ConnectedVehicleSuccess, { vehicleName: successVehicleName, onOpenDashboard: () => navigate({ to: '/' }) })) : vehicles.length > 1 ? (_jsx(VehiclePicker, { vehicles: vehicles, loading: loading, error: error, onSelect: (vehicle) => {
                                setError('');
                                persistVehicle(vehicle).catch((err) => {
                                    setError(err instanceof Error ? err.message : 'Vehicle add failed');
                                    setLoading(false);
                                });
                            } })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "mt-8 flex items-center gap-3", children: [_jsx("div", { className: "flex h-9 w-9 items-center justify-center rounded-lg bg-accent-muted", children: _jsx(Zap, { className: "h-4 w-4 text-accent" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-fg", children: "Rivian Account" }), _jsx("p", { className: "text-xs text-fg-tertiary", children: "Most accounts continue through a one-time verification code." })] })] }), _jsxs("form", { onSubmit: handleSubmit, className: "mt-5 flex flex-col gap-4", children: [_jsx(Input, { label: "Rivian Email", type: "email", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "you@example.com", required: true }), _jsx(Input, { label: "Rivian Password", type: "password", value: password, onChange: (e) => setPassword(e.target.value), placeholder: "Password", required: true }), error && _jsx("p", { className: "text-xs text-[#F87171]", children: error }), _jsx(Button, { type: "submit", loading: loading, iconLeft: _jsx(KeyRound, { className: "h-4 w-4" }), className: "mt-1", children: loading ? 'Checking account' : 'Connect Account' })] })] }))] }) }) }) }));
}
const steps = [
    {
        label: 'Credentials',
        description: 'Sign in with the Rivian account that has access to the vehicle.',
        icon: KeyRound,
    },
    {
        label: 'Verification',
        description: 'If Rivian requests MFA, enter the email or authenticator code next.',
        icon: ShieldCheck,
    },
    {
        label: 'Vehicle saved',
        description: 'Riviamigo encrypts tokens and sets the first connected vehicle as default.',
        icon: Car,
    },
];
function ConnectProgress({ currentStep }) {
    return (_jsxs("div", { "aria-label": "Add vehicle progress", children: [_jsx("div", { className: "h-2 overflow-hidden rounded-full bg-bg-elevated", children: _jsx("div", { className: "h-full rounded-full bg-accent transition-all duration-300", style: { width: `${((currentStep + 1) / steps.length) * 100}%` } }) }), _jsx("div", { className: "mt-5 grid gap-3 sm:grid-cols-2", children: steps.map((step, index) => {
                    const Icon = step.icon;
                    const active = index === currentStep;
                    const complete = index < currentStep;
                    return (_jsxs("div", { className: `flex gap-3 rounded-lg border p-3 ${active || complete ? 'border-accent/50 bg-accent-muted/20' : 'border-border bg-bg-elevated/40'}`, children: [_jsx("div", { className: `mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${complete ? 'bg-accent text-fg-on-accent' : 'bg-bg-surface text-accent'}`, children: complete ? _jsx(Check, { className: "h-4 w-4" }) : _jsx(Icon, { className: "h-4 w-4" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-fg", children: step.label }), _jsx("p", { className: "mt-1 text-xs leading-5 text-fg-tertiary", children: step.description })] })] }, step.label));
                }) })] }));
}
function VehiclePicker({ vehicles, loading, error, onSelect, }) {
    return (_jsxs("div", { className: "mt-8", children: [_jsx("p", { className: "text-sm font-medium text-fg", children: "Choose a vehicle" }), _jsx("p", { className: "mt-1 text-xs leading-5 text-fg-tertiary", children: "Rivian returned multiple vehicles for this account. Pick the one to add first." }), _jsx("div", { className: "mt-4 grid gap-3", children: vehicles.map((vehicle) => (_jsxs("button", { type: "button", disabled: loading, onClick: () => onSelect(vehicle), className: "flex items-center justify-between rounded-lg border border-border bg-bg-elevated/40 p-4 text-left transition hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-60", children: [_jsxs("span", { children: [_jsx("span", { className: "block text-sm font-medium text-fg", children: formatVehicleName(vehicle) }), _jsx("span", { className: "mt-1 block text-xs text-fg-tertiary", children: vehicle.vin ?? vehicle.id })] }), _jsx(Car, { className: "h-5 w-5 text-accent" })] }, vehicle.id))) }), error && _jsx("p", { className: "mt-4 text-xs text-[#F87171]", children: error })] }));
}
function formatVehicleName(vehicle) {
    return vehicle.name || [vehicle.model_year, vehicle.model].filter(Boolean).join(' ') || 'Rivian vehicle';
}
