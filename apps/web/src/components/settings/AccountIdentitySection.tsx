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
        <p className="text-xs text-fg-tertiary">
          SSO is this account’s only sign-in method, so it cannot be disconnected here. Contact an
          administrator if recovery is needed.
        </p>
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
