import type { UseQueryResult } from '@tanstack/react-query';
import type { ApiCatalog, ApiKeyRecord, Vehicle } from '@riviamigo/types';
import { formatAppDateTime } from '@riviamigo/ui/lib/dateTime';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import { Clipboard, KeyRound, Search, Trash2 } from 'lucide-react';

export interface ApiAccessSectionProps {
  vehicles: Vehicle[] | undefined;
  apiKeys: Pick<UseQueryResult<ApiKeyRecord[]>, 'data' | 'isError' | 'refetch'>;
  apiCatalog: Pick<UseQueryResult<ApiCatalog>, 'data' | 'isLoading' | 'isError' | 'refetch'>;
  apiKeyName: string;
  onApiKeyNameChange: (name: string) => void;
  apiKeyVehicleId: string;
  onApiKeyVehicleIdChange: (vehicleId: string) => void;
  createdKey: string | null;
  onCopyCreatedKey: () => void;
  createPending: boolean;
  onCreate: () => void;
  revokePending: boolean;
  onRevoke: (keyId: string) => void;
  apiCatalogSearch: string;
  onApiCatalogSearchChange: (query: string) => void;
  filteredApiEndpoints: ApiCatalog['endpoints'];
}

/** Integration keys (create, list, revoke) and the read-only endpoint reference. */
export function ApiAccessSection({
  vehicles,
  apiKeys,
  apiCatalog,
  apiKeyName,
  onApiKeyNameChange,
  apiKeyVehicleId,
  onApiKeyVehicleIdChange,
  createdKey,
  onCopyCreatedKey,
  createPending,
  onCreate,
  revokePending,
  onRevoke,
  apiCatalogSearch,
  onApiCatalogSearchChange,
  filteredApiEndpoints,
}: ApiAccessSectionProps) {
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Integration Keys</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-fg-tertiary">
            Integration keys are read-only and limited to one vehicle. Dashboard, account, and administrative changes stay in the signed-in app.
          </p>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_13rem_auto] md:items-end">
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Name</span>
              <input
                value={apiKeyName}
                onChange={(event) => onApiKeyNameChange(event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Vehicle</span>
              <SelectPicker
                className="w-full"
                value={apiKeyVehicleId}
                onChange={onApiKeyVehicleIdChange}
                aria-label="API key vehicle"
                options={vehicles?.map((vehicle) => ({ value: vehicle.id, label: vehicle.display_name })) ?? []}
              />
            </label>
            <Button
              size="sm"
              iconLeft={<KeyRound className="h-3.5 w-3.5" />}
              loading={createPending}
              disabled={!apiKeyVehicleId || !apiKeyName.trim()}
              onClick={() => onCreate()}
            >
              Create
            </Button>
          </div>

          {createdKey && (
            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-fg">New key</p>
                <Button variant="secondary" size="sm" iconLeft={<Clipboard className="h-3.5 w-3.5" />} onClick={onCopyCreatedKey}>
                  Copy
                </Button>
              </div>
              <p className="break-all font-mono text-xs text-fg">{createdKey}</p>
              <p className="mt-2 text-xs text-fg-tertiary">This is shown once. Store it before leaving this section.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Issued Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {apiKeys.isError && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-fg">
              <span>Could not load integration keys. The server logged the request details; retry after checking the API migration status.</span>
              <Button variant="secondary" size="sm" onClick={() => apiKeys.refetch()}>Retry</Button>
            </div>
          )}
          {(apiKeys.data?.length ?? 0) === 0 && (
            <p className="text-sm text-fg-tertiary">No API keys issued yet.</p>
          )}
          <div className="divide-y divide-border">
            {apiKeys.data?.map((key) => (
              <div key={key.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-fg">{key.name}</p>
                    <Badge variant={key.revoked_at ? 'default' : key.access_level_state === 'legacy_unmigrated' ? 'warning' : 'success'}>
                      {key.revoked_at ? 'revoked' : key.access_level_state === 'legacy_unmigrated' ? `${key.access_level} · migrate` : key.access_level}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-fg-tertiary">{key.id}</p>
                  <p className="mt-1 text-xs text-fg-tertiary">
                    Created {formatAppDateTime(key.created_at)}
                    {key.last_used_at ? ` / Last used ${formatAppDateTime(key.last_used_at)}` : ' / Never used'}
                  </p>
                </div>
                {!key.revoked_at && (
                  <Button
                    variant="danger"
                    size="sm"
                    iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                    loading={revokePending}
                    onClick={() => onRevoke(key.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Integration Reference</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="relative">
            <label className="sr-only" htmlFor="api-endpoint-search">Search API endpoints</label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary" />
            <input
              id="api-endpoint-search"
              value={apiCatalogSearch}
              onChange={(event) => onApiCatalogSearchChange(event.target.value)}
              placeholder="Search API endpoints"
              className="h-9 w-full rounded-lg border border-border bg-bg-surface pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-tertiary focus:border-accent"
            />
          </div>

          {apiCatalog.isLoading && <p className="text-sm text-fg-tertiary">Loading API endpoints...</p>}
          {apiCatalog.isError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-fg">
              <span>Could not load the API endpoint list.</span>
              <Button variant="secondary" size="sm" onClick={() => apiCatalog.refetch()}>Retry</Button>
            </div>
          )}
          {!apiCatalog.isLoading && !apiCatalog.isError && (
            <>
              <p className="text-xs text-fg-tertiary">
                Showing {filteredApiEndpoints.length} of {apiCatalog.data?.endpoints.length ?? 0} endpoints
              </p>
              {filteredApiEndpoints.length > 0 ? (
                <div className="divide-y divide-border rounded-lg border border-border">
                  {filteredApiEndpoints.map((endpoint) => (
                    <div key={`${endpoint.method}-${endpoint.path}`} className="flex items-center gap-3 px-3 py-2.5">
                      <Badge variant="default">{endpoint.method}</Badge>
                      <span className="min-w-0 break-all font-mono text-xs text-fg">{endpoint.path}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-fg-tertiary">No endpoints match your search.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
