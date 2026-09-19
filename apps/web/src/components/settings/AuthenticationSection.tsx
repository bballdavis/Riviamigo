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
  return (
    <Badge size="sm" variant={source === 'environment' ? 'warning' : 'default'}>
      {source === 'environment' ? 'Environment' : source === 'database' ? 'Saved' : 'Default'}
    </Badge>
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
  const [secretAction, setSecretAction] = React.useState<'keep' | 'replace' | 'clear'>('keep');
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
  }, [settings.data]);
  const save = useMutation({
    mutationFn: (body: AuthenticationSettingsUpdate) => api.updateAuthenticationSettings(body),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.auth.authenticationSettings, data);
      setSecret('');
      setSecretAction('keep');
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
    if (secretAction === 'replace') body.client_secret = secret;
    if (secretAction === 'clear') body.client_secret = null;
    save.mutate(body);
  };
  const textField = (key: keyof AuthenticationSettingsUpdate, label: string) => (
    <label className="grid gap-1 text-sm text-fg">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <Source source={source(key)} />
      </span>
      <Input
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
          <div className="grid gap-4 md:grid-cols-2">
            {textField('issuer_url', 'Issuer URL')}
            {textField('public_base_url', 'Public base URL')}
            {textField('client_id', 'Client ID')}
            <div className="grid gap-1 text-sm text-fg">
              <span>
                Client secret <Source source={data.client_secret.source} />
              </span>
              <Input
                type="password"
                placeholder={
                  data.client_secret.configured ? 'Enter replacement secret' : 'Required'
                }
                value={secret}
                disabled={data.client_secret.source === 'environment'}
                onChange={(event) => {
                  setMessageRole('status');
                  setMessage('');
                  setSecret(event.target.value);
                  setSecretAction('replace');
                }}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setMessageRole('status');
                    setMessage('');
                    setSecret('');
                    setSecretAction('keep');
                  }}
                >
                  Keep existing
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={data.client_secret.source === 'environment'}
                  onClick={() => {
                    setMessageRole('status');
                    setMessage('');
                    setSecretAction('clear');
                  }}
                >
                  Clear secret
                </Button>
              </div>
              <p className="text-xs text-fg-tertiary">
                Save action:{' '}
                {secretAction === 'keep'
                  ? 'Keep existing secret'
                  : secretAction === 'replace'
                    ? 'Replace existing secret'
                    : 'Clear stored secret'}
              </p>
            </div>
          </div>
          {data.callback_url && (
            <p className="text-xs text-fg-tertiary">
              Callback URL: <code className="select-all">{data.callback_url}</code>
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {toggle('oidc_enabled', 'Enable SSO')}
            {toggle('password_login_enabled', 'Keep password login')}
            {toggle('auto_signup', 'Allow automatic signup')}
            {toggle('auto_link_verified_email', 'Link verified existing emails')}
          </div>
          {form.auto_link_verified_email === true && (
            <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-fg-secondary">
              <strong className="text-fg">Verified-email linking is security-sensitive.</strong>{' '}
              Prefer each user connecting SSO from their signed-in account. Enable automatic
              linking only for a single-tenant provider whose verified email addresses are unique
              and cannot be reassigned. Riviamigo requires either allowed domains or a required
              claim before this can be saved.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {textField('button_label', 'Button label')}
            {textField('scopes', 'Scopes')}
            <label className="grid gap-1 text-sm text-fg">
              <span className="flex items-center justify-between gap-2">
                <span>Token auth method</span>
                <Source source={source('token_auth_method')} />
              </span>
              <SelectPicker
                value={String(form.token_auth_method ?? 'auto')}
                disabled={environmentOwned('token_auth_method')}
                onChange={(value) => update('token_auth_method', value)}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'client_secret_basic', label: 'Client secret basic' },
                  { value: 'client_secret_post', label: 'Client secret post' },
                ]}
              />
            </label>
            <label className="grid gap-1 text-sm text-fg">
              <span className="flex items-center justify-between gap-2">
                <span>Allowed email domains</span>
                <Source source={source('allowed_email_domains')} />
              </span>
              <Input
                value={(form.allowed_email_domains ?? []).join(', ')}
                disabled={environmentOwned('allowed_email_domains')}
                onChange={(event) =>
                  update(
                    'allowed_email_domains',
                    event.target.value
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean)
                  )
                }
              />
            </label>
            {textField('required_claim_name', 'Required claim name')}
            {textField('required_claim_value', 'Required claim value')}
          </div>
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
