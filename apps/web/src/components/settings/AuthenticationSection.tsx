import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '@riviamigo/hooks';
import type { AuthenticationSettingsUpdate } from '@riviamigo/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  SelectPicker,
  Switch,
} from '@riviamigo/ui/primitives';

const fields: Array<keyof AuthenticationSettingsUpdate> = [
  'oidc_enabled',
  'password_login_enabled',
  'oidc_auto_login',
  'issuer_url',
  'public_base_url',
  'client_id',
  'button_label',
  'scopes',
  'token_auth_method',
  'auto_signup',
  'auto_link_verified_email',
  'allowed_email_domains',
  'required_claim_name',
  'required_claim_value',
];
const defaults: AuthenticationSettingsUpdate = {
  oidc_enabled: false,
  password_login_enabled: true,
  oidc_auto_login: false,
  issuer_url: '',
  public_base_url: '',
  client_id: '',
  button_label: 'Sign in with SSO',
  scopes: 'openid email profile',
  token_auth_method: 'auto',
  auto_signup: false,
  auto_link_verified_email: false,
  allowed_email_domains: [],
  required_claim_name: null,
  required_claim_value: null,
};
function Source({ source }: { source: string | undefined }) {
  if (source !== 'environment') return null;
  return (
    <Badge size="sm" variant="warning">Environment</Badge>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-border pt-4" aria-labelledby={`${title.toLowerCase().replace(/\s+/g, '-')}-heading`}>
      <div>
        <h4 id={`${title.toLowerCase().replace(/\s+/g, '-')}-heading`} className="text-sm font-semibold text-fg">{title}</h4>
        {description && <p className="mt-1 text-xs text-fg-tertiary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function AuthenticationSection() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: queryKeys.auth.authenticationSettings,
    queryFn: () => api.getAuthenticationSettings(),
    retry: false,
  });
  const [form, setForm] = React.useState<AuthenticationSettingsUpdate>(defaults);
  const [secret, setSecret] = React.useState('');
  const [removeSecret, setRemoveSecret] = React.useState(false);
  const [showAdvancedAccess, setShowAdvancedAccess] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [messageRole, setMessageRole] = React.useState<'status' | 'alert'>('status');
  React.useEffect(() => {
    if (!settings.data) return;
    const next = { ...defaults };
    fields.forEach((key) => {
      const value = settings.data[key];
      if (value && typeof value === 'object' && 'value' in value) next[key] = value.value as never;
    });
    setForm(next);
    setShowAdvancedAccess(Boolean(
      next.allowed_email_domains?.length ||
      next.required_claim_name ||
      next.required_claim_value
    ));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: (body: AuthenticationSettingsUpdate) => api.updateAuthenticationSettings(body),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.auth.authenticationSettings, data);
      void client.invalidateQueries({ queryKey: ['auth-config'] });
      setSecret('');
      setRemoveSecret(false);
      setMessageRole('status');
      setMessage('Authentication settings saved.');
    },
    onError: (error) => {
      const detail = (error as { detail?: { message?: string } }).detail?.message;
      setMessageRole('alert');
      setMessage(detail ?? 'Unable to save authentication settings.');
    },
  });
  const test = useMutation({
    mutationFn: () => api.testAuthenticationSettings(),
    onSuccess: () => {
      setMessageRole('status');
      setMessage('Provider discovery and signing keys validated.');
      void client.invalidateQueries({ queryKey: queryKeys.auth.authenticationSettings });
    },
    onError: () => {
      setMessageRole('alert');
      setMessage('Provider validation failed. Check the issuer and client settings.');
    },
  });
  if (settings.isLoading)
    return (
      <Card>
        <CardContent>
          <p role="status" className="text-sm text-fg-secondary">
            Loading authentication settings…
          </p>
        </CardContent>
      </Card>
    );
  if (settings.isError || !settings.data)
    return (
      <Card>
        <CardContent>
          <p role="alert" className="text-sm text-status-danger">
            You do not have permission to manage authentication settings, or they could not be
            loaded.
          </p>
        </CardContent>
      </Card>
    );
  const data = settings.data;
  const source = (key: keyof AuthenticationSettingsUpdate) => {
    const value = data[key];
    return value && typeof value === 'object' && 'source' in value
      ? String(value.source)
      : undefined;
  };
  const environmentOwned = (key: keyof AuthenticationSettingsUpdate) =>
    source(key) === 'environment';
  const update = (key: keyof AuthenticationSettingsUpdate, value: unknown) => {
    setMessageRole('status');
    setMessage('');
    setForm((current) => ({ ...current, [key]: value }));
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body: AuthenticationSettingsUpdate = {};
    fields.forEach((key) => {
      const setting = data[key];
      const original = setting && typeof setting === 'object' && 'value' in setting
        ? setting.value
        : undefined;
      const current = form[key];
      if (!environmentOwned(key) && JSON.stringify(current) !== JSON.stringify(original)) {
        Object.assign(body, { [key]: current });
      }
    });
    if (removeSecret) body.client_secret = null;
    else if (secret.trim()) body.client_secret = secret;
    save.mutate(body);
  };
  const textField = (key: keyof AuthenticationSettingsUpdate, label: string, placeholder?: string) => (
    <label className="grid gap-1 text-sm text-fg">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <Source source={source(key)} />
      </span>
      <Input
        placeholder={placeholder}
        value={typeof form[key] === 'string' ? (form[key] as string) : ''}
        disabled={environmentOwned(key)}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  );
  const toggle = (key: keyof AuthenticationSettingsUpdate, label: string) => (
    <div className="flex items-center gap-2 text-sm text-fg">
      <Switch
        checked={form[key] === true}
        disabled={environmentOwned(key)}
        onChange={(checked) => update(key, checked)}
        aria-label={label}
      />
      <span>{label}</span>
      <Source source={source(key)} />
    </div>
  );
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1 sm:flex-row sm:items-center">
        <CardTitle>Authentication</CardTitle>
        <p className="text-xs text-fg-tertiary sm:text-right">
          Configure OIDC SSO, test recovery, then enable it for sign-in.
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-5 rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-xs text-status-danger">
          <strong>Recovery warning:</strong> Keep a working password account until SSO has been
          tested. Environment overrides can disable SSO immediately if the provider fails.
        </div>
        <form className="grid gap-4" onSubmit={submit}>
          <Group title="Sign-in options" description="Choose how people enter Riviamigo after SSO is configured and tested.">
            <div className="grid gap-3 md:grid-cols-2">
              {toggle('oidc_enabled', 'Enable SSO')}
              {toggle('password_login_enabled', 'Allow password login')}
              {toggle('oidc_auto_login', 'Automatically login to SSO')}
            </div>
            <p className="text-xs text-fg-tertiary">Automatic sign-in starts SSO when the login page opens and the provider is available. If SSO fails, the login page stays available for a manual retry. Turn off password login separately to hide the password form.</p>
            {textField('button_label', 'SSO button label')}
          </Group>
          <Group title="Provider connection" description="Connect Riviamigo to your OIDC provider.">
            <div className="grid gap-4 md:grid-cols-2">
              {textField('issuer_url', 'Issuer URL')}
              {textField('public_base_url', 'Public base URL')}
              {textField('client_id', 'Client ID')}
              <div className="grid gap-1 text-sm text-fg">
                <span>Client secret <Source source={data.client_secret.source} /></span>
                <Input aria-label="Client secret" type="password" placeholder={data.client_secret.configured ? 'Enter replacement secret' : 'Required'} value={secret} disabled={data.client_secret.source === 'environment'} onChange={(event) => { setMessageRole('status'); setMessage(''); setSecret(event.target.value); if (event.target.value.trim()) setRemoveSecret(false); }} />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="hidden md:block" />
              <label className="flex items-start gap-2 text-xs text-fg-secondary">
                <input type="checkbox" checked={removeSecret} disabled={data.client_secret.source === 'environment'} onChange={(event) => { setMessageRole('status'); setMessage(''); setRemoveSecret(event.target.checked); setSecret(''); }} className="mt-0.5 h-4 w-4 accent-accent" />
                <span>Remove stored secret when saving</span>
              </label>
            </div>
            {data.callback_url && <p className="text-xs text-fg-tertiary">Callback URL: <code className="select-all">{data.callback_url}</code></p>}
          </Group>
          <Group title="Account access" description="Choose who can create an account or link an existing account through this provider.">
            <div className="grid gap-3 md:grid-cols-2">
              {toggle('auto_signup', 'Allow automatic signup')}
              {toggle('auto_link_verified_email', 'Link verified existing emails')}
            </div>
            <p className="text-xs text-fg-tertiary">When enabled, both options accept any verified email domain from this provider by default. Open advanced account access only if you want to restrict domains or require a provider claim.</p>
            {form.auto_link_verified_email === true && <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-fg-secondary"><strong className="text-fg">Automatic account linking is on.</strong>{' '}Anyone whose verified email from this provider matches an existing Riviamigo account can sign in to that account. If the provider can reassign addresses or serves users outside your organization, add restrictions below or ask users to connect SSO from their signed-in account.</div>}
            <Button type="button" size="sm" variant="secondary" aria-expanded={showAdvancedAccess} aria-controls="advanced-account-access" onClick={() => setShowAdvancedAccess((open) => !open)}>
              {showAdvancedAccess ? 'Hide advanced account access' : 'Show advanced account access'}
            </Button>
            <div id="advanced-account-access" className={showAdvancedAccess ? 'grid gap-3 md:grid-cols-2' : 'hidden'}>
              <label className="grid gap-1 text-sm text-fg">
                <span className="flex items-center justify-between gap-2"><span>Allowed email domains</span><Source source={source('allowed_email_domains')} /></span>
                <Input placeholder="All verified email domains" value={(form.allowed_email_domains ?? []).join(', ')} disabled={environmentOwned('allowed_email_domains')} onChange={(event) => update('allowed_email_domains', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} />
                <span className="text-xs text-fg-tertiary">Leave empty to accept any verified email domain for signup and automatic linking.</span>
              </label>
              {textField('required_claim_name', 'Required claim name', 'No extra claim required')}
              {textField('required_claim_value', 'Required claim value', 'No extra claim required')}
              <p className="text-xs text-fg-tertiary md:col-span-2">The default accepts the provider’s verified email without an extra claim. To restrict access, enter a provider-specific claim name and its exact value together. The standard email claim is handled automatically.</p>
            </div>
          </Group>
          <Group title="Advanced provider options">
            <div className="grid gap-4 md:grid-cols-2">
              {textField('scopes', 'Scopes')}
              <label className="grid gap-1 text-sm text-fg"><span className="flex items-center justify-between gap-2"><span>Token auth method</span><Source source={source('token_auth_method')} /></span><SelectPicker value={String(form.token_auth_method ?? 'auto')} disabled={environmentOwned('token_auth_method')} onChange={(value) => update('token_auth_method', value)} options={[{ value: 'auto', label: 'Auto' }, { value: 'client_secret_basic', label: 'Client secret basic' }, { value: 'client_secret_post', label: 'Client secret post' }]} /></label>
            </div>
          </Group>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending}>
              Save settings
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={test.isPending}
              onClick={() => test.mutate()}
            >
              Test provider
            </Button>
          </div>
          {data.last_validation_at && (
            <p className="text-xs text-status-positive">
              Last validation: {new Date(data.last_validation_at).toLocaleString()}
            </p>
          )}
          {message && (
            <p
              role={messageRole}
              className={messageRole === 'alert' ? 'text-sm text-status-danger' : 'text-sm text-fg-secondary'}
            >
              {message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
