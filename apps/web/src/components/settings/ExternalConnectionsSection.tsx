import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@riviamigo/hooks';
import type {
  ExternalConnectionMode,
  ExternalConnectionRecord,
  UpdateExternalConnectionBody,
} from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import { ExternalLink, RefreshCw, Save, ShieldOff } from 'lucide-react';

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
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = items.find((connection) => connection.id === selectedId) ?? items[0];

  React.useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader className="items-start">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>External Connections</CardTitle>
              <p className="mt-1 max-w-3xl text-sm text-fg-tertiary">
                See exactly what leaves this Riviamigo installation, choose remote or self-hosted providers, and understand what stops when a connection is disabled.
              </p>
            </div>
            {canManage ? (
              <Button
                variant="danger"
                size="sm"
                iconLeft={<ShieldOff className="h-3.5 w-3.5" />}
                loading={disableOptional.isPending}
                className="shrink-0"
                onClick={() => {
                  if (window.confirm('Disable every optional external connection? Rivian vehicle connectivity remains configured, but weather, geocoding, basemaps, and Iconify will stop.')) {
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

      {items.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="External connections" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {items.map((connection) => {
              const active = connection.enabled && connection.mode !== 'disabled';
              const selectedConnection = connection.id === selected?.id;
              return (
                <button
                  key={connection.id}
                  type="button"
                  onClick={() => setSelectedId(connection.id)}
                  className={`min-w-44 rounded-xl border px-3 py-2.5 text-left transition lg:min-w-0 ${selectedConnection ? 'border-accent bg-accent/10' : 'border-border bg-bg-elevated/30 hover:bg-bg-elevated/60'}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-fg">{connection.name}</span>
                    <Badge variant={active ? 'success' : 'default'}>{active ? 'Enabled' : 'Disabled'}</Badge>
                  </span>
                  <span className="mt-1 block truncate text-xs text-fg-tertiary">{connection.mode === 'remote' ? 'Remote service' : connection.mode === 'custom' ? 'Custom endpoint' : 'No outbound requests'}</span>
                </button>
              );
            })}
          </nav>
          {selected ? <ConnectionCard connection={selected} canManage={canManage} onUpdated={(data) => queryClient.setQueryData(CONNECTION_QUERY_KEY, data)} /> : null}
        </div>
      ) : null}
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
  canManage,
  onUpdated,
}: {
  connection: ExternalConnectionRecord;
  canManage: boolean;
  onUpdated: (data: Awaited<ReturnType<typeof api.getExternalConnections>>) => void;
}) {
  const [draft, setDraft] = React.useState<UpdateExternalConnectionBody>(() => toDraft(connection));
  const [apiKey, setApiKey] = React.useState('');
  const [bearerToken, setBearerToken] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = React.useState<string | null>(null);
  const queryClient = useQueryClient();

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
      setMessage(result.checks.map((check) => `${check.label}: ${check.message}`).join(' '));
      setPreviewDataUrl(result.preview_data_url);
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Connection test failed.'),
  });
  const purgeCache = useMutation({
    mutationFn: () => api.purgeExternalConnectionCache(connection.id),
    onSuccess: (result) => {
      setMessage(`${result.message} ${result.purged_entries.toLocaleString()} entries removed.`);
      queryClient.invalidateQueries({ queryKey: CONNECTION_QUERY_KEY });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not purge cache.'),
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
      <CardHeader className="items-start">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{connection.name}</CardTitle>
              {connection.endpoint_is_private ? <Badge variant="default">Local/private</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-fg-tertiary">{connection.purpose}</p>
          </div>
          <Badge className="shrink-0" variant={active ? 'success' : 'default'}>{active ? 'Enabled' : 'Disabled'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <Info label="Runs from" value={connection.execution} />
          <Info label="Requests today" value={String(connection.request_count_today)} />
          <Info label="Endpoint" value={connection.endpoint ?? 'Managed elsewhere'} mono />
          <Info label="Last attempt" value={connection.last_attempt_at ? new Date(connection.last_attempt_at).toLocaleString() : 'No recorded request'} />
          <Info label="Last success" value={connection.last_success_at ? new Date(connection.last_success_at).toLocaleString() : 'No recorded request'} />
          <Info label="Last verification" value={connection.last_test_at ? `${connection.last_test_ok ? 'Passed' : 'Failed'} ${new Date(connection.last_test_at).toLocaleString()}` : 'Not verified'} />
          {connection.id === 'open_meteo' ? <Info label="Sampling / budget" value={`${connection.request_count_today.toLocaleString()} / 8,000 requests today; 15-minute samples`} /> : null}
        </div>

        <div className="rounded-xl border border-border bg-bg-elevated/30 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Data shared</p>
          <ul className="mt-2 grid gap-1 text-sm text-fg">
            {connection.data_shared.map((item) => <li key={item}>• {item}</li>)}
          </ul>
          <p className="mt-3 text-xs text-fg-tertiary"><span className="font-medium text-fg">If disabled:</span> {connection.disabled_effect}</p>
        </div>

        {connection.cache ? (
          <div className="rounded-xl border border-border bg-bg-elevated/30 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Local cache</p>
                <p className="mt-1 text-sm text-fg">{connection.cache.entries.toLocaleString()} entries · {formatBytes(connection.cache.bytes)}</p>
                <p className="mt-1 max-w-2xl text-xs text-fg-tertiary">{connection.cache.description}</p>
              </div>
              {canManage && connection.cache.purgeable ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={purgeCache.isPending}
                  onClick={() => {
                    if (window.confirm(`Purge the ${connection.name} cache? The next matching request may contact the provider again.`)) purgeCache.mutate();
                  }}
                >
                  Purge cache
                </Button>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-fg-tertiary">{connection.cache.persistent ? 'Persistent across normal restarts.' : 'In-memory only.'}</p>
          </div>
        ) : null}

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

        {!connection.editable && canManage && active ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3">
            <p className="mr-auto text-xs text-fg-tertiary">Verify this managed connection with a safe, non-mutating check.</p>
            <Button variant="secondary" size="sm" loading={test.isPending} onClick={testDraft}>Verify connection</Button>
          </div>
        ) : null}

        {connection.last_error ? <p className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-2 text-xs text-fg">Last runtime error: {connection.last_error}</p> : null}
        {connection.last_test_error ? <p className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-2 text-xs text-fg">Last verification error: {connection.last_test_error}</p> : null}
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
  const [preset, setPreset] = React.useState('generic');
  const usesHttp = [draft.forecast_url, draft.archive_url, draft.base_url, draft.light_url_template, draft.dark_url_template]
    .some((value) => typeof value === 'string' && value.trim().toLowerCase().startsWith('http://'));
  const textField = (key: keyof UpdateExternalConnectionBody, label: string, placeholder = '') => (
    <Field label={label}>
      <input value={String(draft[key] ?? '')} placeholder={placeholder} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} className="h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent" />
    </Field>
  );

  return (
    <div className="grid gap-3">
      {connection.id === 'open_meteo' || connection.id === 'nominatim' || connection.id === 'basemap' ? (
        <Field label="Compatible preset">
          <SelectPicker
            className="w-full"
            value={preset}
            onChange={(value) => {
              setPreset(value);
              const values = customPreset(connection.id, value);
              if (values) setDraft((current) => ({ ...current, ...values }));
            }}
            aria-label={`${connection.name} custom endpoint preset`}
            options={presetOptions(connection.id)}
          />
        </Field>
      ) : null}
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  if (id === 'basemap') return [{ value: 'remote', label: 'Remote CARTO' }, { value: 'custom', label: 'Custom XYZ' }, { value: 'disabled', label: 'None' }];
  if (id === 'nominatim') return [{ value: 'remote', label: 'Remote OpenStreetMap' }, { value: 'custom', label: 'Custom / self-hosted' }, { value: 'disabled', label: 'Disabled' }];
  if (id === 'open_meteo') return [{ value: 'remote', label: 'Remote Open-Meteo' }, { value: 'custom', label: 'Custom / self-hosted' }, { value: 'disabled', label: 'Disabled' }];
  return [{ value: 'remote', label: 'Remote service' }, { value: 'disabled', label: 'Disabled' }];
}

function presetOptions(id: string) {
  if (id === 'open_meteo') return [{ value: 'generic', label: 'Open-Meteo compatible' }];
  if (id === 'nominatim') return [{ value: 'generic', label: 'Nominatim compatible' }, { value: 'nominatim-local', label: 'Local Nominatim (http://localhost:8080)' }];
  return [{ value: 'generic', label: 'Generic XYZ template' }, { value: 'tileserver-gl', label: 'TileServer GL raster (http://localhost:8080)' }];
}

function customPreset(id: string, preset: string): Partial<UpdateExternalConnectionBody> | null {
  if (id === 'nominatim' && preset === 'nominatim-local') return { base_url: 'http://localhost:8080', allow_private_network: true };
  if (id === 'basemap' && preset === 'tileserver-gl') return {
    light_url_template: 'http://localhost:8080/styles/osm-bright/{z}/{x}/{y}.png',
    dark_url_template: '',
    attribution: '© OpenStreetMap contributors',
    attribution_url: 'https://www.openstreetmap.org/copyright',
    allow_private_network: true,
  };
  return null;
}
