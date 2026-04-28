import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root';
import { api } from '@riviamigo/hooks';
import { PageLayout, Button, Input, Card } from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
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
function ConnectOtpContent() {
    const navigate = useNavigate();
    const { challenge_id, email } = useSearch({ from: '/connect/otp' });
    const [otp, setOtp] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await api.connectRivianOtp(challenge_id, otp);
            navigate({ to: '/' });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'OTP verification failed');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsx(AppLayout, { activeKey: "settings", children: _jsx(PageLayout, { title: "Verify Your Identity", subtitle: "Check your email or phone for a code", children: _jsx("div", { className: "max-w-md", children: _jsxs(Card, { children: [email && (_jsxs("p", { className: "text-sm text-fg-secondary mb-4", children: ["A code was sent to ", _jsx("span", { className: "text-fg font-medium", children: email }), "."] })), _jsxs("form", { onSubmit: handleSubmit, className: "flex flex-col gap-4", children: [_jsx(Input, { label: "Verification Code", type: "text", inputMode: "numeric", pattern: "[0-9]*", value: otp, onChange: (e) => setOtp(e.target.value), placeholder: "123456", required: true, autoFocus: true }), error && _jsx("p", { className: "text-xs text-[#F87171]", children: error }), _jsx(Button, { type: "submit", loading: loading, children: "Verify & Connect" })] })] }) }) }) }));
}
