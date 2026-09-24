import React, { useEffect, useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api, useAuth } from '@riviamigo/hooks';
import { useDocumentTheme } from '@riviamigo/ui/hooks';
import { Button, Input } from '@riviamigo/ui/primitives';
import { getBrandAsset } from '@riviamigo/ui/lib/brandAssets';
import { useDocumentPalette } from '@riviamigo/ui/hooks';
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
  const palette = useDocumentPalette();
  const accept = useAuth((state) => state.acceptAccountInvitation);
  const [token] = useState(() => window.location.hash.replace(/^#/, ''));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
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
    catch (cause) { setError(cause instanceof Error ? cause.message : 'This activation link could not be used. Ask an administrator for a new one.'); }
    finally { setLoading(false); }
  }

  async function startSso() {
    setSsoLoading(true); setError('');
    try {
      const result = await api.startAccountInvitationOidc(token);
      window.location.assign(result.authorization_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect to SSO. Try the invitation link again.');
      setSsoLoading(false);
    }
  }

  const preview = invitation.data;
  const passwordAvailable = preview?.password_available === true && preview.auth_methods !== 'sso';
  const ssoAvailable = preview?.sso_available === true && preview.auth_methods !== 'password';

  return <div className="min-h-screen bg-bg-page flex items-center justify-center px-4">
    <div className="w-full max-w-sm">
      <div className="flex flex-col items-center mb-8">
        <img src={getBrandAsset('wordmark', { dark: isDark, palette })} alt="Riviamigo" className="block h-14 w-auto" />
      </div>
      <div className="bg-bg-glass backdrop-blur-md border border-border rounded-2xl p-6 shadow-xl">
        <p className="text-[11px] font-semibold text-fg-tertiary uppercase tracking-widest mb-4">Activate account</p>
        {!token || invitation.isError ? <p className="text-sm text-status-danger">This activation link is invalid, expired, or has already been used.</p> : invitation.isLoading ? <p className="text-sm text-fg-tertiary">Checking invitation…</p> : <div className="grid gap-4">
          <p className="text-sm text-fg-secondary">Activate the account for <span className="text-fg font-medium">{preview?.email}</span>.</p>
          {ssoAvailable && <div className="grid gap-2">
            <p className="text-xs text-fg-tertiary">Use your invited email address with the SSO provider.</p>
            <Button type="button" size="lg" className="w-full" loading={ssoLoading} onClick={() => void startSso()}>{preview?.button_label || 'Continue with SSO'}</Button>
          </div>}
          {passwordAvailable && <form onSubmit={submit} className="grid gap-4">
            {ssoAvailable && <p className="text-xs text-fg-tertiary">Or create a password</p>}
            <Input label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" minLength={PASSWORD_MIN_LENGTH} required autoComplete="new-password" />
            <PasswordRequirements password={password} />
            <Button type="submit" size="lg" className="w-full" loading={loading}>Activate with password</Button>
          </form>}
          {!passwordAvailable && !ssoAvailable && <p className="text-sm text-status-danger">This invitation’s sign-in method is currently unavailable. Ask an administrator to check authentication settings or send a new invitation.</p>}
          {error && <p role="alert" className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>}
      </div>
    </div>
  </div>;
}
