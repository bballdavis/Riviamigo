import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth } from '@riviamigo/hooks';
import { Button, Input } from '@riviamigo/ui/primitives';
import { AmbientOrbs } from '@riviamigo/ui/primitives';
export const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: LoginPage,
});
function LoginPage() {
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
    return (_jsxs("div", { className: "min-h-screen bg-bg-page flex items-center justify-center px-4", children: [_jsx(AmbientOrbs, {}), _jsxs("div", { className: "w-full max-w-sm", children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("h1", { className: "text-3xl font-semibold font-display text-fg tracking-tight", children: "Riviamigo" }), _jsx("p", { className: "mt-1 text-sm text-fg-tertiary", children: "Your Rivian, deeply understood." })] }), _jsxs("div", { className: "bg-bg-surface border border-border rounded-2xl p-6", children: [_jsx("h2", { className: "text-base font-semibold text-fg mb-5", children: mode === 'login' ? 'Sign in' : 'Create account' }), _jsxs("form", { onSubmit: handleSubmit, className: "flex flex-col gap-4", children: [_jsx(Input, { label: "Email", type: "email", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "you@example.com", required: true, autoComplete: "email" }), _jsx(Input, { label: "Password", type: "password", value: password, onChange: (e) => setPassword(e.target.value), placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", required: true, autoComplete: mode === 'login' ? 'current-password' : 'new-password' }), error && _jsx("p", { className: "text-xs text-[#F87171]", children: error }), _jsx(Button, { type: "submit", loading: loading, className: "mt-1 w-full", children: mode === 'login' ? 'Sign in' : 'Create account' })] }), _jsxs("p", { className: "mt-4 text-center text-xs text-fg-tertiary", children: [mode === 'login' ? "Don't have an account?" : 'Already have an account?', ' ', _jsx("button", { type: "button", onClick: () => setMode(mode === 'login' ? 'register' : 'login'), className: "text-accent hover:text-accent-hover transition-colors", children: mode === 'login' ? 'Create one' : 'Sign in' })] })] })] })] }));
}
