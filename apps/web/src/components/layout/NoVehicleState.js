import { jsx as _jsx } from "react/jsx-runtime";
import { useNavigate } from '@tanstack/react-router';
import { EmptyState } from '@riviamigo/ui/primitives';
import { Car } from 'lucide-react';
export function NoVehicleState({ title = 'No vehicle connected', description = 'Connect your Rivian account to start tracking telemetry.', }) {
    const navigate = useNavigate();
    return (_jsx(EmptyState, { icon: _jsx(Car, {}), title: title, description: description, action: { label: 'Connect Rivian', onClick: () => navigate({ to: '/connect' }) } }));
}
