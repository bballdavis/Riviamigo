import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '@riviamigo/hooks';
import { Badge, Button, Input } from '@riviamigo/ui/primitives';
export function AccountIdentitySection() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: queryKeys.auth.identities,
    queryFn: () => api.getOidcIdentities(),
    retry: false,
  });
  const [password, setPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [message, setMessage] = React.useState('');
  const link = useMutation({
    mutationFn: () => api.startOidcLink('/settings?section=account'),
    onSuccess: (r) => window.location.assign(r.authorization_url),
  });
  const unlink = useMutation({
    mutationFn: () => api.unlinkOidc(password),
    onSuccess: () => {
      setPassword('');
      setMessage('SSO disconnected.');
      void qc.invalidateQueries({ queryKey: queryKeys.auth.identities });
    },
    onError: () => setMessage('Unable to disconnect SSO. Check your current password.'),
  });
  const setInitialPassword = useMutation({
    mutationFn: () => api.startOidcPasswordSetup(newPassword),
    onSuccess: (r) => window.location.assign(r.authorization_url),
    onError: () => setMessage('Unable to start SSO verification for the recovery password.'),
  });
  if (q.isLoading)
    return (
      <p role="status" className="text-sm text-fg-secondary">
        Loading sign-in methods…
      </p>
    );
  const data = q.data;
  if (!data) return null;
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">Password sign-in</p>
          <p className="text-xs text-fg-tertiary">
            {data.password_configured ? 'Configured' : 'Not configured'}
          </p>
        </div>
        <Badge variant={data.password_configured ? 'success' : 'warning'}>
          {data.password_configured ? 'Active' : 'Missing'}
        </Badge>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">Single sign-on</p>
          <p className="text-xs text-fg-tertiary">
            {data.oidc_linked
              ? 'This account is linked to the configured provider.'
              : data.oidc_link_available
                ? 'Connect the configured provider to this account.'
                : 'SSO has not been configured by an administrator.'}
          </p>
        </div>
        {data.oidc_linked ? (
          <Badge variant="success">Linked</Badge>
        ) : (
          <Button
            size="sm"
            loading={link.isPending}
            disabled={!data.oidc_link_available}
            onClick={() => link.mutate()}
          >
            Connect SSO
          </Button>
        )}
      </div>
      {data.oidc_linked && !data.password_configured && (
        <div className="grid max-w-sm gap-3 rounded-lg border border-border bg-surface-subtle p-4">
          <div>
            <p className="text-sm font-medium text-fg">Set a recovery password</p>
            <p className="mt-1 text-xs text-fg-tertiary">
              SSO is currently this account’s only sign-in method. Riviamigo will ask the provider
              to verify you again before saving this password.
            </p>
          </div>
          <Input
            label="New recovery password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
          />
          <Input
            label="Confirm recovery password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            minLength={12}
            {...(confirmPassword && confirmPassword !== newPassword
              ? { error: 'Passwords do not match.' }
              : {})}
          />
          <p className="text-xs text-fg-tertiary">
            Use at least 12 characters. Other refresh sessions are revoked when the password is
            set; existing short-lived access tokens expire normally.
          </p>
          <Button
            size="sm"
            loading={setInitialPassword.isPending}
            disabled={newPassword.length < 12 || newPassword !== confirmPassword}
            onClick={() => setInitialPassword.mutate()}
          >
            Verify SSO and set password
          </Button>
        </div>
      )}
      {data.oidc_linked && data.password_configured && (
        <div className="grid max-w-sm gap-2">
          <Input
            label="Current password to disconnect SSO"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={unlink.isPending}
            disabled={!password}
            onClick={() => unlink.mutate()}
          >
            Disconnect SSO
          </Button>
        </div>
      )}
      {message && (
        <p
          role={message.startsWith('Unable') ? 'alert' : 'status'}
          className="text-sm text-fg-secondary"
        >
          {message}
        </p>
      )}
    </div>
  );
}
