import React, { useState } from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { rootRoute } from './__root';
import { api, useAuth, useDocumentTheme } from '@riviamigo/hooks';
import { Button, Input } from '@riviamigo/ui/primitives';
import { Zap, Route, Battery } from 'lucide-react';
import { normalizeLoginRedirectTarget } from '../components/layout/AuthGuard';
import { PASSWORD_MIN_LENGTH, PasswordRequirements } from '../components/auth/PasswordRequirements';

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: z.object({
    redirect: z.string().optional(),
    password_changed: z.literal('1').optional(),
  }),
  component: LoginPage,
});

export function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/login' });
  const { login, register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isDark = useDocumentTheme();
  const redirectTarget = normalizeLoginRedirectTarget(search.redirect);
  const setup = useQuery({ queryKey: ['auth-setup'], queryFn: () => api.setup(), retry: false });
  const setupRequired = setup.data?.setup_required === true;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (setupRequired) {
        await register(email, password);
        navigate({ to: '/connect' });
        return;
      }
      await login(email, password);
      navigate({ to: (redirectTarget ?? '/') as never });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        setError('Incorrect email or password. Please try again.');
      } else if (status === 429) {
        setError('Too many sign-in attempts. Please wait a moment and try again.');
      } else if (status === 422) {
        const message = (err as { detail?: { message?: string } }).detail?.message;
        setError(message ?? 'Check the password requirements and try again.');
      } else if (status != null && status >= 500) {
        setError('Something went wrong on our end. Please try again later.');
      } else {
        setError('Unable to sign in. Please check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-page flex items-center justify-center px-4 relative overflow-hidden">
      {/* Deep amber glow behind everything */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 flex items-center justify-center"
      >
        <div className="w-[700px] h-[700px] rounded-full bg-accent/[0.07] blur-[140px]" />
      </div>
      {/* Corner orbs */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-64 -left-64 w-[500px] h-[500px] rounded-full bg-accent/[0.04] blur-3xl" />
        <div className="absolute -bottom-80 -right-64 w-[700px] h-[700px] rounded-full bg-accent/[0.03] blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Brand mark */}
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-5">
            <div className="w-24 h-24 rounded-2xl bg-accent/10 border border-accent/25 grid place-items-center shadow-glow-md overflow-hidden">
              <img
                src="/logo_color_lighter.svg"
                alt="Riviamigo logo"
                className="block h-20 w-20 object-contain"
                style={{ transform: 'translateX(-6px)' }}
              />
            </div>
            {/* Subtle ring */}
            <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-accent/10" />
          </div>
          <img
            src={isDark ? '/text_white.svg' : '/text_black.svg'}
            alt="Riviamigo"
            className="block h-14 w-auto max-w-full object-contain"
          />
          <p className="mt-1.5 text-sm text-fg-tertiary">Your Rivian's data companion.</p>
        </div>

        {/* Auth card */}
        <div className="bg-bg-glass backdrop-blur-md border border-border rounded-2xl p-6 shadow-xl">
          <p className="text-[11px] font-semibold text-fg-tertiary uppercase tracking-widest mb-5">
            {setupRequired ? 'Set up Riviamigo' : 'Sign in'}
          </p>
          {search.password_changed === '1' && (
            <p role="status" className="mb-4 rounded-lg border border-status-positive/30 bg-status-positive/10 px-3 py-2 text-xs text-status-positive">
              Password changed. Sign in with your new password.
            </p>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={setupRequired ? PASSWORD_MIN_LENGTH : undefined}
              autoComplete={setupRequired ? 'new-password' : 'current-password'}
            />
            {setupRequired && <PasswordRequirements password={password} />}
            {error && (
              <p className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <Button type="submit" loading={loading} size="lg" className="mt-1 w-full">
              {setupRequired ? 'Create owner account' : 'Sign in'}
            </Button>
          </form>
          {!setupRequired && <p className="mt-5 pt-5 border-t border-border text-center text-xs text-fg-tertiary">Need access? Ask an administrator for an activation link.</p>}
        </div>

        {/* Feature callouts */}
        <div className="mt-8 grid grid-cols-3 gap-3">
          {[
            { icon: Route, label: 'Trip analytics', sub: 'Every drive logged' },
            { icon: Zap, label: 'Charge history', sub: 'Sessions & cost' },
            { icon: Battery, label: 'Battery health', sub: 'SOC over time' },
          ].map(({ icon: Icon, label, sub }) => (
            <div key={label} className="text-center">
              <div className="flex justify-center mb-1.5">
                <Icon className="h-3.5 w-3.5 text-accent/70" />
              </div>
              <p className="text-[11px] font-medium text-fg-secondary">{label}</p>
              <p className="text-[10px] text-fg-tertiary mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
