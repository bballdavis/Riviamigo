import React, { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useDocumentTheme } from '@riviamigo/hooks';
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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isDark = useDocumentTheme();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password);
      }
      navigate({ to: '/' });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        setError('Incorrect email or password. Please try again.');
      } else if (status === 429) {
        setError('Too many sign-in attempts. Please wait a moment and try again.');
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
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </p>

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
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            {error && (
              <p className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <Button type="submit" loading={loading} size="lg" className="mt-1 w-full">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <div className="mt-5 pt-5 border-t border-border text-center">
            <p className="text-xs text-fg-tertiary">
              {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
                className="text-accent hover:text-accent-hover transition-colors font-medium"
              >
                {mode === 'login' ? 'Create one' : 'Sign in'}
              </button>
            </p>
          </div>
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
