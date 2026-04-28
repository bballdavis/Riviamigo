import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { api } from '@riviamigo/hooks';
import { PageLayout, Button, Input, Card } from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { Zap } from 'lucide-react';
export const connectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/connect',
    component: ConnectPage,
});
function ConnectPage() {
    return _jsx(AuthGuard, { children: _jsx(ConnectContent, {}) });
}
function ConnectContent() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
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
                navigate({ to: '/' });
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Connection failed');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsx(AppLayout, { activeKey: "settings", children: _jsx(PageLayout, { title: "Connect Rivian", subtitle: "Link your Rivian account to start tracking", children: _jsx("div", { className: "max-w-md", children: _jsxs(Card, { children: [_jsxs("div", { className: "flex items-center gap-3 mb-5", children: [_jsx("div", { className: "w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center", children: _jsx(Zap, { className: "h-4 w-4 text-accent" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-fg", children: "Rivian Account" }), _jsx("p", { className: "text-xs text-fg-tertiary", children: "Your credentials are encrypted at rest" })] })] }), _jsxs("form", { onSubmit: handleSubmit, className: "flex flex-col gap-4", children: [_jsx(Input, { label: "Rivian Email", type: "email", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "you@example.com", required: true }), _jsx(Input, { label: "Rivian Password", type: "password", value: password, onChange: (e) => setPassword(e.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", required: true }), error && _jsx("p", { className: "text-xs text-[#F87171]", children: error }), _jsx(Button, { type: "submit", loading: loading, className: "mt-1", children: "Connect Account" })] })] }) }) }) }));
}
