import React, { useEffect, useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api, useAuth, useDocumentTheme } from '@riviamigo/hooks';
import { Button, Input } from '@riviamigo/ui/primitives';
import { rootRoute } from './__root';
import { PASSWORD_MIN_LENGTH, PasswordRequirements } from '../components/auth/PasswordRequirements';

export const activateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/activate',
  component: ActivatePage,
});

export function ActivatePage() {
  const navigate = useNavigate();
  const isDark = useDocumentTheme();
  const accept = useAuth((state) => state.acceptAccountInvitation);
  const [token] = useState(() => window.location.hash.replace(/^#/, ''));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const invitation = useQuery({
    queryKey: ['account-invitation', token],
    queryFn: () => api.previewAccountInvitation(token),
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) { setError(`Use a password with at least ${PASSWORD_MIN_LENGTH} characters.`); return; }
    setLoading(true); setError('');
    try { await accept(token, password); navigate({ to: '/' }); }
    catch { setError('This activation link is invalid, expired, or has already been used.'); }
    finally { setLoading(false); }
  }

  return <div className="min-h-screen bg-bg-page flex items-center justify-center px-4">
    <div className="w-full max-w-sm">
      <div className="flex flex-col items-center mb-8">
        <img src={isDark ? '/text_white.svg' : '/text_black.svg'} alt="Riviamigo" className="block h-14 w-auto" />
      </div>
      <div className="bg-bg-glass backdrop-blur-md border border-border rounded-2xl p-6 shadow-xl">
        <p className="text-[11px] font-semibold text-fg-tertiary uppercase tracking-widest mb-4">Activate account</p>
        {!token || invitation.isError ? <p className="text-sm text-status-danger">This activation link is invalid, expired, or has already been used.</p> : invitation.isLoading ? <p className="text-sm text-fg-tertiary">Checking invitation…</p> : <form onSubmit={submit} className="grid gap-4">
          <p className="text-sm text-fg-secondary">Set a password for <span className="text-fg font-medium">{invitation.data?.email}</span>.</p>
          <Input label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" minLength={PASSWORD_MIN_LENGTH} required autoComplete="new-password" />
          <PasswordRequirements password={password} />
          {error && <p className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-lg px-3 py-2">{error}</p>}
          <Button type="submit" size="lg" className="w-full" loading={loading}>Activate account</Button>
        </form>}
      </div>
    </div>
  </div>;
}
