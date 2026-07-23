import React from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rootRoute } from './__root';
import { api, AuthenticatedVehicleArtwork, resolveVehicleArtwork, useAuth, useAuthReady, useMe, useVehicles } from '@riviamigo/hooks';
import type { UnitPreferences, VehicleImages, VehicleMember } from '@riviamigo/types';
import {
  downloadDashboardYaml,
  materializeUserDashboardDraft,
  useCloneDashboard,
  useCreateDashboard,
  useDashboards,
  useDeleteDashboard,
  useRestoreAdminDashboardDefault,
  useSetAdminDashboardLock,
} from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';
import {
  getUnitPreferences,
  setUnitPreferences,
  type UnitMode,
  type UnitSystem,
} from '@riviamigo/ui/lib/utils';
import {
  appTimezoneOptions,
  formatAppDate,
  formatAppDateTime,
  getAppTimezone,
  setAppTimezone,
} from '@riviamigo/ui/lib/dateTime';
import { DEFAULT_TARGET_TIRE_PRESSURE_PSI } from '@riviamigo/ui/lib/vehicleTires';
import {
  PageLayout, Card, CardHeader, CardTitle, CardContent,
  Button, Badge, Input, SelectPicker, ThemeToggle, Tooltip,
} from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { BackupSection } from '../components/settings/BackupSection';
import { ExternalConnectionsSection } from '../components/settings/ExternalConnectionsSection';
import { JobsSection } from '../components/settings/JobsSection';
import { PlacesSection } from '../components/settings/PlacesSection';
import { RawTelemetryExplorer } from '../components/settings/RawTelemetryExplorer';
import { canManageSystemDashboards } from '../components/dashboard/DashboardPage';
import { useDashboardEditButtonPreference } from '../components/dashboard/useDashboardEditButtonPreference';
import { PASSWORD_MIN_LENGTH, PasswordRequirements } from '../components/auth/PasswordRequirements';
import {
  Car, Clipboard, Database, DatabaseBackup, Download, ExternalLink, Globe2, KeyRound, ListChecks, Lock, LogOut, MapPin, Pencil, Plus, RefreshCw, RotateCcw, Ruler, Save, Search, ShieldCheck, Star, Trash2, Unlock, Users, X,
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

type SettingsSection = 'vehicles' | 'dashboards' | 'units' | 'places' | 'external' | 'api' | 'jobs' | 'raw' | 'backup' | 'appearance' | 'account';

const baseSections: Array<{ id: SettingsSection; label: string; icon: React.ElementType }> = [
  { id: 'vehicles', label: 'Vehicles', icon: Car },
  { id: 'dashboards', label: 'Dashboards', icon: Clipboard },
  { id: 'units', label: 'Units', icon: Ruler },
  { id: 'places', label: 'Places', icon: MapPin },
  { id: 'external', label: 'External Connections', icon: Globe2 },
  { id: 'api', label: 'API Access', icon: KeyRound },
  { id: 'jobs', label: 'Jobs', icon: ListChecks },
  { id: 'raw', label: 'Raw Data', icon: Database },
  { id: 'appearance', label: 'Appearance', icon: ShieldCheck },
  { id: 'account', label: 'Account', icon: LogOut },
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
  model,
  placement,
  className,
  fallback,
}: {
  images?: VehicleImages | null | undefined;
  model?: string | null | undefined;
  placement: 'side' | 'overhead' | 'front' | 'rear';
  className?: string;
  fallback: React.ReactNode;
}) {
  const resolved = resolveVehicleArtwork(images, model, placement === 'side' ? 'vehicle-card' : 'health');
  const light = resolved.light;
  const dark = resolved.dark ?? light;

  if (!light && !dark && !resolved.fallback) return <>{fallback}</>;

  return (
    <>
      <AuthenticatedVehicleArtwork source={light} fallbackSource={resolved.fallback} fallbackProps={{ className: `${className ?? ''} dark:hidden` }} alt="" className={`${className ?? ''} dark:hidden`} loading="lazy" />
      <AuthenticatedVehicleArtwork source={dark} fallbackSource={resolved.fallback} fallbackProps={{ className: `${className ?? ''} hidden dark:block` }} alt="" className={`${className ?? ''} hidden dark:block`} loading="lazy" />
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
  createDashboard,
  showEditButton,
  onShowEditButtonChange,
  onCustomize,
  onEdit,
}: {
  dashboards: DashboardConfig[];
  isLoading: boolean;
  canManageDefaults: boolean;
  cloneDashboard: ReturnType<typeof useCloneDashboard>;
  deleteDashboard: ReturnType<typeof useDeleteDashboard>;
  setDashboardLock: ReturnType<typeof useSetAdminDashboardLock>;
  restoreDefaultDashboard: ReturnType<typeof useRestoreAdminDashboardDefault>;
  createDashboard: ReturnType<typeof useCreateDashboard>;
  showEditButton: boolean;
  onShowEditButtonChange: (next: boolean) => void;
  onCustomize: (dashboard: DashboardConfig) => Promise<void>;
  onEdit: (dashboard: DashboardConfig, edit: boolean) => void;
}) {
  const defaults = dashboards.filter((dashboard) => dashboard.isDefault);
  const userDashboards = dashboards.filter((dashboard) => !dashboard.isDefault);
  const userBySlug = new Map(userDashboards.map((dashboard) => [dashboard.slug, dashboard]));
  const defaultBySlug = new Map(defaults.map((dashboard) => [dashboard.slug, dashboard]));

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
          <details className="group rounded-xl border border-border bg-bg-elevated/35">
            <summary className="cursor-pointer list-none px-3 py-3 text-sm font-medium text-fg marker:hidden">
              How dashboard defaults and personal copies work
            </summary>
            <div className="grid gap-2 border-t border-border px-3 py-3 text-sm text-fg-secondary">
              <p><strong className="text-fg">System defaults</strong> are shared within this Riviamigo installation. Admin edits affect users who have not customized that page.</p>
              <p><strong className="text-fg">My dashboards</strong> are private to your account. A personal copy with the same page name is active for you and takes precedence without changing the system default.</p>
              <p><strong className="text-fg">Customize</strong> creates that personal copy. <strong className="text-fg">Reset to default</strong> removes it, while <strong className="text-fg">Restore bundled</strong> returns a system dashboard to the version shipped with Riviamigo.</p>
            </div>
          </details>
          <DashboardEditButtonPreference
            checked={showEditButton}
            onChange={onShowEditButtonChange}
          />
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
                createDashboard={createDashboard}
                userBySlug={userBySlug}
                defaultBySlug={defaultBySlug}
                onCustomize={onCustomize}
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
                createDashboard={createDashboard}
                userBySlug={userBySlug}
                defaultBySlug={defaultBySlug}
                onCustomize={onCustomize}
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

function DashboardEditButtonPreference({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-bg-elevated/35 px-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">Show edit button on dashboard pages</p>
        <p className="mt-0.5 text-xs text-fg-tertiary">
          Show the page-level edit shortcut on every dashboard. It is hidden by default; Settings can always open edit mode.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Show edit button on dashboard pages"
        onClick={() => onChange(!checked)}
        className={[
          'relative inline-flex h-[22px] w-10 shrink-0 rounded-full border transition-all duration-200',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          checked ? 'border-accent/60 bg-accent' : 'border-border bg-bg-elevated',
          'cursor-pointer',
        ].join(' ')}
      >
        <span
          className={[
            'pointer-events-none absolute top-[2px] inline-block h-4 w-4 rounded-full shadow-sm transition-transform duration-200',
            checked ? 'translate-x-[22px] bg-fg' : 'translate-x-[2px] bg-fg-tertiary',
          ].join(' ')}
        />
      </button>
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
  createDashboard,
  userBySlug,
  defaultBySlug,
  onCustomize,
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
  createDashboard: ReturnType<typeof useCreateDashboard>;
  userBySlug: Map<string, DashboardConfig>;
  defaultBySlug: Map<string, DashboardConfig>;
  onCustomize: (dashboard: DashboardConfig) => Promise<void>;
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
            const personalCopy = userBySlug.get(dashboard.slug);
            const systemDefault = defaultBySlug.get(dashboard.slug);
            const isActive = isUserOwned || !personalCopy;
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
                    {isActive ? <Badge variant="success" size="sm">Active for you</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-fg-tertiary">
                    {dashboard.slug} &middot; {dashboard.widgets.length} widgets
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 [&>button]:min-h-11 sm:[&>button]:min-h-8">
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<ExternalLink className="h-3.5 w-3.5" />}
                    onClick={() => onEdit(dashboard, false)}
                  >
                    {dashboard.isDefault ? 'Open default' : 'Open'}
                  </Button>
                  {canEdit ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      iconLeft={<Pencil className="h-3.5 w-3.5" />}
                      onClick={() => onEdit(dashboard, true)}
                    >
                      {dashboard.isDefault ? 'Edit default' : 'Edit'}
                    </Button>
                  ) : null}
                  {dashboard.isDefault ? (
                    personalCopy ? null : (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={createDashboard.isPending}
                        onClick={() => { void onCustomize(dashboard); }}
                      >
                        Customize
                      </Button>
                    )
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={cloneDashboard.isPending && cloneDashboard.variables === dashboard.id}
                      onClick={() => { void onDuplicate(dashboard); }}
                    >
                      Duplicate
                    </Button>
                  )}
                  <Button
                    variant="secondary"
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
                        Restore bundled
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
                        const message = systemDefault
                          ? `Reset "${dashboard.name}" to the system default? This removes your personal dashboard copy.`
                          : `Delete "${dashboard.name}"? This removes your saved dashboard.`;
                        if (window.confirm(message)) {
                          deleteDashboard.mutate(dashboard.id);
                        }
                      }}
                    >
                      {systemDefault ? 'Reset to default' : 'Delete'}
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
  const { accessToken, clearSession, logout, defaultVehicleId, setDefaultVehicleId, setActiveVehicleId } = useAuth();
  const authReady = useAuthReady();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: vehicles } = useVehicles();
  const me = useMe();
  const [showEditButton, setShowEditButton] = useDashboardEditButtonPreference(me.data?.user_id);
  const [activeSection, setActiveSection] = React.useState<SettingsSection>('vehicles');
  const [apiKeyName, setApiKeyName] = React.useState('Local troubleshooting');
  const [apiKeyVehicleId, setApiKeyVehicleId] = React.useState('');
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);
  const [apiCatalogSearch, setApiCatalogSearch] = React.useState('');
  const [unitPreferences, setUnitPreferencesState] = React.useState<UnitPreferences>(() => getUnitPreferences());
  const [appTimezone, setAppTimezoneState] = React.useState(() => getAppTimezone());
  const placesUnitSystem: UnitSystem = unitPreferences.place_radius_unit === 'meters' ? 'metric' : 'imperial';
  const [editingBatteryVehicleId, setEditingBatteryVehicleId] = React.useState<string | null>(null);
  const [batteryGen, setBatteryGen] = React.useState<BatteryGen>('gen1');
  const [batteryPreset, setBatteryPreset] = React.useState('r1_large_g1');
  const [customKwh, setCustomKwh] = React.useState('');
  const [editTargetTirePressure, setEditTargetTirePressure] = React.useState(String(DEFAULT_TARGET_TIRE_PRESSURE_PSI));
  const [editNameValue, setEditNameValue] = React.useState('');
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = React.useState('');
  const [demoRefreshConfirmId, setDemoRefreshConfirmId] = React.useState<string | null>(null);
  const [sharingVehicleId, setSharingVehicleId] = React.useState<string | null>(null);
  const [shareEmail, setShareEmail] = React.useState('');
  const [shareRole, setShareRole] = React.useState<VehicleMember['role']>('viewer');
  const [latestInviteToken, setLatestInviteToken] = React.useState<string | null>(null);
  const [demoPickerOpen, setDemoPickerOpen] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmNewPassword, setConfirmNewPassword] = React.useState('');
  const [passwordChangeError, setPasswordChangeError] = React.useState('');
  const [changingPassword, setChangingPassword] = React.useState(false);
  const canCreateDemoVehicle = me.data?.role === 'admin' || me.data?.role === 'super_user';
  const isAdmin = canManageSystemDashboards(me.data?.role);
  const canManageBackups = me.data?.role === 'admin' || me.data?.role === 'super_user';
  const sections = React.useMemo(
    () => canManageBackups
      ? [...baseSections.slice(0, 6), { id: 'backup' as const, label: 'Backups', icon: DatabaseBackup }, ...baseSections.slice(6)]
      : baseSections,
    [canManageBackups],
  );

  const apiKeys = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.listApiKeys(),
    enabled: authReady && activeSection === 'api' && !!accessToken,
    retry: false,
  });

  const apiCatalog = useQuery({
    queryKey: ['api-catalog'],
    queryFn: () => api.getApiCatalog(),
    enabled: authReady && activeSection === 'api' && !!accessToken,
    retry: false,
  });

  const filteredApiEndpoints = React.useMemo(() => {
    const query = apiCatalogSearch.trim().toLowerCase();
    const endpoints = apiCatalog.data?.endpoints ?? [];
    if (!query) return endpoints;
    return endpoints.filter((endpoint) => `${endpoint.method} ${endpoint.path}`.toLowerCase().includes(query));
  }, [apiCatalog.data?.endpoints, apiCatalogSearch]);

  const dashboards = useDashboards();
  const createDashboard = useCreateDashboard();
  const cloneDashboard = useCloneDashboard();
  const deleteDashboard = useDeleteDashboard();
  const setDashboardLock = useSetAdminDashboardLock();
  const restoreDefaultDashboard = useRestoreAdminDashboardDefault();

  const openDashboard = React.useCallback((dashboard: DashboardConfig, edit: boolean) => {
    navigate({
      to: '/d/$slug',
      params: { slug: dashboard.slug },
      search: {
        dashboardId: dashboard.id,
        ...(edit ? { edit: 1 } : {}),
      },
    } as never);
  }, [navigate]);

  const customizeDashboard = React.useCallback(async (dashboard: DashboardConfig) => {
    const existing = dashboards.data?.find((entry) => (
      entry.ownerId != null && entry.slug === dashboard.slug
    ));
    if (existing) {
      openDashboard(existing, true);
      return;
    }

    try {
      const created = await createDashboard.mutateAsync(materializeUserDashboardDraft(dashboard));
      openDashboard(created, true);
    } catch {
      const refreshed = await dashboards.refetch();
      const racedCopy = refreshed.data?.find((entry) => (
        entry.ownerId != null && entry.slug === dashboard.slug
      ));
      if (!racedCopy) throw new Error('Could not create or find the personal dashboard copy');
      openDashboard(racedCopy, true);
    }
  }, [createDashboard, dashboards, openDashboard]);

  const unitPreferencesQuery = useQuery({
    queryKey: ['unit-preferences'],
    queryFn: () => api.getUnitPreferences(),
    enabled: authReady && !!accessToken,
  });

  const appTimezoneQuery = useQuery({
    queryKey: ['app-timezone'],
    queryFn: () => api.getAppTimezone(),
    enabled: authReady && !!accessToken,
  });

  React.useEffect(() => {
    const next = unitPreferencesQuery.data?.units;
    if (!next) return;
    setUnitPreferencesState(next);
    setUnitPreferences(next);
  }, [unitPreferencesQuery.data]);

  React.useEffect(() => {
    const next = appTimezoneQuery.data?.timezone;
    if (!next) return;
    setAppTimezoneState(next);
    setAppTimezone(next);
  }, [appTimezoneQuery.data]);

  React.useEffect(() => {
    if (!apiKeyVehicleId && vehicles?.[0]?.id) {
      setApiKeyVehicleId(vehicles[0].id);
    }
  }, [apiKeyVehicleId, vehicles]);

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

  const refreshVehicleArtwork = useMutation({
    mutationFn: (vehicleId: string) => api.refreshVehicleArtwork(vehicleId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles', 'images', result.vehicle_id] });
    },
  });

  const purgeVehicleArtworkCache = useMutation({
    mutationFn: (vehicleId: string) => api.purgeVehicleArtworkCache(vehicleId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles', 'images', result.vehicle_id] });
    },
  });

  const refreshDemoVehicle = useMutation({
    mutationFn: (vehicleId: string) => api.refreshDemoVehicle(vehicleId),
    onSuccess: () => {
      setDemoRefreshConfirmId(null);
      void queryClient.invalidateQueries();
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

  const updateAppTimezone = useMutation({
    mutationFn: (timezone: string) => api.updateAppTimezone(timezone),
    onSuccess: (result) => {
      setAppTimezoneState(result.timezone);
      setAppTimezone(result.timezone);
      queryClient.invalidateQueries({ queryKey: ['app-timezone'] });
      queryClient.invalidateQueries({ queryKey: ['backup-overview'] });
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

  async function handlePasswordChange(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword !== confirmNewPassword || !currentPassword) return;

    setChangingPassword(true);
    setPasswordChangeError('');
    try {
      await api.changePassword({ current_password: currentPassword, new_password: newPassword });
      queryClient.clear();
      clearSession();
      navigate({ to: '/login', search: { password_changed: '1' } });
    } catch (error) {
      const message = (error as { detail?: { message?: string } }).detail?.message;
      setPasswordChangeError(message ?? 'Unable to change password. Please try again.');
    } finally {
      setChangingPassword(false);
    }
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

                  {demoRefreshConfirmId && (() => {
                    const demo = vehicles?.find((vehicle) => vehicle.id === demoRefreshConfirmId);
                    return (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-page/80 px-4 backdrop-blur-sm">
                        <div className="w-full max-w-sm rounded-xl border border-border bg-bg-surface p-5 shadow-lg">
                          <h3 className="text-sm font-semibold text-fg">Refresh {demo?.display_name ?? 'demo vehicle'}?</h3>
                          <p className="mt-2 text-xs text-fg-tertiary">
                            This replaces only the illustrative telemetry, trips, charging, and weather history with a fresh rolling 14-day demo window. Sharing and vehicle settings stay unchanged.
                          </p>
                          <div className="mt-4 flex justify-end gap-2">
                            <Button variant="secondary" size="sm" onClick={() => setDemoRefreshConfirmId(null)}>
                              Cancel
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              loading={refreshDemoVehicle.isPending}
                              onClick={() => refreshDemoVehicle.mutate(demoRefreshConfirmId)}
                            >
                              Refresh Demo Data
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
                      const isDemo = v.is_demo ?? v.rivian_vehicle_id?.startsWith('demo-') ?? false;

                      const needsReauth = !isDemo && v.auth_state === 'needs_reauth';
                      const collectorHealthy = v.worker_health === 'ok' || v.worker_health === 'connected';
                      const collectorPassive = v.worker_health === 'passive';
                      const healthColor = isDemo
                        ? 'var(--rm-status-info)'
                        : needsReauth
                        ? 'var(--rm-status-warning)'
                        : collectorHealthy
                          ? 'var(--rm-status-positive)'
                          : collectorPassive
                            ? 'var(--rm-border-default)'
                          : v.worker_health != null
                            ? 'var(--rm-status-danger)'
                            : 'var(--rm-border-default)';
                      const healthText = isDemo
                        ? 'Demo data'
                        : needsReauth
                        ? 'Login required'
                        : collectorHealthy
                          ? (isActive ? 'Active' : 'Connected')
                          : collectorPassive
                            ? 'Standby'
                          : v.worker_health != null
                            ? 'Error'
                            : (isActive ? 'Active' : 'Offline');
                      const hasGlow = isDemo || needsReauth || v.worker_health != null;

                      const modelLine = [v.model, v.year, v.trim].filter(Boolean).join(' · ') || 'Vehicle details pending';
                      const batteryLabel = v.battery_capacity_kwh != null ? ` · ${v.battery_capacity_kwh} kWh` : '';

                      return (
                      <div key={v.id} className="py-2">
                        <div className="rounded-lg border border-border bg-bg-elevated/35 p-3">
                          <div className="flex flex-col gap-3 sm:flex-row">
                            {/* Status chip */}
                            <div
                              className="flex w-full shrink-0 flex-col items-center gap-1 rounded-xl border bg-bg-elevated/70 px-1.5 py-2 transition-shadow sm:w-40"
                              style={{
                                borderColor: healthColor,
                                boxShadow: hasGlow
                                  ? `0 0 18px color-mix(in oklab, ${healthColor} 35%, transparent)`
                                  : 'none',
                              }}
                            >
                              <ThemeVehicleImage
                                images={v.images}
                                model={v.model}
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
                                {isDemo && (
                                  <Badge variant="info" size="sm" dot>Demo data</Badge>
                                )}
                                {isActive && (
                                  <Badge variant="success" size="sm" dot>Default vehicle</Badge>
                                )}
                                {needsReauth && (
                                  <Badge variant="warning" size="sm" dot>Refresh Rivian login required</Badge>
                                )}
                                {isAdmin && !isDemo && v.images?.cache && (
                                  <Badge
                                    variant={v.images.cache.status === 'ready' ? 'success' : v.images.cache.status === 'failed' ? 'warning' : 'default'}
                                    size="sm"
                                    title={v.images.cache.last_error ?? undefined}
                                  >
                                    {v.images.cache.status === 'ready' ? 'Artwork' : 'Artwork restoring'} {v.images.cache.ready_asset_count}/{v.images.cache.asset_count}
                                  </Badge>
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
                            <div className="flex shrink-0 flex-wrap items-center justify-start gap-1.5 self-center sm:justify-end">
                              {!isActive && (
                                <Tooltip content="Set as default vehicle">
                                  <Button
                                    aria-label={`Set ${v.display_name} as default vehicle`}
                                    variant="secondary"
                                    size="sm"
                                    className="h-8 w-8 px-0"
                                    loading={setDefaultVehicle.isPending && setDefaultVehicle.variables === v.id}
                                    onClick={() => setDefaultVehicle.mutate(v.id)}
                                  >
                                    <Star className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                              )}
                              {canManageMembers && (
                                <Tooltip content={isSharingExpanded ? 'Hide sharing' : 'Manage sharing'}>
                                  <Button
                                    aria-label={`${isSharingExpanded ? 'Hide sharing for' : 'Manage sharing for'} ${v.display_name}`}
                                    variant="secondary"
                                    size="sm"
                                    className="h-8 w-8 px-0"
                                    onClick={() => {
                                      setSharingVehicleId((current) => current === v.id ? null : v.id);
                                      setShareEmail('');
                                      setShareRole('viewer');
                                    }}
                                  >
                                    <Users className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                              )}
                              {canManageVehicle && !isDemo && (
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
                              {isAdmin && !isDemo && (
                                <Tooltip content="Clear local artwork cache; the next artwork view restores it">
                                  <Button
                                    aria-label={`Clear local artwork cache for ${v.display_name}`}
                                    variant="secondary"
                                    size="sm"
                                    className="h-8 w-8 px-0"
                                    loading={purgeVehicleArtworkCache.isPending && purgeVehicleArtworkCache.variables === v.id}
                                    onClick={() => purgeVehicleArtworkCache.mutate(v.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                              )}
                              {isAdmin && !isDemo && (
                                <Tooltip content="Refresh vehicle artwork from Rivian">
                                  <Button
                                    aria-label={`Refresh vehicle artwork for ${v.display_name}`}
                                    variant="secondary"
                                    size="sm"
                                    className="h-8 w-8 px-0"
                                    loading={refreshVehicleArtwork.isPending && refreshVehicleArtwork.variables === v.id}
                                    onClick={() => refreshVehicleArtwork.mutate(v.id)}
                                  >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                              )}
                              {isAdmin && isDemo && (
                                <Tooltip content="Refresh demo data">
                                  <Button
                                    aria-label={`Refresh demo data for ${v.display_name}`}
                                    variant="secondary"
                                    size="sm"
                                    className="h-8 w-8 px-0"
                                    loading={refreshDemoVehicle.isPending && refreshDemoVehicle.variables === v.id}
                                    onClick={() => setDemoRefreshConfirmId(v.id)}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
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
                                      <SelectPicker
                                        className="min-w-[6rem]"
                                        value={batteryGen}
                                        onChange={(value) => {
                                          setBatteryGen(value as BatteryGen);
                                          setBatteryPreset(value === 'gen2' ? 'r1_large_g2' : 'r1_large_g1');
                                          setCustomKwh('');
                                        }}
                                        aria-label="Battery generation"
                                        options={[{ value: 'gen1', label: 'Gen 1' }, { value: 'gen2', label: 'Gen 2' }]}
                                      />
                                    </label>
                                  )}
                                  <label className="grid gap-1">
                                    <span className="text-xs text-fg-tertiary">Pack</span>
                                    <SelectPicker
                                      className="min-w-[14rem]"
                                      value={batteryPreset}
                                      onChange={setBatteryPreset}
                                      aria-label="Battery pack"
                                      options={(v.model?.includes('R2') || v.model?.includes('r2') ? [R2S_PRESET, { key: 'custom', label: 'Custom', kwh: null }] : RIVIAN_BATTERY_PRESETS[batteryGen]).map((preset) => ({
                                        value: preset.key,
                                        label: `${preset.label}${preset.kwh != null ? ` (${preset.kwh} kWh)` : ''}`,
                                      }))}
                                    />
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
                                  <SelectPicker
                                    className="w-full"
                                    value={shareRole}
                                    onChange={(value) => setShareRole(value as VehicleMember['role'])}
                                    aria-label="Vehicle member role"
                                    options={[{ value: 'viewer', label: 'Viewer' }, { value: 'manager', label: 'Manager' }, { value: 'owner', label: 'Owner' }]}
                                  />
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
                              Added {formatAppDate(member.created_at)}
                                          </p>
                                        </div>
                                        <SelectPicker
                                          className="min-w-[7rem]"
                                          value={member.role}
                                          onChange={(value) => updateVehicleMember.mutate({
                                            vehicleId: v.id,
                                            userId: member.user_id,
                                            role: value as VehicleMember['role'],
                                          })}
                                          aria-label={`Role for ${member.email}`}
                                          disabled={updateVehicleMember.isPending}
                                          options={[{ value: 'viewer', label: 'Viewer' }, { value: 'manager', label: 'Manager' }, { value: 'owner', label: 'Owner' }]}
                                        />
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
                                            Expires {formatAppDate(invite.expires_at)}
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
                createDashboard={createDashboard}
                showEditButton={showEditButton}
                onShowEditButtonChange={setShowEditButton}
                onCustomize={customizeDashboard}
                onEdit={openDashboard}
              />
            )}

            {activeSection === 'api' && (
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
                          onChange={(event) => setApiKeyName(event.target.value)}
                          className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Vehicle</span>
                        <SelectPicker
                          className="w-full"
                          value={apiKeyVehicleId}
                          onChange={setApiKeyVehicleId}
                          aria-label="API key vehicle"
                          options={vehicles?.map((vehicle) => ({ value: vehicle.id, label: vehicle.display_name })) ?? []}
                        />
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
                    <CardTitle>Integration Reference</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <div className="relative">
                      <label className="sr-only" htmlFor="api-endpoint-search">Search API endpoints</label>
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary" />
                      <input
                        id="api-endpoint-search"
                        value={apiCatalogSearch}
                        onChange={(event) => setApiCatalogSearch(event.target.value)}
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
                          <SelectPicker className="w-full" value={unitPreferences.distance_unit} onChange={(value) => handleCustomUnitChange('distance_unit', value as UnitPreferences['distance_unit'])} aria-label="Distance and range unit" options={[{ value: 'miles', label: 'Miles (mi)' }, { value: 'kilometers', label: 'Kilometers (km)' }]} />
                        </label>
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Speed</span>
                          <SelectPicker className="w-full" value={unitPreferences.speed_unit} onChange={(value) => handleCustomUnitChange('speed_unit', value as UnitPreferences['speed_unit'])} aria-label="Speed unit" options={[{ value: 'mph', label: 'Miles/hour (mph)' }, { value: 'kmh', label: 'Kilometers/hour (km/h)' }]} />
                        </label>
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Temperature</span>
                          <SelectPicker className="w-full" value={unitPreferences.temperature_unit} onChange={(value) => handleCustomUnitChange('temperature_unit', value as UnitPreferences['temperature_unit'])} aria-label="Temperature unit" options={[{ value: 'fahrenheit', label: 'Fahrenheit (F)' }, { value: 'celsius', label: 'Celsius (C)' }]} />
                        </label>
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Pressure</span>
                          <SelectPicker className="w-full" value={unitPreferences.pressure_unit} onChange={(value) => handleCustomUnitChange('pressure_unit', value as UnitPreferences['pressure_unit'])} aria-label="Pressure unit" options={[{ value: 'psi', label: 'PSI' }, { value: 'kpa', label: 'kPa' }]} />
                        </label>
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Altitude</span>
                          <SelectPicker className="w-full" value={unitPreferences.altitude_unit} onChange={(value) => handleCustomUnitChange('altitude_unit', value as UnitPreferences['altitude_unit'])} aria-label="Altitude unit" options={[{ value: 'feet', label: 'Feet (ft)' }, { value: 'meters', label: 'Meters (m)' }]} />
                        </label>
                        <label className="grid gap-1 text-sm text-fg">
                          <span>Place Radius</span>
                          <SelectPicker className="w-full" value={unitPreferences.place_radius_unit} onChange={(value) => handleCustomUnitChange('place_radius_unit', value as UnitPreferences['place_radius_unit'])} aria-label="Place radius unit" options={[{ value: 'feet', label: 'Feet (ft)' }, { value: 'meters', label: 'Meters (m)' }]} />
                        </label>
                        <label className="grid gap-1 text-sm text-fg md:col-span-2">
                          <span>Efficiency Display</span>
                          <SelectPicker className="w-full" value={unitPreferences.efficiency_display} onChange={(value) => handleCustomUnitChange('efficiency_display', value as UnitPreferences['efficiency_display'])} aria-label="Efficiency display" options={[{ value: 'distance_per_energy', label: 'Distance per energy (mi/kWh or km/kWh)' }, { value: 'energy_per_distance', label: 'Energy per distance (Wh/mi or Wh/km)' }]} />
                        </label>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-3 rounded-xl border border-border bg-bg-elevated/35 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-end">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-fg-tertiary">Time zone</p>
                      <p className="mt-1 text-sm text-fg">Application time zone</p>
                      <p className="mt-1 text-xs text-fg-tertiary">
                        All Riviamigo dates, charts, local-day groupings, and scheduled backups use this time zone.
                        {!canManageBackups ? ' An administrator manages this shared setting.' : ''}
                      </p>
                    </div>
                    <SelectPicker
                      className="w-full"
                      value={appTimezone}
                      onChange={(value) => updateAppTimezone.mutate(value)}
                      aria-label="Application time zone"
                      disabled={!canManageBackups || updateAppTimezone.isPending || appTimezoneQuery.isLoading}
                      options={appTimezoneOptions(appTimezone)}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {activeSection === 'places' && <PlacesSection unitSystem={placesUnitSystem} />}

            {activeSection === 'external' && <ExternalConnectionsSection />}

            {activeSection === 'backup' && canManageBackups && <BackupSection />}

            {activeSection === 'jobs' && <JobsSection vehicles={vehicles ?? []} />}

            {activeSection === 'raw' && <RawTelemetryExplorer vehicles={vehicles ?? []} isAdmin={isAdmin} />}

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
                <CardContent className="grid gap-6">
                  <form className="grid max-w-md gap-4" onSubmit={handlePasswordChange}>
                    <div>
                      <p className="text-sm font-medium text-fg">Change password</p>
                      <p className="mt-0.5 text-xs text-fg-tertiary">Changing your password signs out every active browser session.</p>
                    </div>
                    <Input
                      label="Current password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                    />
                    <Input
                      label="New password"
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      minLength={PASSWORD_MIN_LENGTH}
                      required
                    />
                    <PasswordRequirements password={newPassword} />
                    <Input
                      label="Confirm new password"
                      type="password"
                      value={confirmNewPassword}
                      onChange={(event) => setConfirmNewPassword(event.target.value)}
                      autoComplete="new-password"
                      {...(confirmNewPassword && newPassword !== confirmNewPassword ? { error: 'Passwords do not match.' } : {})}
                      required
                    />
                    {passwordChangeError && <p role="alert" className="rounded-lg border border-status-danger/20 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">{passwordChangeError}</p>}
                    <Button
                      type="submit"
                      size="sm"
                      loading={changingPassword}
                      disabled={!currentPassword || newPassword.length < PASSWORD_MIN_LENGTH || newPassword !== confirmNewPassword}
                    >
                      Change password
                    </Button>
                  </form>
                  <div className="border-t border-border pt-5">
                    <Button variant="danger" size="sm" iconLeft={<LogOut className="h-3.5 w-3.5" />}
                      onClick={handleLogout}>
                      Sign Out
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </PageLayout>
    </AppLayout>
  );
}
