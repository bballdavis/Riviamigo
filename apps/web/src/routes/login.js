import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth } from '@riviamigo/hooks';
import { Button, Input } from '@riviamigo/ui/primitives';
import { Zap, Route, Battery } from 'lucide-react';
export const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: LoginPage,
});
export function LoginPage() {
    const navigate = useNavigate();
    const { login, register } = useAuth();
    const [mode, setMode] = useState('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            if (mode === 'login') {
                await login(email, password);
            }
            else {
                await register(email, password);
            }
            navigate({ to: '/' });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Authentication failed');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { className: "min-h-screen bg-bg-page flex items-center justify-center px-4 relative overflow-hidden", children: [_jsx("div", { "aria-hidden": "true", className: "pointer-events-none fixed inset-0 flex items-center justify-center", children: _jsx("div", { className: "w-[700px] h-[700px] rounded-full bg-accent/[0.07] blur-[140px]" }) }), _jsxs("div", { "aria-hidden": "true", className: "pointer-events-none fixed inset-0 overflow-hidden", children: [_jsx("div", { className: "absolute -top-64 -left-64 w-[500px] h-[500px] rounded-full bg-accent/[0.04] blur-3xl" }), _jsx("div", { className: "absolute -bottom-80 -right-64 w-[700px] h-[700px] rounded-full bg-accent/[0.03] blur-3xl" })] }), _jsxs("div", { className: "w-full max-w-sm relative z-10", children: [_jsxs("div", { className: "flex flex-col items-center mb-10", children: [_jsxs("div", { className: "relative mb-5", children: [_jsx("div", { className: "w-16 h-16 rounded-2xl bg-accent/10 border border-accent/25 flex items-center justify-center shadow-[0_0_40px_rgba(245,158,11,0.2)]", children: _jsx("img", { src: "/logo_color_lighter.svg", alt: "Riviamigo logo", className: "block h-[80%] w-auto mx-auto my-auto" }) }), _jsx("div", { className: "absolute inset-0 rounded-2xl ring-1 ring-inset ring-accent/10" })] }), _jsx("h1", { className: "text-2xl font-bold font-display text-fg tracking-tight", children: "Riviamigo" }), _jsx("p", { className: "mt-1.5 text-sm text-fg-tertiary", children: "Your Rivian, deeply understood." })] }), _jsxs("div", { className: "bg-bg-glass backdrop-blur-md border border-border rounded-2xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)]", children: [_jsx("p", { className: "text-[11px] font-semibold text-fg-tertiary uppercase tracking-widest mb-5", children: mode === 'login' ? 'Sign in' : 'Create account' }), _jsxs("form", { onSubmit: handleSubmit, className: "flex flex-col gap-4", children: [_jsx(Input, { label: "Email", type: "email", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "you@example.com", required: true, autoComplete: "email" }), _jsx(Input, { label: "Password", type: "password", value: password, onChange: (e) => setPassword(e.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", required: true, autoComplete: mode === 'login' ? 'current-password' : 'new-password' }), error && (_jsx("p", { className: "text-xs text-[#F87171] bg-[#7F1D1D]/20 border border-[#F87171]/20 rounded-lg px-3 py-2", children: error })), _jsx(Button, { type: "submit", loading: loading, size: "lg", className: "mt-1 w-full", children: mode === 'login' ? 'Sign in' : 'Create account' })] }), _jsx("div", { className: "mt-5 pt-5 border-t border-border text-center", children: _jsxs("p", { className: "text-xs text-fg-tertiary", children: [mode === 'login' ? "Don't have an account?" : 'Already have an account?', ' ', _jsx("button", { type: "button", onClick: () => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }, className: "text-accent hover:text-accent-hover transition-colors font-medium", children: mode === 'login' ? 'Create one' : 'Sign in' })] }) })] }), _jsx("div", { className: "mt-8 grid grid-cols-3 gap-3", children: [
                            { icon: Route, label: 'Trip analytics', sub: 'Every drive logged' },
                            { icon: Zap, label: 'Charge history', sub: 'Sessions & cost' },
                            { icon: Battery, label: 'Battery health', sub: 'SOC over time' },
                        ].map(({ icon: Icon, label, sub }) => (_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "flex justify-center mb-1.5", children: _jsx(Icon, { className: "h-3.5 w-3.5 text-accent/70" }) }), _jsx("p", { className: "text-[11px] font-medium text-fg-secondary", children: label }), _jsx("p", { className: "text-[10px] text-fg-tertiary mt-0.5", children: sub })] }, label))) })] })] }));
}
