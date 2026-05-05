import React from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rootRoute } from './__root';
import { api, useAuth, useVehicles } from '@riviamigo/hooks';
import type { ApiAccessLevel, VehicleImages } from '@riviamigo/types';
import { formatMiles, formatPressure, formatTemp, getUnitSystem, setUnitSystem as saveUnitSystem, type UnitSystem } from '@riviamigo/ui/lib/utils';
import {
  PageLayout, Card, CardHeader, CardTitle, CardContent,
  Button, Badge, ThemeToggle, Tooltip,
} from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { PlacesSection } from '../components/settings/PlacesSection';
import {
  Car, CircleHelp, Clipboard, Database, KeyRound, LogOut, MapPin, Pencil, Plus, Ruler, ShieldCheck, Trash2,
} from 'lucide-react';

type BatteryGen = 'gen1' | 'gen2';

const RIVIAN_BATTERY_PRESETS: Record<BatteryGen, Array<{ key: string; label: string; kwh: number | null }>> = {
  gen1: [
    { key: 'r1_standard_g1', label: 'R1T / R1S Standard (Gen 1)', kwh: 105 },
    { key: 'r1_large_g1',    label: 'R1T / R1S Large (Gen 1)',    kwh: 135 },
    { key: 'r1_max_g1',      label: 'R1T / R1S Max (Gen 1)',      kwh: 180 },
    { key: 'custom',         label: 'Custom',                     kwh: null },
  ],
  gen2: [
    { key: 'r1_standard_g2', label: 'R1T / R1S Standard (Gen 2)', kwh: 92.5 },
    { key: 'r1_large_g2',    label: 'R1T / R1S Large (Gen 2)',    kwh: 109 },
    { key: 'r1_max_g2',      label: 'R1T / R1S Max (Gen 2)',      kwh: 140 },
    { key: 'custom',         label: 'Custom',                     kwh: null },
  ],
};

const ALL_PRESETS = [...RIVIAN_BATTERY_PRESETS.gen1, ...RIVIAN_BATTERY_PRESETS.gen2];
const R2S_PRESET = { key: 'r2s', label: 'R2S', kwh: 82 };

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

type SettingsSection = 'vehicles' | 'units' | 'places' | 'api' | 'raw' | 'appearance' | 'account';

const sections: Array<{ id: SettingsSection; label: string; icon: React.ElementType }> = [
  { id: 'vehicles', label: 'Vehicles', icon: Car },
  { id: 'units', label: 'Units', icon: Ruler },
  { id: 'places', label: 'Places', icon: MapPin },
  { id: 'api', label: 'API Access', icon: KeyRound },
  { id: 'raw', label: 'Raw Data', icon: Database },
  { id: 'appearance', label: 'Appearance', icon: ShieldCheck },
  { id: 'account', label: 'Account', icon: LogOut },
];

const accessLevels: Array<{
  value: ApiAccessLevel;
  label: string;
  copy: string;
}> = [
  { value: 'view', label: 'View', copy: 'Read-only dashboard and diagnostic data.' },
  { value: 'edit', label: 'Edit', copy: 'Read access plus owned dashboard/configuration writes.' },
  { value: 'admin', label: 'Admin', copy: 'Admin routes. Creation requires an admin user.' },
];

function formatRawNumber(value: number | null | undefined, unit = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : '-';
}

function formatCount(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '0';
}

function formatSuppressionRate(suppressed: number | undefined, persisted: number | undefined) {
  const total = (suppressed ?? 0) + (persisted ?? 0);
  if (total <= 0) return '0%';
  return `${Math.round(((suppressed ?? 0) / total) * 100)}%`;
}

function ThemeVehicleImage({
  images,
  placement,
  className,
  fallback,
}: {
  images?: VehicleImages | null | undefined;
  placement: 'side' | 'overhead' | 'front' | 'rear';
  className?: string;
  fallback: React.ReactNode;
}) {
  const pair = images?.[placement];
  const light = pair?.light ?? pair?.dark ?? images?.all?.find((image) => image.placement === placement)?.url;
  const dark = pair?.dark ?? pair?.light ?? light;

  if (!light && !dark) return <>{fallback}</>;

  return (
    <>
      {light && <img src={light} alt="" className={`${className ?? ''} dark:hidden`} loading="lazy" />}
      {dark && <img src={dark} alt="" className={`${className ?? ''} hidden dark:block`} loading="lazy" />}
    </>
  );
}

function SettingsPage() {
  return <AuthGuard><SettingsContent /></AuthGuard>;
}

export function SettingsContent() {
  const { logout, defaultVehicleId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: vehicles } = useVehicles();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(),
  });
  const [activeSection, setActiveSection] = React.useState<SettingsSection>('vehicles');
  const [apiKeyName, setApiKeyName] = React.useState('Local troubleshooting');
  const [apiKeyVehicleId, setApiKeyVehicleId] = React.useState('');
  const [apiAccessLevel, setApiAccessLevel] = React.useState<ApiAccessLevel>('view');
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);
  const [rawVehicleId, setRawVehicleId] = React.useState('');
  const [unitSystem, setUnitSystemState] = React.useState<UnitSystem>(() => getUnitSystem());
  const [rawTableView, setRawTableView] = React.useState<'table' | 'json'>('table');
  const [editingBatteryVehicleId, setEditingBatteryVehicleId] = React.useState<string | null>(null);
  const [batteryGen, setBatteryGen] = React.useState<BatteryGen>('gen1');
  const [batteryPreset, setBatteryPreset] = React.useState('r1_large_g1');
  const [customKwh, setCustomKwh] = React.useState('');
  const isAdmin = me.data?.role === 'admin';

  const apiKeys = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.listApiKeys(),
    enabled: activeSection === 'api',
  });

  const apiCatalog = useQuery({
    queryKey: ['api-catalog'],
    queryFn: () => api.getApiCatalog(),
    enabled: activeSection === 'api',
  });

  const stewardship = useQuery({
    queryKey: ['rivian-stewardship'],
    queryFn: () => api.getRivianStewardship(),
    enabled: activeSection === 'raw' && isAdmin,
  });

  React.useEffect(() => {
    if (!apiKeyVehicleId && vehicles?.[0]?.id) {
      setApiKeyVehicleId(vehicles[0].id);
    }
    if (!rawVehicleId && vehicles?.[0]?.id) {
      setRawVehicleId(vehicles[0].id);
    }
  }, [apiKeyVehicleId, rawVehicleId, vehicles]);

  const rawTelemetry = useQuery({
    queryKey: ['raw-telemetry', rawVehicleId],
    queryFn: () => api.getRawTelemetry(rawVehicleId, 25),
    enabled: activeSection === 'raw' && !!rawVehicleId,
  });

  React.useEffect(() => {
    if (!isAdmin && apiAccessLevel === 'admin') {
      setApiAccessLevel('view');
    }
  }, [apiAccessLevel, isAdmin]);

  const createApiKey = useMutation({
    mutationFn: () => api.createApiKey({
      vehicle_id: apiKeyVehicleId,
      name: apiKeyName,
      access_level: apiAccessLevel,
    }),
    onSuccess: (result) => {
      setCreatedKey(result.key);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeApiKey = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const updateBatteryConfig = useMutation({
    mutationFn: ({ vehicleId, kwh, config }: { vehicleId: string; kwh: number; config: string }) =>
      api.updateVehicleBatteryConfig(vehicleId, { battery_capacity_kwh: kwh, battery_config: config }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      setEditingBatteryVehicleId(null);
    },
  });

  function startEditBattery(vehicleId: string, currentKwh: number | null | undefined) {
    setEditingBatteryVehicleId(vehicleId);
    const vehicle = vehicles?.find((v) => v.id === vehicleId);
    const modelLower = vehicle?.model?.toLowerCase() ?? '';
    const isGen2 = modelLower.includes('gen 2') || modelLower.includes('2nd') || (vehicle?.year && vehicle.year >= 2025);
    const gen: BatteryGen = isGen2 ? 'gen2' : 'gen1';
    setBatteryGen(gen);

    if (currentKwh != null) {
      const match = RIVIAN_BATTERY_PRESETS[gen].find((p) => p.kwh === currentKwh);
      if (match && match.key !== 'custom') {
        setBatteryPreset(match.key);
        setCustomKwh('');
      } else {
        setBatteryPreset('custom');
        setCustomKwh(String(currentKwh));
      }
    } else {
      setBatteryPreset(gen === 'gen2' ? 'r1_large_g2' : 'r1_large_g1');
      setCustomKwh('');
    }
  }

  function handleSaveBatteryConfig(vehicleId: string) {
    const preset = RIVIAN_BATTERY_PRESETS[batteryGen].find((p) => p.key === batteryPreset) || ALL_PRESETS.find((p) => p.key === batteryPreset);
    if (!preset) return;
    const kwh = preset.key === 'custom' ? parseFloat(customKwh) : preset.kwh!;
    if (!isFinite(kwh) || kwh <= 0) return;
    const config = preset.key === 'custom' ? `Custom (${kwh} kWh)` : `${preset.label}`;
    updateBatteryConfig.mutate({ vehicleId, kwh, config });
  }

  async function handleLogout() {
    await logout();
    navigate({ to: '/login' });
  }

  async function copyCreatedKey() {
    if (createdKey) await navigator.clipboard.writeText(createdKey);
  }

  function handleUnitSystemChange(next: UnitSystem) {
    saveUnitSystem(next);
    setUnitSystemState(next);
  }

  return (
    <AppLayout activeKey="settings">
      <PageLayout title="Settings" subtitle="Account, vehicle, and API controls for local troubleshooting.">
        <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Settings sections">
            {sections.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={[
                    'flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors',
                    active
                      ? 'bg-bg-elevated text-fg shadow-sm'
                      : 'text-fg-secondary hover:bg-bg-elevated/70 hover:text-fg',
                  ].join(' ')}
                >
                  <Icon className="h-4 w-4" />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="min-w-0">
            {activeSection === 'vehicles' && (
              <Card>
                <CardHeader>
                  <CardTitle>Vehicles</CardTitle>
                  <Button variant="secondary" size="sm" iconLeft={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => navigate({ to: '/connect' })}>
                    Add Vehicle
                  </Button>
                </CardHeader>
                <CardContent>
                  {(vehicles?.length ?? 0) === 0 && (
                    <p className="text-sm text-fg-tertiary">No vehicles connected yet.</p>
                  )}
                  <div className="divide-y divide-border">
                    {vehicles?.map((v) => {
                      const isActive = defaultVehicleId === v.id || (!defaultVehicleId && vehicles[0]?.id === v.id);
                      const isEditingBattery = editingBatteryVehicleId === v.id;
                      const selectedPreset = RIVIAN_BATTERY_PRESETS[batteryGen].find((p) => p.key === batteryPreset) || ALL_PRESETS.find((p) => p.key === batteryPreset);
                      return (
                      <div key={v.id} className="py-3">
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={[
                                'flex h-12 w-24 items-center justify-center rounded-xl border bg-bg-elevated/70 p-1 transition-shadow',
                                isActive ? 'border-accent/60 shadow-[0_0_24px_rgba(56,189,248,0.22)]' : 'border-border',
                              ].join(' ')}
                              aria-label={isActive ? 'Active vehicle' : 'Vehicle'}
                            >
                              <ThemeVehicleImage
                                images={v.images}
                                placement="side"
                                className="h-full max-h-10 w-full object-contain"
                                fallback={<Car className="h-5 w-5 text-fg-secondary" />}
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-fg">{v.display_name}</p>
                              <p className="text-xs text-fg-tertiary">
                                {[v.model, v.year, v.trim].filter(Boolean).join(' / ') || 'Vehicle details pending'}
                              </p>
                            </div>
                          </div>
                          <div className="grid gap-1 text-xs text-fg-tertiary sm:justify-items-end">
                            <span>VIN: <span className="font-mono text-fg">{v.vin ?? 'Not reported'}</span></span>
                            <span>Rivian ID: <span className="font-mono text-fg">{v.rivian_vehicle_id}</span></span>
                            <span className={isActive ? 'text-accent' : 'text-fg-tertiary'}>{isActive ? 'Active vehicle' : 'Connected'}</span>
                          </div>
                        </div>

                        {/* Battery capacity configuration */}
                        <div className="mt-3 rounded-lg border border-border bg-bg-elevated/40 p-3">
                          {isEditingBattery ? (
                            <div className="grid gap-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Factory Battery Capacity</p>
                              <div className="flex flex-wrap items-end gap-2">
                                {(v.model?.includes('R1') || v.model?.includes('r1')) && (
                                  <label className="grid gap-1">
                                    <span className="text-xs text-fg-tertiary">Generation</span>
                                    <select
                                      value={batteryGen}
                                      onChange={(e) => {
                                        setBatteryGen(e.target.value as BatteryGen);
                                        setBatteryPreset(e.target.value === 'gen2' ? 'r1_large_g2' : 'r1_large_g1');
                                        setCustomKwh('');
                                      }}
                                      className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                                    >
                                      <option value="gen1">Gen 1</option>
                                      <option value="gen2">Gen 2</option>
                                    </select>
                                  </label>
                                )}
                                <label className="grid gap-1">
                                  <span className="text-xs text-fg-tertiary">Pack</span>
                                  <select
                                    value={batteryPreset}
                                    onChange={(e) => setBatteryPreset(e.target.value)}
                                    className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                                  >
                                    {(v.model?.includes('R2') || v.model?.includes('r2') ? [R2S_PRESET, { key: 'custom', label: 'Custom', kwh: null }] : RIVIAN_BATTERY_PRESETS[batteryGen]).map((p) => (
                                      <option key={p.key} value={p.key}>
                                        {p.label}{p.kwh != null ? ` (${p.kwh} kWh)` : ''}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                {batteryPreset === 'custom' && (
                                  <label className="grid gap-1">
                                    <span className="text-xs text-fg-tertiary">kWh</span>
                                    <input
                                      type="number"
                                      value={customKwh}
                                      onChange={(e) => setCustomKwh(e.target.value)}
                                      placeholder="e.g. 135"
                                      min="1"
                                      max="500"
                                      step="1"
                                      className="h-9 w-28 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                                    />
                                  </label>
                                )}
                                <Button
                                  size="sm"
                                  loading={updateBatteryConfig.isPending}
                                  disabled={batteryPreset === 'custom' && (!customKwh || isNaN(parseFloat(customKwh)))}
                                  onClick={() => handleSaveBatteryConfig(v.id)}
                                >
                                  Save
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => setEditingBatteryVehicleId(null)}>
                                  Cancel
                                </Button>
                              </div>
                              {selectedPreset && selectedPreset.key !== 'custom' && (
                                <p className="text-xs text-fg-tertiary">
                                  This value is used as the baseline for battery health % and degradation charts.
                                  Defaults can be overridden if your vehicle came with a different pack.
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Factory Battery Capacity</p>
                                <p className="mt-0.5 text-sm text-fg">
                                  {v.battery_capacity_kwh != null
                                    ? `${v.battery_capacity_kwh} kWh`
                                    : <span className="text-fg-tertiary">Not set — using max observed from telemetry</span>}
                                </p>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                iconLeft={<Pencil className="h-3.5 w-3.5" />}
                                onClick={() => startEditBattery(v.id, v.battery_capacity_kwh)}
                              >
                                {v.battery_capacity_kwh != null ? 'Edit' : 'Set'}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {activeSection === 'api' && (
              <div className="flex flex-col gap-5">
                <Card>
                  <CardHeader>
                    <CardTitle>API Access</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem_9rem_auto] md:items-end">
                      <label className="grid gap-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Name</span>
                        <input
                          value={apiKeyName}
                          onChange={(event) => setApiKeyName(event.target.value)}
                          className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Vehicle</span>
                        <select
                          value={apiKeyVehicleId}
                          onChange={(event) => setApiKeyVehicleId(event.target.value)}
                          className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                        >
                          {vehicles?.map((v) => (
                            <option key={v.id} value={v.id}>{v.display_name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1">
                        <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                          <span>Level</span>
                          {!isAdmin && (
                            <Tooltip
                              align="center"
                              content="Admin keys are reserved for users with the admin role."
                              contentClassName="w-52"
                            >
                              <span
                                tabIndex={0}
                                aria-label="Admin role information"
                                className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-fg-tertiary transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              >
                                <CircleHelp className="h-3.5 w-3.5" />
                              </span>
                            </Tooltip>
                          )}
                        </span>
                        <select
                          value={apiAccessLevel}
                          onChange={(event) => setApiAccessLevel(event.target.value as ApiAccessLevel)}
                          className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                        >
                          {accessLevels.map((level) => (
                            <option key={level.value} value={level.value} disabled={level.value === 'admin' && !isAdmin}>
                              {level.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        size="sm"
                        iconLeft={<KeyRound className="h-3.5 w-3.5" />}
                        loading={createApiKey.isPending}
                        disabled={!apiKeyVehicleId || !apiKeyName.trim()}
                        onClick={() => createApiKey.mutate()}
                      >
                        Create
                      </Button>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      {accessLevels.map((level) => (
                        <div key={level.value} className="rounded-lg border border-border bg-bg-elevated/40 p-3">
                          <div className="mb-1 flex items-center justify-between">
                            <p className="text-sm font-medium text-fg">{level.label}</p>
                            <Badge variant="default">{level.value}</Badge>
                          </div>
                          <p className="text-xs text-fg-tertiary">{level.copy}</p>
                        </div>
                      ))}
                    </div>

                    {createdKey && (
                      <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-fg">New key</p>
                          <Button variant="secondary" size="sm" iconLeft={<Clipboard className="h-3.5 w-3.5" />} onClick={copyCreatedKey}>
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
                    {(apiKeys.data?.length ?? 0) === 0 && (
                      <p className="text-sm text-fg-tertiary">No API keys issued yet.</p>
                    )}
                    <div className="divide-y divide-border">
                      {apiKeys.data?.map((key) => (
                        <div key={key.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-fg">{key.name}</p>
                              <Badge variant={key.revoked_at ? 'default' : 'success'}>{key.revoked_at ? 'revoked' : key.access_level}</Badge>
                            </div>
                            <p className="mt-1 font-mono text-xs text-fg-tertiary">{key.id}</p>
                            <p className="mt-1 text-xs text-fg-tertiary">
                              Created {new Date(key.created_at).toLocaleString()}
                              {key.last_used_at ? ` / Last used ${new Date(key.last_used_at).toLocaleString()}` : ' / Never used'}
                            </p>
                          </div>
                          {!key.revoked_at && (
                            <Button
                              variant="danger"
                              size="sm"
                              iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                              loading={revokeApiKey.isPending}
                              onClick={() => revokeApiKey.mutate(key.id)}
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
                    <CardTitle>API Catalog</CardTitle>
                    <Badge variant="default">{apiCatalog.data?.endpoints.length ?? 0} routes</Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[42rem] text-left text-sm">
                        <thead className="text-xs uppercase tracking-wide text-fg-tertiary">
                          <tr className="border-b border-border">
                            <th className="py-2 pr-3 font-medium">Method</th>
                            <th className="py-2 pr-3 font-medium">Path</th>
                            <th className="py-2 pr-3 font-medium">Access</th>
                            <th className="py-2 font-medium">Purpose</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {apiCatalog.data?.endpoints.map((endpoint) => (
                            <tr key={`${endpoint.method}-${endpoint.path}`}>
                              <td className="py-2 pr-3 font-mono text-xs text-fg">{endpoint.method}</td>
                              <td className="py-2 pr-3 font-mono text-xs text-fg">{endpoint.path}</td>
                              <td className="py-2 pr-3"><Badge variant="default">{endpoint.minimum_access}</Badge></td>
                              <td className="py-2 text-xs text-fg-tertiary">{endpoint.purpose}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-bg-elevated/50 p-3 text-xs text-fg-tertiary">
                      <Database className="h-4 w-4 shrink-0" />
                      <span>Use <span className="font-mono text-fg">GET /v1/api/catalog</span> for the user catalog and <span className="font-mono text-fg">GET /v1/admin/api/catalog</span> for admin routes.</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeSection === 'units' && (
              <Card>
                <CardHeader>
                  <CardTitle>Units</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <p className="text-sm text-fg-tertiary">
                    Pick the measurement system used across range, speed, temperature, pressure, and place radius displays.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      {
                        value: 'imperial' as const,
                        title: 'Imperial',
                        copy: 'Miles, mph, Fahrenheit, psi, and feet. This is the default.',
                      },
                      {
                        value: 'metric' as const,
                        title: 'Metric',
                        copy: 'Kilometers, km/h, Celsius, kPa, and meters.',
                      },
                    ].map((option) => {
                      const active = unitSystem === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleUnitSystemChange(option.value)}
                          className={[
                            'rounded-xl border p-4 text-left transition-colors',
                            active
                              ? 'border-accent bg-accent/10 shadow-sm'
                              : 'border-border bg-bg-elevated/40 hover:border-accent/60 hover:bg-bg-elevated/70',
                          ].join(' ')}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-fg">{option.title}</p>
                              <p className="mt-1 text-xs text-fg-tertiary">{option.copy}</p>
                            </div>
                            <Badge variant={active ? 'success' : 'default'}>
                              {active ? 'Selected' : 'Set'}
                            </Badge>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {activeSection === 'places' && <PlacesSection unitSystem={unitSystem} />}

            {activeSection === 'raw' && (
              <div className="flex flex-col gap-5">
                {/* Vehicle Stats */}
                <Card>
                  <CardHeader>
                    <CardTitle>Vehicle Stats</CardTitle>
                    <div className="flex items-center gap-2">
                      <select
                        value={rawVehicleId}
                        onChange={(event) => setRawVehicleId(event.target.value)}
                        className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                      >
                        {vehicles?.map((v) => (
                          <option key={v.id} value={v.id}>{v.display_name}</option>
                        ))}
                      </select>
                      <Button variant="secondary" size="sm" loading={rawTelemetry.isFetching} onClick={() => rawTelemetry.refetch()}>
                        Refresh
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      {[
                        ['Total Samples', rawTelemetry.data?.coverage.sample_count],
                        ['Odometer', rawTelemetry.data?.coverage.odometer_samples],
                        ['Battery', rawTelemetry.data?.coverage.battery_samples],
                        ['Power', rawTelemetry.data?.coverage.power_samples],
                        ['Range', rawTelemetry.data?.coverage.range_samples],
                        ['Outside Temp', rawTelemetry.data?.coverage.outside_temp_samples],
                        ['Regen', rawTelemetry.data?.coverage.regen_samples],
                        ['Tire Pressure', rawTelemetry.data?.coverage.tire_pressure_samples],
                        ['Locks', rawTelemetry.data?.coverage.lock_samples],
                        ['Software', rawTelemetry.data?.coverage.software_samples],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-lg border border-border bg-bg-elevated/40 p-3">
                          <p className="text-xs uppercase tracking-wide text-fg-tertiary">{label}</p>
                          <p className="mt-1 text-lg font-semibold text-fg">{value ?? 0}</p>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-border bg-bg-elevated/40 p-3 text-xs text-fg-tertiary">
                      <p>First event: <span className="font-mono text-fg">{rawTelemetry.data?.coverage.first_event_at ?? 'none'}</span></p>
                      <p className="mt-1">Latest event: <span className="font-mono text-fg">{rawTelemetry.data?.coverage.last_event_at ?? 'none'}</span></p>
                    </div>
                  </CardContent>
                </Card>

                {/* DB Stats */}
                <Card>
                  <CardHeader>
                    <CardTitle>DB Stats</CardTitle>
                    <Button variant="secondary" size="sm" loading={stewardship.isFetching} disabled={!isAdmin} onClick={() => stewardship.refetch()}>
                      Refresh
                    </Button>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    {!isAdmin ? (
                      <div className="rounded-lg border border-border bg-bg-elevated/40 p-3 text-sm text-fg-tertiary">
                        Admin access is required.
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-3 md:grid-cols-4">
                          {[
                            ['Active collectors', stewardship.data?.active_collectors],
                            ['Reconnects', stewardship.data?.totals_24h.ws_reconnects],
                            ['Outbound messages', stewardship.data?.totals_24h.outbound_messages_sent],
                            ['Heartbeats ignored', stewardship.data?.totals_24h.ws_heartbeats_received],
                            ['Payload messages', stewardship.data?.totals_24h.ws_payload_messages_received],
                            ['Writes persisted', stewardship.data?.totals_24h.telemetry_writes_persisted],
                            ['Writes suppressed', stewardship.data?.totals_24h.telemetry_writes_suppressed],
                            ['Suppression rate', formatSuppressionRate(
                              stewardship.data?.totals_24h.telemetry_writes_suppressed,
                              stewardship.data?.totals_24h.telemetry_writes_persisted,
                            )],
                            ['Duplicate suppressions', stewardship.data?.totals_24h.telemetry_suppressed_duplicate],
                            ['Collector lock skips', stewardship.data?.totals_24h.collector_lock_skips],
                            ['Raw retained', stewardship.data?.raw_events_retained],
                            ['Retention days', stewardship.data?.retention_days],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded-lg border border-border bg-bg-elevated/40 p-3">
                              <p className="text-xs uppercase tracking-wide text-fg-tertiary">{label}</p>
                              <p className="mt-1 text-lg font-semibold text-fg">
                                {typeof value === 'string' ? value : formatCount(value as number | undefined)}
                              </p>
                            </div>
                          ))}
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <table className="w-full min-w-[54rem] text-left text-xs">
                            <thead className="bg-bg-elevated text-fg-tertiary">
                              <tr>
                                {['Vehicle', 'Health', 'Last seen', 'Messages', 'Heartbeats', 'Persisted', 'Suppressed', 'Reconnects'].map((heading) => (
                                  <th key={heading} className="px-3 py-2 font-medium">{heading}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {stewardship.data?.vehicles.map((vehicle) => (
                                <tr key={vehicle.vehicle_id}>
                                  <td className="px-3 py-2 text-fg">{vehicle.display_name}</td>
                                  <td className="px-3 py-2">{vehicle.worker_health ?? '-'}</td>
                                  <td className="px-3 py-2 font-mono">{vehicle.last_seen_at ? new Date(vehicle.last_seen_at).toLocaleString() : '-'}</td>
                                  <td className="px-3 py-2">{formatCount(vehicle.ws_messages_received)}</td>
                                  <td className="px-3 py-2">{formatCount(vehicle.ws_heartbeats_received)}</td>
                                  <td className="px-3 py-2">{formatCount(vehicle.telemetry_writes_persisted)}</td>
                                  <td className="px-3 py-2">{formatCount(vehicle.telemetry_writes_suppressed)}</td>
                                  <td className="px-3 py-2">{formatCount(vehicle.ws_reconnects)}</td>
                                </tr>
                              ))}
                              {(stewardship.data?.vehicles.length ?? 0) === 0 && (
                                <tr>
                                  <td colSpan={8} className="px-3 py-6 text-center text-fg-tertiary">No vehicle stewardship records yet.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Telemetry Records with table / raw JSON toggle */}
                <Card>
                  <CardHeader>
                    <CardTitle>Telemetry Records</CardTitle>
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-elevated p-0.5">
                      {(['table', 'json'] as const).map((view) => (
                        <button
                          key={view}
                          type="button"
                          onClick={() => setRawTableView(view)}
                          className={[
                            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                            rawTableView === view
                              ? 'bg-bg text-fg shadow-sm'
                              : 'text-fg-secondary hover:text-fg',
                          ].join(' ')}
                        >
                          {view === 'table' ? 'Table' : 'Raw JSON'}
                        </button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {rawTableView === 'table' ? (
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[64rem] text-left text-xs">
                          <thead className="bg-bg-elevated text-fg-tertiary">
                            <tr>
                              {['Time', 'Odometer', 'SOC', 'Range', 'Power', 'Regen', 'State', 'Charger', 'Temp', 'Tires'].map((heading) => (
                                <th key={heading} className="px-3 py-2 font-medium">{heading}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {rawTelemetry.data?.samples.map((sample) => (
                              <tr key={sample.ts}>
                                <td className="px-3 py-2 font-mono text-fg">{new Date(sample.ts).toLocaleString()}</td>
                                <td className="px-3 py-2">{sample.odometer_miles === null || sample.odometer_miles === undefined ? '-' : formatMiles(sample.odometer_miles)}</td>
                                <td className="px-3 py-2">{formatRawNumber(sample.battery_level, '%')}</td>
                                <td className="px-3 py-2">{formatRawNumber(sample.distance_to_empty_mi, ' mi')}</td>
                                <td className="px-3 py-2">{formatRawNumber(sample.power_kw, ' kW')}</td>
                                <td className="px-3 py-2">{formatRawNumber(sample.regen_power_kw, ' kW')}</td>
                                <td className="px-3 py-2">{sample.power_state ?? '-'}</td>
                                <td className="px-3 py-2">{sample.charger_state ?? '-'}</td>
                                <td className="px-3 py-2">{sample.outside_temp_c === null || sample.outside_temp_c === undefined ? '-' : formatTemp(sample.outside_temp_c)}</td>
                                <td className="px-3 py-2">
                                  {[sample.tire_fl_psi, sample.tire_fr_psi, sample.tire_rl_psi, sample.tire_rr_psi]
                                    .map((psi) => psi === null || psi === undefined ? '-' : formatPressure(psi))
                                    .join(' / ')}
                                </td>
                              </tr>
                            ))}
                            {(rawTelemetry.data?.samples.length ?? 0) === 0 && (
                              <tr>
                                <td colSpan={10} className="px-3 py-6 text-center text-fg-tertiary">No telemetry samples stored yet.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-border bg-bg-elevated/40">
                        <pre className="p-4 text-xs text-fg font-mono leading-relaxed whitespace-pre-wrap break-all">
                          {rawTelemetry.data?.samples && rawTelemetry.data.samples.length > 0
                            ? JSON.stringify(rawTelemetry.data.samples, null, 2)
                            : 'No samples.'}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}



            {activeSection === 'appearance' && (
              <Card>
                <CardHeader>
                  <CardTitle>Appearance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-fg">Theme</p>
                      <p className="mt-0.5 text-xs text-fg-tertiary">Toggle between dark and light mode</p>
                    </div>
                    <ThemeToggle />
                  </div>
                </CardContent>
              </Card>
            )}

            {activeSection === 'account' && (
              <Card>
                <CardHeader>
                  <CardTitle>Account</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button variant="danger" size="sm" iconLeft={<LogOut className="h-3.5 w-3.5" />}
                    onClick={handleLogout}>
                    Sign Out
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </PageLayout>
    </AppLayout>
  );
}
