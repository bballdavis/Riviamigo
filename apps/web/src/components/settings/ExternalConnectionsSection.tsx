import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@riviamigo/hooks';
import type {
  ExternalConnectionMode,
  ExternalConnectionRecord,
  UpdateExternalConnectionBody,
} from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import { ExternalLink, Globe2, RefreshCw, Save, ShieldOff } from 'lucide-react';

const CONNECTION_QUERY_KEY = ['external-connections'] as const;

export function ExternalConnectionsSection() {
  const queryClient = useQueryClient();
  const connections = useQuery({
    queryKey: CONNECTION_QUERY_KEY,
    queryFn: () => api.getExternalConnections(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const disableOptional = useMutation({
    mutationFn: () => api.disableOptionalExternalConnections(),
    onSuccess: (data) => queryClient.setQueryData(CONNECTION_QUERY_KEY, data),
  });

  const canManage = connections.data?.can_manage ?? false;
  const items = connections.data?.connections ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>External Connections</CardTitle>
              <p className="mt-1 max-w-3xl text-sm text-fg-tertiary">
                See exactly what leaves this Riviamigo installation, choose hosted or self-hosted providers, and understand what stops when a connection is disabled.
              </p>
            </div>
            {canManage ? (
              <Button
                variant="danger"
                size="sm"
                iconLeft={<ShieldOff className="h-3.5 w-3.5" />}
                loading={disableOptional.isPending}
                onClick={() => {
                  if (window.confirm('Disable every optional external connection? Rivian vehicle connectivity remains configured, but weather, geocoding, basemaps, Iconify, and new vehicle artwork requests will stop.')) {
                    disableOptional.mutate();
                  }
                }}
              >
                Disable optional
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryItem label="Policy" value="Installation-wide" />
            <SummaryItem label="Browser egress" value="Proxied through Riviamigo" />
            <SummaryItem label="Weather precision" value="Approx. 1 km by default" />
          </div>
          {!canManage && !connections.isLoading ? (
            <p className="mt-4 rounded-lg border border-border bg-bg-elevated/40 p-3 text-sm text-fg-tertiary">
              These settings are visible to everyone. An administrator controls the installation policy.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {connections.isLoading ? (
        <Card><CardContent className="py-8 text-sm text-fg-tertiary">Loading external connections…</CardContent></Card>
      ) : null}
      {connections.isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-5">
            <p className="text-sm text-fg">External connection settings could not be loaded.</p>
            <Button variant="secondary" size="sm" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => connections.refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {items.map((connection) => (
          <ConnectionCard key={connection.id} connection={connection} onUpdated={(data) => queryClient.setQueryData(CONNECTION_QUERY_KEY, data)} />
        ))}
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated/35 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">{label}</p>
      <p className="mt-1 text-sm text-fg">{value}</p>
    </div>
  );
}

function ConnectionCard({
  connection,
  onUpdated,
}: {
  connection: ExternalConnectionRecord;
  onUpdated: (data: Awaited<ReturnType<typeof api.getExternalConnections>>) => void;
}) {
  const [draft, setDraft] = React.useState<UpdateExternalConnectionBody>(() => toDraft(connection));
  const [apiKey, setApiKey] = React.useState('');
  const [bearerToken, setBearerToken] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(toDraft(connection));
    setApiKey('');
    setBearerToken('');
    setPreviewDataUrl(null);
  }, [connection]);

  const update = useMutation({
    mutationFn: (body: UpdateExternalConnectionBody) => api.updateExternalConnection(connection.id, body),
    onSuccess: (data) => {
      onUpdated(data);
      setMessage('Saved.');
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not save connection.'),
  });
  const test = useMutation({
    mutationFn: (body: UpdateExternalConnectionBody) => api.testExternalConnection(connection.id, body),
    onSuccess: (result) => {
      setMessage(result.message);
      setPreviewDataUrl(result.preview_data_url);
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Connection test failed.'),
  });

  const active = draft.enabled && draft.mode !== 'disabled';
  const custom = draft.mode === 'custom';

  function save() {
    if (!active && connection.enabled && !window.confirm(`Disable ${connection.name}? ${connection.disabled_effect}`)) return;
    update.mutate({
      ...draft,
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      ...(bearerToken.trim() ? { bearer_token: bearerToken.trim() } : {}),
    });
  }

  function testDraft() {
    test.mutate({
      ...draft,
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      ...(bearerToken.trim() ? { bearer_token: bearerToken.trim() } : {}),
    });
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{connection.name}</CardTitle>
              <Badge variant={active ? 'success' : 'default'}>{active ? 'Enabled' : 'Disabled'}</Badge>
              {connection.endpoint_is_private ? <Badge variant="default">Local/private</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-fg-tertiary">{connection.purpose}</p>
          </div>
          <Globe2 className="h-5 w-5 shrink-0 text-fg-tertiary" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <Info label="Runs from" value={connection.execution} />
          <Info label="Requests today" value={String(connection.request_count_today)} />
          <Info label="Endpoint" value={connection.endpoint ?? 'Managed elsewhere'} mono />
          <Info label="Last attempt" value={connection.last_attempt_at ? new Date(connection.last_attempt_at).toLocaleString() : 'No recorded request'} />
          <Info label="Last success" value={connection.last_success_at ? new Date(connection.last_success_at).toLocaleString() : 'No recorded request'} />
          {connection.id === 'open_meteo' ? <Info label="Sampling / budget" value={`${connection.request_count_today.toLocaleString()} / 8,000 requests today; 15-minute samples`} /> : null}
        </div>

        <div className="rounded-xl border border-border bg-bg-elevated/30 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Data shared</p>
          <ul className="mt-2 grid gap-1 text-sm text-fg">
            {connection.data_shared.map((item) => <li key={item}>• {item}</li>)}
          </ul>
          <p className="mt-3 text-xs text-fg-tertiary"><span className="font-medium text-fg">If disabled:</span> {connection.disabled_effect}</p>
        </div>

        {connection.editable ? (
          <div className="grid gap-3 rounded-xl border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Mode">
                <SelectPicker
                  className="w-full"
                  value={draft.mode}
                  onChange={(value) => setDraft((current) => ({ ...current, mode: value as ExternalConnectionMode, enabled: value !== 'disabled' }))}
                  aria-label={`${connection.name} mode`}
                  options={modeOptions(connection.id)}
                />
              </Field>
              {connection.id === 'open_meteo' ? (
                <Field label="Weather location">
                  <SelectPicker
                    className="w-full"
                    value={draft.weather_precision ?? 'approximate'}
                    onChange={(value) => setDraft((current) => ({ ...current, weather_precision: value as 'approximate' | 'exact' }))}
                    aria-label="Weather location precision"
                    options={[{ value: 'approximate', label: 'Approximate (~1 km)' }, { value: 'exact', label: 'Exact route samples' }]}
                  />
                </Field>
              ) : null}
            </div>

            {custom ? <CustomFields connection={connection} draft={draft} setDraft={setDraft} apiKey={apiKey} setApiKey={setApiKey} bearerToken={bearerToken} setBearerToken={setBearerToken} /> : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" iconLeft={<Save className="h-3.5 w-3.5" />} loading={update.isPending} onClick={save}>Save</Button>
              {active ? <Button variant="secondary" size="sm" loading={test.isPending} onClick={testDraft}>Test with synthetic data</Button> : null}
            </div>
            {previewDataUrl ? (
              <div className="overflow-hidden rounded-xl border border-border bg-bg-elevated/40">
                <img src={previewDataUrl} alt="Synthetic basemap preview" className="h-36 w-full object-cover" />
                <p className="p-2 text-xs text-fg-tertiary">Synthetic world-tile preview from the unsaved endpoint settings above.</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {connection.last_error ? <p className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-2 text-xs text-fg">Last error: {connection.last_error}</p> : null}
        {message ? <p className="text-xs text-fg-tertiary" role="status">{message}</p> : null}
        <div className="flex flex-wrap gap-3 text-xs">
          {connection.privacy_url ? <ExternalAnchor href={connection.privacy_url}>Privacy</ExternalAnchor> : null}
          {connection.terms_url ? <ExternalAnchor href={connection.terms_url}>Terms / policy</ExternalAnchor> : null}
          {connection.attribution_url ? <ExternalAnchor href={connection.attribution_url}>{connection.attribution ?? 'Attribution'}</ExternalAnchor> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function CustomFields({ connection, draft, setDraft, apiKey, setApiKey, bearerToken, setBearerToken }: {
  connection: ExternalConnectionRecord;
  draft: UpdateExternalConnectionBody;
  setDraft: React.Dispatch<React.SetStateAction<UpdateExternalConnectionBody>>;
  apiKey: string;
  setApiKey: (value: string) => void;
  bearerToken: string;
  setBearerToken: (value: string) => void;
}) {
  const usesHttp = [draft.forecast_url, draft.archive_url, draft.base_url, draft.light_url_template, draft.dark_url_template]
    .some((value) => typeof value === 'string' && value.trim().toLowerCase().startsWith('http://'));
  const textField = (key: keyof UpdateExternalConnectionBody, label: string, placeholder = '') => (
    <Field label={label}>
      <input value={String(draft[key] ?? '')} placeholder={placeholder} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} className="h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent" />
    </Field>
  );

  return (
    <div className="grid gap-3">
      {connection.id === 'open_meteo' ? <>
        {textField('forecast_url', 'Forecast URL')}
        {textField('archive_url', 'Archive URL')}
        <Field label={`API key${connection.has_api_key ? ' (stored)' : ''}`}><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connection.has_api_key ? 'Leave blank to keep stored key' : 'Optional'} className="h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent" /></Field>
      </> : null}
      {connection.id === 'nominatim' ? <>
        {textField('base_url', 'Nominatim base URL')}
        {textField('request_identifier', 'Request identifier / contact', 'Riviamigo project identifier')}
        <label className="flex items-start gap-2 text-sm text-fg"><input type="checkbox" checked={draft.custom_autocomplete ?? false} onChange={(event) => setDraft((current) => ({ ...current, custom_autocomplete: event.target.checked }))} className="mt-0.5" /><span>Allow debounced autocomplete on this self-hosted provider</span></label>
      </> : null}
      {connection.id === 'basemap' ? <>
        {textField('light_url_template', 'Light XYZ template', 'https://tiles/{z}/{x}/{y}.png')}
        {textField('dark_url_template', 'Dark XYZ template (optional)')}
        {textField('attribution', 'Attribution')}
        {textField('attribution_url', 'Attribution URL')}
        <Field label={`Bearer token${connection.has_bearer_token ? ' (stored)' : ''}`}><input type="password" value={bearerToken} onChange={(event) => setBearerToken(event.target.value)} placeholder={connection.has_bearer_token ? 'Leave blank to keep stored token' : 'Optional'} className="h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent" /></Field>
      </> : null}
      {usesHttp ? (
        <p className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-fg">
          HTTP is accepted only for a local/private endpoint. Traffic to that service is not encrypted.
        </p>
      ) : null}
      <label className="flex items-start gap-2 text-sm text-fg"><input type="checkbox" checked={draft.allow_private_network ?? false} onChange={(event) => setDraft((current) => ({ ...current, allow_private_network: event.target.checked }))} className="mt-0.5" /><span>This is an intentional local/private-network endpoint</span></label>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1"><span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">{label}</span>{children}</label>;
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><p className="font-medium uppercase tracking-wide text-fg-tertiary">{label}</p><p className={`mt-0.5 truncate text-fg ${mono ? 'font-mono' : ''}`} title={value}>{value}</p></div>;
}

function ExternalAnchor({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">{children}<ExternalLink className="h-3 w-3" /></a>;
}

function toDraft(connection: ExternalConnectionRecord): UpdateExternalConnectionBody {
  return {
    enabled: connection.enabled,
    mode: connection.mode,
    weather_precision: connection.weather_precision,
    forecast_url: connection.forecast_url,
    archive_url: connection.archive_url,
    base_url: connection.base_url,
    light_url_template: connection.light_url_template,
    dark_url_template: connection.dark_url_template,
    attribution: connection.attribution,
    attribution_url: connection.attribution_url,
    request_identifier: connection.request_identifier,
    custom_autocomplete: connection.custom_autocomplete,
    allow_private_network: connection.allow_private_network,
  };
}

function modeOptions(id: string) {
  if (id === 'basemap') return [{ value: 'hosted', label: 'CARTO' }, { value: 'custom', label: 'Custom XYZ' }, { value: 'disabled', label: 'None' }];
  if (id === 'nominatim') return [{ value: 'hosted', label: 'Public OpenStreetMap' }, { value: 'custom', label: 'Custom / self-hosted' }, { value: 'disabled', label: 'Disabled' }];
  if (id === 'open_meteo') return [{ value: 'hosted', label: 'Hosted Open-Meteo' }, { value: 'custom', label: 'Custom / self-hosted' }, { value: 'disabled', label: 'Disabled' }];
  return [{ value: 'hosted', label: 'Hosted' }, { value: 'disabled', label: 'Disabled' }];
}
