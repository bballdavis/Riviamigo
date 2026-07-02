import React from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rootRoute } from './__root';
import { api, useAuth, useAuthReady, useMe, useVehicles } from '@riviamigo/hooks';
import type { ApiAccessLevel, UnitPreferences, VehicleImages, VehicleMember } from '@riviamigo/types';
import {
  downloadDashboardYaml,
  useCloneDashboard,
  useDashboards,
  useDeleteDashboard,
  useRestoreAdminDashboardDefault,
  useSetAdminDashboardLock,
} from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';
import {
  formatMiles,
  formatPressure,
  formatTemp,
  getUnitPreferences,
  setUnitPreferences,
  type UnitMode,
  type UnitSystem,
} from '@riviamigo/ui/lib/utils';
import { DEFAULT_TARGET_TIRE_PRESSURE_PSI } from '@riviamigo/ui/lib/vehicleTires';
import {
  PageLayout, Card, CardHeader, CardTitle, CardContent,
  Button, Badge, ThemeToggle, Tooltip,
} from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { BackupSection } from '../components/settings/BackupSection';
import { JobsSection } from '../components/settings/JobsSection';
import { PlacesSection } from '../components/settings/PlacesSection';
import { canManageSystemDashboards } from '../components/dashboard/DashboardPage';
import {
  Car, CircleHelp, Clipboard, Database, DatabaseBackup, Download, ExternalLink, KeyRound, ListChecks, Lock, LogOut, MapPin, Pencil, Plus, RefreshCw, RotateCcw, Ruler, Save, ShieldCheck, Star, Trash2, Unlock, Users, X,
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

type SettingsSection = 'vehicles' | 'dashboards' | 'units' | 'places' | 'api' | 'jobs' | 'raw' | 'backup' | 'appearance' | 'account';

const baseSections: Array<{ id: SettingsSection; label: string; icon: React.ElementType }> = [
  { id: 'vehicles', label: 'Vehicles', icon: Car },
  { id: 'dashboards', label: 'Dashboards', icon: Clipboard },
  { id: 'units', label: 'Units', icon: Ruler },
  { id: 'places', label: 'Places', icon: MapPin },
  { id: 'api', label: 'API Access', icon: KeyRound },
  { id: 'jobs', label: 'Jobs', icon: ListChecks },
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

const IMPERIAL_UNITS: UnitPreferences = {
  mode: 'imperial',
  distance_unit: 'miles',
  speed_unit: 'mph',
  temperature_unit: 'fahrenheit',
  pressure_unit: 'psi',
  altitude_unit: 'feet',
  place_radius_unit: 'feet',
  efficiency_display: 'distance_per_energy',
};

const METRIC_UNITS: UnitPreferences = {
  mode: 'metric',
  distance_unit: 'kilometers',
  speed_unit: 'kmh',
  temperature_unit: 'celsius',
  pressure_unit: 'kpa',
  altitude_unit: 'meters',
  place_radius_unit: 'meters',
  efficiency_display: 'distance_per_energy',
};

function unitSystemFromPrefs(prefs: UnitPreferences): UnitSystem {
  return prefs.distance_unit === 'kilometers' ? 'metric' : 'imperial';
}

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

function formatMembershipRole(role: VehicleMember['role'] | undefined) {
  if (role === 'owner') return 'Owner';
  if (role === 'manager') return 'Manager';
  return 'Viewer';
}

function membershipBadgeVariant(role: VehicleMember['role'] | undefined): 'success' | 'warning' | 'default' {
  if (role === 'owner') return 'success';
  if (role === 'manager') return 'warning';
  return 'default';
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

function DashboardSettingsSection({
  dashboards,
  isLoading,
  canManageDefaults,
  cloneDashboard,
  deleteDashboard,
  setDashboardLock,
  restoreDefaultDashboard,
  onEdit,
}: {
  dashboards: DashboardConfig[];
  isLoading: boolean;
  canManageDefaults: boolean;
  cloneDashboard: ReturnType<typeof useCloneDashboard>;
  deleteDashboard: ReturnType<typeof useDeleteDashboard>;
  setDashboardLock: ReturnType<typeof useSetAdminDashboardLock>;
  restoreDefaultDashboard: ReturnType<typeof useRestoreAdminDashboardDefault>;
  onEdit: (dashboard: DashboardConfig, edit: boolean) => void;
}) {
  const defaults = dashboards.filter((dashboard) => dashboard.isDefault);
  const userDashboards = dashboards.filter((dashboard) => !dashboard.isDefault);

  async function duplicate(dashboard: DashboardConfig) {
    const cloned = await cloneDashboard.mutateAsync(dashboard.id);
    onEdit(cloned, true);
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Dashboards</CardTitle>
          <Badge variant="info">{dashboards.length} saved</Badge>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="rounded-xl border border-border bg-bg-elevated/35 p-3 text-sm text-fg-secondary">
            Dashboard edits are saved in the database, so backup and restore carries them with the rest of Riviamigo. Use user copies for personal changes; system defaults are admin-managed.
          </div>
          {isLoading ? (
            <div className="rounded-xl border border-border bg-bg-elevated/35 p-4 text-sm text-fg-tertiary">
              Loading dashboards...
            </div>
          ) : (
            <>
              <DashboardSettingsList
                title="System Defaults"
                dashboards={defaults}
                canManageDefaults={canManageDefaults}
                cloneDashboard={cloneDashboard}
                deleteDashboard={deleteDashboard}
                setDashboardLock={setDashboardLock}
                restoreDefaultDashboard={restoreDefaultDashboard}
                onDuplicate={duplicate}
                onEdit={onEdit}
              />
              <DashboardSettingsList
                title="My Dashboards"
                dashboards={userDashboards}
                canManageDefaults={canManageDefaults}
                cloneDashboard={cloneDashboard}
                deleteDashboard={deleteDashboard}
                setDashboardLock={setDashboardLock}
                restoreDefaultDashboard={restoreDefaultDashboard}
                onDuplicate={duplicate}
                onEdit={onEdit}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardSettingsList({
  title,
  dashboards,
  canManageDefaults,
  cloneDashboard,
  deleteDashboard,
  setDashboardLock,
  restoreDefaultDashboard,
  onDuplicate,
  onEdit,
}: {
  title: string;
  dashboards: DashboardConfig[];
  canManageDefaults: boolean;
  cloneDashboard: ReturnType<typeof useCloneDashboard>;
  deleteDashboard: ReturnType<typeof useDeleteDashboard>;
  setDashboardLock: ReturnType<typeof useSetAdminDashboardLock>;
  restoreDefaultDashboard: ReturnType<typeof useRestoreAdminDashboardDefault>;
  onDuplicate: (dashboard: DashboardConfig) => void;
  onEdit: (dashboard: DashboardConfig, edit: boolean) => void;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-fg-tertiary">{title}</h3>
        <span className="text-xs text-fg-tertiary">{dashboards.length}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        {dashboards.length === 0 ? (
          <div className="p-4 text-sm text-fg-tertiary">No dashboards here yet.</div>
        ) : (
          dashboards.map((dashboard) => {
            const isUserOwned = dashboard.ownerId != null;
            const canEdit = isUserOwned || (dashboard.isDefault && canManageDefaults);
            return (
              <div
                key={dashboard.id}
                className="grid gap-3 border-b border-border bg-bg last:border-0 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-fg">{dashboard.name}</p>
                    <Badge variant={dashboard.isDefault ? 'info' : 'default'} size="sm">
                      {dashboard.isDefault ? 'Default' : 'User'}
                    </Badge>
                    {dashboard.isLocked ? <Badge variant="warning" size="sm">Locked</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-fg-tertiary">
                    {dashboard.slug} &middot; {dashboard.widgets.length} widgets
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<ExternalLink className="h-3.5 w-3.5" />}
                    onClick={() => onEdit(dashboard, false)}
                  >
                    Open
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<Pencil className="h-3.5 w-3.5" />}
                    disabled={!canEdit}
                    onClick={() => onEdit(dashboard, true)}
                    title={canEdit ? 'Edit dashboard' : 'Duplicate this locked default before editing'}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={cloneDashboard.isPending && cloneDashboard.variables === dashboard.id}
                    onClick={() => { void onDuplicate(dashboard); }}
                  >
                    Duplicate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft={<Download className="h-3.5 w-3.5" />}
                    onClick={() => downloadDashboardYaml(dashboard)}
                  >
                    Export
                  </Button>
                  {dashboard.isDefault && canManageDefaults ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        iconLeft={dashboard.isLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                        loading={setDashboardLock.isPending && setDashboardLock.variables?.id === dashboard.id}
                        onClick={() => setDashboardLock.mutate({ id: dashboard.id, locked: !dashboard.isLocked })}
                      >
                        {dashboard.isLocked ? 'Unlock' : 'Lock'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
                        loading={restoreDefaultDashboard.isPending && restoreDefaultDashboard.variables === dashboard.id}
                        onClick={() => {
                          if (window.confirm(`Restore "${dashboard.name}" to the bundled default layout?`)) {
                            restoreDefaultDashboard.mutate(dashboard.id);
                          }
                        }}
                      >
                        Restore
                      </Button>
                    </>
                  ) : null}
                  {isUserOwned ? (
                    <Button
                      variant="danger"
                      size="sm"
                      iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                      loading={deleteDashboard.isPending && deleteDashboard.variables === dashboard.id}
                      onClick={() => {
                        if (window.confirm(`Reset "${dashboard.name}"? This removes your saved dashboard copy.`)) {
                          deleteDashboard.mutate(dashboard.id);
                        }
                      }}
                    >
                      Reset
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function SettingsPage() {
  return <ProtectedRoute><SettingsContent /></ProtectedRoute>;
}

export function SettingsContent() {
  const { accessToken, logout, defaultVehicleId, setDefaultVehicleId, setActiveVehicleId } = useAuth();
  const authReady = useAuthReady();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: vehicles } = useVehicles();
  const me = useMe();
  const [activeSection, setActiveSection] = React.useState<SettingsSection>('vehicles');
  const [apiKeyName, setApiKeyName] = React.useState('Local troubleshooting');
  const [apiKeyVehicleId, setApiKeyVehicleId] = React.useState('');
  const [apiAccessLevel, setApiAccessLevel] = React.useState<ApiAccessLevel>('view');
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);
  const [rawVehicleId, setRawVehicleId] = React.useState('');
  const [unitPreferences, setUnitPreferencesState] = React.useState<UnitPreferences>(() => getUnitPreferences());
  const unitSystem = unitSystemFromPrefs(unitPreferences);
  const placesUnitSystem: UnitSystem = unitPreferences.place_radius_unit === 'meters' ? 'metric' : 'imperial';
  const [rawTableView, setRawTableView] = React.useState<'table' | 'json'>('table');
  const [editingBatteryVehicleId, setEditingBatteryVehicleId] = React.useState<string | null>(null);
  const [batteryGen, setBatteryGen] = React.useState<BatteryGen>('gen1');
  const [batteryPreset, setBatteryPreset] = React.useState('r1_large_g1');
  const [customKwh, setCustomKwh] = React.useState('');
  const [editTargetTirePressure, setEditTargetTirePressure] = React.useState(String(DEFAULT_TARGET_TIRE_PRESSURE_PSI));
  const [editNameValue, setEditNameValue] = React.useState('');
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = React.useState('');
  const [sharingVehicleId, setSharingVehicleId] = React.useState<string | null>(null);
  const [shareEmail, setShareEmail] = React.useState('');
  const [shareRole, setShareRole] = React.useState<VehicleMember['role']>('viewer');
  const [latestInviteToken, setLatestInviteToken] = React.useState<string | null>(null);
  const [demoPickerOpen, setDemoPickerOpen] = React.useState(false);
  const canCreateDemoVehicle = me.data?.role === 'admin' || me.data?.role === 'super_user';
  const isAdmin = canManageSystemDashboards(me.data?.role);
  const canManageBackups = me.data?.role === 'admin' || me.data?.role === 'super_user';
  const sections = React.useMemo(
    () => canManageBackups
      ? [...baseSections.slice(0, 5), { id: 'backup' as const, label: 'Backups', icon: DatabaseBackup }, ...baseSections.slice(5)]
      : baseSections,
    [canManageBackups],
  );

  const apiKeys = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.listApiKeys(),
    enabled: authReady && activeSection === 'api' && !!accessToken,
  });

  const apiCatalog = useQuery({
    queryKey: ['api-catalog'],
    queryFn: () => api.getApiCatalog(),
    enabled: authReady && activeSection === 'api' && !!accessToken,
  });

  const stewardship = useQuery({
    queryKey: ['rivian-stewardship'],
    queryFn: () => api.getRivianStewardship(),
    enabled: authReady && activeSection === 'raw' && isAdmin && !!accessToken,
  });

  const dashboards = useDashboards();
  const cloneDashboard = useCloneDashboard();
  const deleteDashboard = useDeleteDashboard();
  const setDashboardLock = useSetAdminDashboardLock();
  const restoreDefaultDashboard = useRestoreAdminDashboardDefault();

  const unitPreferencesQuery = useQuery({
    queryKey: ['unit-preferences'],
    queryFn: () => api.getUnitPreferences(),
    enabled: authReady && !!accessToken,
  });

  React.useEffect(() => {
    const next = unitPreferencesQuery.data?.units;
    if (!next) return;
    setUnitPreferencesState(next);
    setUnitPreferences(next);
  }, [unitPreferencesQuery.data]);

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
    enabled: authReady && activeSection === 'raw' && !!rawVehicleId && !!accessToken,
  });

  React.useEffect(() => {
    if (!isAdmin && apiAccessLevel === 'admin') {
      setApiAccessLevel('view');
    }
  }, [apiAccessLevel, isAdmin]);

  const vehicleMembers = useQuery({
    queryKey: ['vehicle-members', sharingVehicleId],
    queryFn: () => api.listVehicleMembers(sharingVehicleId!),
    enabled: authReady && activeSection === 'vehicles' && !!sharingVehicleId && !!accessToken,
  });
  const vehicleInvites = useQuery({
    queryKey: ['vehicle-invites', sharingVehicleId],
    queryFn: () => api.listVehicleInvites(sharingVehicleId!),
    enabled: authReady && activeSection === 'vehicles' && !!sharingVehicleId && !!accessToken,
  });

  React.useEffect(() => {
    if (!sharingVehicleId) return;
    if (!(vehicles ?? []).some((vehicle) => vehicle.id === sharingVehicleId)) {
      setSharingVehicleId(null);
    }
  }, [sharingVehicleId, vehicles]);

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

  const updateVehicleSettings = useMutation({
    mutationFn: ({ vehicleId, kwh, config, targetTirePressurePsi }: { vehicleId: string; kwh: number; config: string; targetTirePressurePsi: number }) =>
      api.updateVehicleSettings(vehicleId, {
        battery_capacity_kwh: kwh,
        battery_config: config,
        target_tire_pressure_psi: targetTirePressurePsi,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const updateVehicleName = useMutation({
    mutationFn: ({ vehicleId, name }: { vehicleId: string; name: string }) =>
      api.updateVehicleName(vehicleId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const deleteVehicle = useMutation({
    mutationFn: (vehicleId: string) => api.deleteVehicle(vehicleId),
    onSuccess: (result) => {
      setDefaultVehicleId(result.default_vehicle_id ?? null);
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const setDefaultVehicle = useMutation({
    mutationFn: (vehicleId: string) => api.setDefaultVehicle(vehicleId),
    onSuccess: (result) => {
      setDefaultVehicleId(result.default_vehicle_id);
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const addVehicleMember = useMutation({
    mutationFn: ({ vehicleId, email, role }: { vehicleId: string; email: string; role: VehicleMember['role'] }) =>
      api.addVehicleMember(vehicleId, { email, role }),
    onSuccess: (result, variables) => {
      setShareEmail('');
      setShareRole('viewer');
      setLatestInviteToken(result.invite_created ? (result.invite_token ?? null) : null);
      queryClient.invalidateQueries({ queryKey: ['vehicle-members', variables.vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicle-invites', variables.vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const createDemoVehicle = useMutation({
    mutationFn: (model: 'R1T' | 'R1S' | 'R2S') => api.createDemoVehicle({ model }),
    onSuccess: (result) => {
      setActiveVehicleId(result.vehicle_id);
      setDemoPickerOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles', 'status', result.vehicle_id] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles', 'health', result.vehicle_id] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles', 'images', result.vehicle_id] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const updateVehicleMember = useMutation({
    mutationFn: ({ vehicleId, userId, role }: { vehicleId: string; userId: string; role: VehicleMember['role'] }) =>
      api.updateVehicleMember(vehicleId, userId, { role }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-members', variables.vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });

  const removeVehicleMember = useMutation({
    mutationFn: ({ vehicleId, userId }: { vehicleId: string; userId: string }) =>
      api.removeVehicleMember(vehicleId, userId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-members', variables.vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const revokeVehicleInvite = useMutation({
    mutationFn: ({ vehicleId, inviteId }: { vehicleId: string; inviteId: string }) =>
      api.revokeVehicleInvite(vehicleId, inviteId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-invites', variables.vehicleId] });
    },
  });

  const updateUnitPreferences = useMutation({
    mutationFn: (units: UnitPreferences) => api.updateUnitPreferences(units),
    onSuccess: (result) => {
      setUnitPreferencesState(result.units);
      setUnitPreferences(result.units);
      queryClient.invalidateQueries({ queryKey: ['unit-preferences'] });
    },
  });

  function startEditVehicle(vehicleId: string, currentKwh: number | null | undefined) {
    setEditingBatteryVehicleId(vehicleId);
    const vehicle = vehicles?.find((v) => v.id === vehicleId);
    setEditNameValue(vehicle?.display_name ?? '');
    setEditTargetTirePressure(String(vehicle?.target_tire_pressure_psi ?? DEFAULT_TARGET_TIRE_PRESSURE_PSI));

    if (currentKwh != null) {
      // Search all gens so a Gen 2 pack saved while gen was auto-detected as Gen 1 still resolves correctly
      for (const g of ['gen1', 'gen2'] as BatteryGen[]) {
        const match = RIVIAN_BATTERY_PRESETS[g].find((p) => p.kwh === currentKwh && p.key !== 'custom');
        if (match) {
          setBatteryGen(g);
          setBatteryPreset(match.key);
          setCustomKwh('');
          return;
        }
      }
      if (R2S_PRESET.kwh === currentKwh) {
        setBatteryPreset(R2S_PRESET.key);
        setCustomKwh('');
        return;
      }
      setBatteryPreset('custom');
      setCustomKwh(String(currentKwh));
    } else {
      const modelLower = vehicle?.model?.toLowerCase() ?? '';
      const isGen2 = modelLower.includes('gen 2') || modelLower.includes('2nd') || (vehicle?.year && vehicle.year >= 2025);
      const gen: BatteryGen = isGen2 ? 'gen2' : 'gen1';
      setBatteryGen(gen);
      setBatteryPreset(gen === 'gen2' ? 'r1_large_g2' : 'r1_large_g1');
      setCustomKwh('');
    }
  }

  async function handleSaveVehicle(vehicleId: string) {
    const vehicle = vehicles?.find((v) => v.id === vehicleId);
    const trimmedName = editNameValue.trim();
    const preset = RIVIAN_BATTERY_PRESETS[batteryGen].find((p) => p.key === batteryPreset) || ALL_PRESETS.find((p) => p.key === batteryPreset);
    if (!preset) return;
    const kwh = preset.key === 'custom' ? parseFloat(customKwh) : preset.kwh!;
    if (!isFinite(kwh) || kwh <= 0) return;
    const targetTirePressurePsi = parseFloat(editTargetTirePressure);
    if (!isFinite(targetTirePressurePsi) || targetTirePressurePsi < 20 || targetTirePressurePsi > 80) return;
    const config = preset.key === 'custom' ? `Custom (${kwh} kWh)` : preset.label;
    const saves: Promise<unknown>[] = [
      updateVehicleSettings.mutateAsync({ vehicleId, kwh, config, targetTirePressurePsi }),
    ];
    if (trimmedName && trimmedName !== vehicle?.display_name) {
      saves.push(updateVehicleName.mutateAsync({ vehicleId, name: trimmedName }));
    }
    await Promise.all(saves);
    setEditingBatteryVehicleId(null);
  }

  async function handleLogout() {
    await logout();
    navigate({ to: '/login' });
  }

  async function copyCreatedKey() {
    if (createdKey) await navigator.clipboard.writeText(createdKey);
  }

  function handleUnitModeChange(nextMode: UnitMode) {
    const next =
      nextMode === 'imperial'
        ? { ...IMPERIAL_UNITS }
        : nextMode === 'metric'
          ? { ...METRIC_UNITS }
          : { ...unitPreferences, mode: 'custom' as const };
    setUnitPreferencesState(next);
    setUnitPreferences(next);
    updateUnitPreferences.mutate(next);
  }

  function handleCustomUnitChange<K extends keyof UnitPreferences>(key: K, value: UnitPreferences[K]) {
    const next: UnitPreferences = { ...unitPreferences, mode: 'custom', [key]: value };
    setUnitPreferencesState(next);
    setUnitPreferences(next);
    updateUnitPreferences.mutate(next);
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
                  <div className="flex items-center gap-2">
                    {canCreateDemoVehicle && (
                      <div className="relative">
                        <Button
                          variant="secondary"
                          size="sm"
                          iconLeft={<Plus className="h-3.5 w-3.5" />}
                          loading={createDemoVehicle.isPending}
                          onClick={() => setDemoPickerOpen((current) => !current)}
                        >
                          Demo Vehicle
                        </Button>
                        {demoPickerOpen && (
                          <div className="absolute right-0 top-full z-20 mt-2 w-40 rounded-lg border border-border bg-bg-surface p-1 shadow-lg">
                            {(['R1T', 'R1S', 'R2S'] as const).map((model) => (
                              <button
                                key={model}
                                type="button"
                                className="w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-bg-elevated hover:text-fg"
                                onClick={() => createDemoVehicle.mutate(model)}
                              >
                                {model}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <Button variant="secondary" size="sm" iconLeft={<Plus className="h-3.5 w-3.5" />}
                      onClick={() => navigate({ to: '/connect' })}>
                      Vehicle
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {(vehicles?.length ?? 0) === 0 && (
                    <p className="text-sm text-fg-tertiary">No vehicles connected yet.</p>
                  )}
                  {/* Delete confirmation dialog */}
                  {deleteConfirmId && (() => {
                    const dv = vehicles?.find((v) => v.id === deleteConfirmId);
                    return (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-page/80 backdrop-blur-sm">
                        <div className="w-full max-w-sm rounded-xl border border-border bg-bg-surface p-5 shadow-lg">
                          <h3 className="text-sm font-semibold text-fg">Delete {dv?.display_name}?</h3>
                          <p className="mt-2 text-xs text-fg-tertiary">
                            This permanently removes all local telemetry, trips, and charging history for this vehicle.
                            Type <strong className="font-semibold text-fg">DELETE</strong> below to confirm.
                          </p>
                          <input
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            placeholder="DELETE"
                            autoFocus
                            className="mt-3 h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                          />
                          <div className="mt-3 flex justify-end gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => { setDeleteConfirmId(null); setDeleteConfirmText(''); }}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={deleteConfirmText !== 'DELETE'}
                              loading={deleteVehicle.isPending}
                              onClick={() => {
                                deleteVehicle.mutate(deleteConfirmId);
                                setDeleteConfirmId(null);
                                setDeleteConfirmText('');
                              }}
                            >
                              Delete Vehicle
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="divide-y divide-border">
                    {vehicles?.map((v) => {
                      const isActive = defaultVehicleId === v.id || (!defaultVehicleId && vehicles[0]?.id === v.id);
                      const isEditingBattery = editingBatteryVehicleId === v.id;
                      const isSharingExpanded = sharingVehicleId === v.id;
                      const membershipRole = v.membership_role ?? 'viewer';
                      const canManageVehicle = membershipRole === 'owner' || membershipRole === 'manager';
                      const canManageMembers = membershipRole === 'owner';

                      const needsReauth = v.auth_state === 'needs_reauth';
                      const collectorHealthy = v.worker_health === 'ok' || v.worker_health === 'connected';
                      const collectorPassive = v.worker_health === 'passive';
                      const selectedPreset = RIVIAN_BATTERY_PRESETS[batteryGen].find((p) => p.key === batteryPreset) || ALL_PRESETS.find((p) => p.key === batteryPreset);

                      const healthColor = needsReauth
                        ? 'var(--rm-status-warning)'
                        : collectorHealthy
                          ? 'var(--rm-status-positive)'
                          : collectorPassive
                            ? 'var(--rm-border-default)'
                          : v.worker_health != null
                            ? 'var(--rm-status-danger)'
                            : 'var(--rm-border-default)';
                      const healthText = needsReauth
                        ? 'Login required'
                        : collectorHealthy
                          ? (isActive ? 'Active' : 'Connected')
                          : collectorPassive
                            ? 'Standby'
                          : v.worker_health != null
                            ? 'Error'
                            : (isActive ? 'Active' : 'Offline');
                      const hasGlow = needsReauth || v.worker_health != null;

                      const modelLine = [v.model, v.year, v.trim].filter(Boolean).join(' · ') || 'Vehicle details pending';
                      const batteryLabel = v.battery_capacity_kwh != null ? ` · ${v.battery_capacity_kwh} kWh` : '';

                      return (
                      <div key={v.id} className="py-2">
                        <div className="rounded-lg border border-border bg-bg-elevated/35 p-3">
                          <div className="flex gap-3">
                            {/* Status chip */}
                            <div
                              className="flex w-40 shrink-0 flex-col items-center gap-1 rounded-xl border bg-bg-elevated/70 px-1.5 py-2 transition-shadow"
                              style={{
                                borderColor: healthColor,
                                boxShadow: hasGlow
                                  ? `0 0 18px color-mix(in oklab, ${healthColor} 35%, transparent)`
                                  : 'none',
                              }}
                            >
                              <ThemeVehicleImage
                                images={v.images}
                                placement="side"
                                className="w-full object-contain"
                                fallback={<Car className="h-6 w-6 text-fg-secondary" />}
                              />
                              <span className="text-[10px] font-medium leading-none" style={{ color: healthColor }}>
                                {healthText}
                              </span>
                            </div>

                            {/* Name + model */}
                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                <p className="text-lg font-medium text-fg">{v.display_name}</p>
                                <Badge variant={membershipBadgeVariant(membershipRole)} size="sm">
                                  {formatMembershipRole(membershipRole)}
                                </Badge>
                                {isActive && (
                                  <Badge variant="success" size="sm" dot>Default vehicle</Badge>
                                )}
                                {needsReauth && (
                                  <Badge variant="warning" size="sm" dot>Refresh Rivian login required</Badge>
                                )}
                              </div>
                              <div className="mt-auto grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5 text-sm">
                                <span className="text-fg-tertiary">Model</span>
                                <span className="text-fg">{modelLine}{!isEditingBattery && batteryLabel}</span>
                                <span className="text-fg-tertiary">VIN</span>
                                <span className="font-mono text-fg">{v.vin ?? 'Not reported'}</span>
                                <span className="text-fg-tertiary">Rivian ID</span>
                                <span className="font-mono text-fg">{v.rivian_vehicle_id}</span>
                              </div>
                            </div>

                            {/* Action buttons */}
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 self-center">
                              {!isActive && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-8 px-2.5"
                                  loading={setDefaultVehicle.isPending && setDefaultVehicle.variables === v.id}
                                  onClick={() => setDefaultVehicle.mutate(v.id)}
                                >
                                  <Star className="mr-1.5 h-3.5 w-3.5" />
                                  Set Default
                                </Button>
                              )}
                              {canManageMembers && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-8 px-2.5"
                                  onClick={() => {
                                    setSharingVehicleId((current) => current === v.id ? null : v.id);
                                    setShareEmail('');
                                    setShareRole('viewer');
                                  }}
                                >
                                  <Users className="mr-1.5 h-3.5 w-3.5" />
                                  {isSharingExpanded ? 'Hide Sharing' : 'Manage Sharing'}
                                </Button>
                              )}
                              {canManageVehicle && (
                                <Tooltip content="Refresh Rivian login">
                                  <Button
                                    aria-label={`Refresh Rivian login for ${v.display_name}`}
                                    variant="secondary"
                                    size="sm"
                                    className={[
                                      'h-8 w-8 px-0',
                                      needsReauth
                                        ? 'border-[var(--rm-status-warning)] text-[var(--rm-status-warning)] hover:border-[var(--rm-status-warning)] hover:text-[var(--rm-status-warning)]'
                                        : '',
                                    ].join(' ')}
                                    onClick={() => navigate({ to: '/connect', search: { mode: 'refresh', vehicle_id: v.id } })}
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                              )}
                              {canManageVehicle && (
                                <Tooltip content="Edit vehicle">
                                  <Button
                                    aria-label={`Edit ${v.display_name}`}
                                    variant="secondary"
                                    size="sm"
                                    className="h-8 w-8 px-0"
                                    onClick={() => startEditVehicle(v.id, v.battery_capacity_kwh)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                              )}
                              {membershipRole === 'owner' && (
                                <Tooltip content="Delete vehicle">
                                  <Button
                                    aria-label={`Delete ${v.display_name}`}
                                    variant="danger"
                                    size="sm"
                                    className="h-8 w-8 px-0"
                                    onClick={() => { setDeleteConfirmId(v.id); setDeleteConfirmText(''); }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                              )}
                            </div>
                          </div>

                          {/* Battery capacity edit — only when open */}
                          {isEditingBattery && (
                            <div className="mt-3 border-t border-border/70 pt-3">
                              <div className="grid gap-3">
                                <div className="flex items-end gap-2">
                                  <label className="grid gap-1 flex-1">
                                    <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Vehicle Name</span>
                                    <input
                                      value={editNameValue}
                                      onChange={(e) => setEditNameValue(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === 'Escape') setEditingBatteryVehicleId(null); }}
                                      className="h-9 w-40 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                                      placeholder="Vehicle name"
                                    />
                                  </label>
                                  <Button
                                    className="h-9 w-9 shrink-0 px-0"
                                    iconLeft={<Save className="h-5 w-5" />}
                                    loading={updateVehicleSettings.isPending || updateVehicleName.isPending}
                                    disabled={
                                      !editNameValue.trim()
                                      || (batteryPreset === 'custom' && (!customKwh || isNaN(parseFloat(customKwh))))
                                      || !editTargetTirePressure
                                      || isNaN(parseFloat(editTargetTirePressure))
                                      || parseFloat(editTargetTirePressure) < 20
                                      || parseFloat(editTargetTirePressure) > 80
                                    }
                                    onClick={() => { handleSaveVehicle(v.id).catch(() => {}); }}
                                    title="Save vehicle"
                                    aria-label="Save vehicle"
                                  />
                                  <Button
                                    variant="secondary"
                                    className="h-9 w-9 shrink-0 px-0"
                                    iconLeft={<X className="h-5 w-5" />}
                                    onClick={() => setEditingBatteryVehicleId(null)}
                                    title="Cancel"
                                    aria-label="Cancel edit"
                                  />
                                </div>
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
                                  <label className="grid gap-1">
                                    <span className="text-xs text-fg-tertiary">Target Tire Pressure</span>
                                    <input
                                      type="number"
                                      value={editTargetTirePressure}
                                      onChange={(e) => setEditTargetTirePressure(e.target.value)}
                                      placeholder="48"
                                      min="20"
                                      max="80"
                                      step="1"
                                      className="h-9 w-32 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                                    />
                                  </label>
                                </div>
                                <p className="text-xs text-fg-tertiary">
                                  This value is used as the baseline for battery health % and degradation charts.
                                  Defaults can be overridden if your vehicle came with a different pack. Target tire pressure is the recommended cold PSI; confirm it against the driver-door placard.
                                </p>
                              </div>
                            </div>
                          )}
                          {isSharingExpanded && (
                            <div className="mt-3 border-t border-border/70 pt-3">
                              <div className="grid gap-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-medium text-fg">Vehicle Access</p>
                                    <p className="text-xs text-fg-tertiary">
                                      Owners can add existing Riviamigo users, adjust roles, and remove access.
                                    </p>
                                  </div>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    loading={vehicleMembers.isFetching}
                                    onClick={() => {
                                      vehicleMembers.refetch();
                                      vehicleInvites.refetch();
                                    }}
                                  >
                                    Refresh
                                  </Button>
                                </div>

                                <div className="grid gap-2 rounded-xl border border-border bg-bg-elevated/35 p-3 md:grid-cols-[minmax(0,1.6fr)_11rem_auto]">
                                  <input
                                    value={shareEmail}
                                    onChange={(event) => setShareEmail(event.target.value)}
                                    placeholder="user@example.com"
                                    className="h-9 rounded-lg border border-border bg-bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
                                  />
                                  <select
                                    value={shareRole}
                                    onChange={(event) => setShareRole(event.target.value as VehicleMember['role'])}
                                    className="h-9 rounded-lg border border-border bg-bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
                                  >
                                    <option value="viewer">Viewer</option>
                                    <option value="manager">Manager</option>
                                    <option value="owner">Owner</option>
                                  </select>
                                  <Button
                                    size="sm"
                                    className="h-9"
                                    loading={addVehicleMember.isPending}
                                    disabled={!shareEmail.trim()}
                                    onClick={() => addVehicleMember.mutate({ vehicleId: v.id, email: shareEmail.trim(), role: shareRole })}
                                  >
                                    Add Member
                                  </Button>
                                </div>
                                {latestInviteToken && (
                                  <div className="rounded-xl border border-border bg-bg-elevated/25 p-3 text-xs text-fg-tertiary">
                                    Invite created for a user not yet registered. Token:
                                    <span className="ml-2 font-mono text-fg">{latestInviteToken}</span>
                                  </div>
                                )}

                                <div className="grid gap-2">
                                  {vehicleMembers.isLoading && (
                                    <div className="rounded-xl border border-border bg-bg-elevated/25 p-3 text-sm text-fg-tertiary">
                                      Loading members...
                                    </div>
                                  )}
                                  {!vehicleMembers.isLoading && (vehicleMembers.data?.length ?? 0) === 0 && (
                                    <div className="rounded-xl border border-border bg-bg-elevated/25 p-3 text-sm text-fg-tertiary">
                                      No members found for this vehicle yet.
                                    </div>
                                  )}
                                  {vehicleMembers.data?.map((member) => {
                                    const isCurrentUser = member.user_id === me.data?.user_id;
                                    return (
                                      <div
                                        key={member.user_id}
                                        className="grid gap-2 rounded-xl border border-border bg-bg-elevated/25 p-3 md:grid-cols-[minmax(0,1fr)_10rem_auto]"
                                      >
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <p className="truncate text-sm font-medium text-fg">{member.email}</p>
                                            <Badge variant={membershipBadgeVariant(member.role)} size="sm">
                                              {formatMembershipRole(member.role)}
                                            </Badge>
                                            {member.is_default && (
                                              <Badge variant="success" size="sm">Default here</Badge>
                                            )}
                                            {isCurrentUser && (
                                              <Badge variant="default" size="sm">You</Badge>
                                            )}
                                          </div>
                                          <p className="mt-1 text-xs text-fg-tertiary">
                                            Added {new Date(member.created_at).toLocaleDateString()}
                                          </p>
                                        </div>
                                        <select
                                          value={member.role}
                                          onChange={(event) => updateVehicleMember.mutate({
                                            vehicleId: v.id,
                                            userId: member.user_id,
                                            role: event.target.value as VehicleMember['role'],
                                          })}
                                          className="h-9 rounded-lg border border-border bg-bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
                                          disabled={updateVehicleMember.isPending}
                                        >
                                          <option value="viewer">Viewer</option>
                                          <option value="manager">Manager</option>
                                          <option value="owner">Owner</option>
                                        </select>
                                        <Button
                                          variant="danger"
                                          size="sm"
                                          className="h-9"
                                          loading={
                                            removeVehicleMember.isPending
                                            && removeVehicleMember.variables?.vehicleId === v.id
                                            && removeVehicleMember.variables?.userId === member.user_id
                                          }
                                          onClick={() => removeVehicleMember.mutate({ vehicleId: v.id, userId: member.user_id })}
                                        >
                                          {isCurrentUser ? 'Remove Me' : 'Remove'}
                                        </Button>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="grid gap-2 pt-1">
                                  <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Pending Invites</p>
                                  {(vehicleInvites.data ?? [])
                                    .filter((invite) => !invite.accepted_at && !invite.revoked_at)
                                    .map((invite) => (
                                      <div key={invite.id} className="grid gap-2 rounded-xl border border-border bg-bg-elevated/25 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                                        <div className="min-w-0">
                                          <p className="truncate text-sm text-fg">
                                            {invite.invitee_email} <span className="text-fg-tertiary">({formatMembershipRole(invite.role)})</span>
                                          </p>
                                          <p className="mt-1 text-xs text-fg-tertiary">
                                            Expires {new Date(invite.expires_at).toLocaleDateString()}
                                          </p>
                                        </div>
                                        <Button
                                          variant="danger"
                                          size="sm"
                                          className="h-9"
                                          loading={revokeVehicleInvite.isPending && revokeVehicleInvite.variables?.inviteId === invite.id}
                                          onClick={() => revokeVehicleInvite.mutate({ vehicleId: v.id, inviteId: invite.id })}
                                        >
                                          Revoke
                                        </Button>
                                      </div>
                                    ))}
                                  {(vehicleInvites.data ?? []).filter((invite) => !invite.accepted_at && !invite.revoked_at).length === 0 && (
                                    <div className="rounded-xl border border-border bg-bg-elevated/25 p-3 text-sm text-fg-tertiary">
                                      No pending invites.
                                    </div>
                                  )}
                                </div>
                              </div>
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

            {activeSection === 'dashboards' && (
              <DashboardSettingsSection
                dashboards={dashboards.data ?? []}
                isLoading={dashboards.isLoading}
                canManageDefaults={isAdmin}
                cloneDashboard={cloneDashboard}
                deleteDashboard={deleteDashboard}
                setDashboardLock={setDashboardLock}
                restoreDefaultDashboard={restoreDefaultDashboard}
                onEdit={(dashboard, edit) => {
                  navigate({
                    to: '/d/$slug',
                    params: { slug: dashboard.slug },
                    search: edit ? { edit: '1' } : {},
                  } as never);
                }}
              />
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
                  <p className="text-sm text-fg-tertiary">Pick a preset system or switch to Custom for per-unit control.</p>
                  <div className="grid gap-3 md:grid-cols-3">
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
                      {
                        value: 'custom' as const,
                        title: 'Custom',
                        copy: 'Choose each unit family independently.',
                      },
                    ].map((option) => {
                      const active = unitPreferences.mode === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleUnitModeChange(option.value)}
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
                  {unitPreferences.mode === 'custom' ? (
                    <div className="rounded-xl border border-border bg-bg-elevated/35 p-3">
                      <p className="mb-3 text-xs uppercase tracking-wider text-fg-tertiary">Custom Units</p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Distance / Range</span>
                          <select className="h-9 rounded-lg border border-border bg-bg-surface px-2" value={unitPreferences.distance_unit} onChange={(event) => handleCustomUnitChange('distance_unit', event.target.value as UnitPreferences['distance_unit'])}>
                            <option value="miles">Miles (mi)</option>
                            <option value="kilometers">Kilometers (km)</option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Speed</span>
                          <select className="h-9 rounded-lg border border-border bg-bg-surface px-2" value={unitPreferences.speed_unit} onChange={(event) => handleCustomUnitChange('speed_unit', event.target.value as UnitPreferences['speed_unit'])}>
                            <option value="mph">Miles/hour (mph)</option>
                            <option value="kmh">Kilometers/hour (km/h)</option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Temperature</span>
                          <select className="h-9 rounded-lg border border-border bg-bg-surface px-2" value={unitPreferences.temperature_unit} onChange={(event) => handleCustomUnitChange('temperature_unit', event.target.value as UnitPreferences['temperature_unit'])}>
                            <option value="fahrenheit">Fahrenheit (F)</option>
                            <option value="celsius">Celsius (C)</option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Pressure</span>
                          <select className="h-9 rounded-lg border border-border bg-bg-surface px-2" value={unitPreferences.pressure_unit} onChange={(event) => handleCustomUnitChange('pressure_unit', event.target.value as UnitPreferences['pressure_unit'])}>
                            <option value="psi">PSI</option>
                            <option value="kpa">kPa</option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Altitude</span>
                          <select className="h-9 rounded-lg border border-border bg-bg-surface px-2" value={unitPreferences.altitude_unit} onChange={(event) => handleCustomUnitChange('altitude_unit', event.target.value as UnitPreferences['altitude_unit'])}>
                            <option value="feet">Feet (ft)</option>
                            <option value="meters">Meters (m)</option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Place Radius</span>
                          <select className="h-9 rounded-lg border border-border bg-bg-surface px-2" value={unitPreferences.place_radius_unit} onChange={(event) => handleCustomUnitChange('place_radius_unit', event.target.value as UnitPreferences['place_radius_unit'])}>
                            <option value="feet">Feet (ft)</option>
                            <option value="meters">Meters (m)</option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm text-fg md:col-span-2">
                          <span>Efficiency Display</span>
                          <select className="h-9 rounded-lg border border-border bg-bg-surface px-2" value={unitPreferences.efficiency_display} onChange={(event) => handleCustomUnitChange('efficiency_display', event.target.value as UnitPreferences['efficiency_display'])}>
                            <option value="distance_per_energy">Distance per energy (mi/kWh or km/kWh)</option>
                            <option value="energy_per_distance">Energy per distance (Wh/mi or Wh/km)</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}

            {activeSection === 'places' && <PlacesSection unitSystem={placesUnitSystem} />}

            {activeSection === 'backup' && canManageBackups && <BackupSection />}

            {activeSection === 'jobs' && <JobsSection vehicles={vehicles ?? []} />}

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
                      <p className="mt-0.5 text-xs text-fg-tertiary">Toggle between dark, light, and system appearance</p>
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
