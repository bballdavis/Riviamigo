import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys, useAuth, useAuthReady, useMe, useVehicles } from '@riviamigo/hooks';
import { type UnitPreferences } from '@riviamigo/types';
import {
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
  getAppTimezone,
  setAppTimezone,
} from '@riviamigo/ui/lib/dateTime';
import {
  PageLayout, Card, CardHeader, CardTitle, CardContent,
  Button, Badge, Input, SelectPicker,
} from '@riviamigo/ui/primitives';
import { AppLayout } from '../../components/layout/AppLayout';
import { useReleaseCheckStatus } from '../../hooks/useGithubReleaseCheck';
import { RELEASES_URL } from '../../lib/releaseCheck';
import { AccountIdentitySection } from '../../components/settings/AccountIdentitySection';
import { AuthenticationSection } from '../../components/settings/AuthenticationSection';
import { BackupSection } from '../../components/settings/BackupSection';
import { ExternalConnectionsSection } from '../../components/settings/ExternalConnectionsSection';
import { OwnershipSettingsSection } from '../ownership/OwnershipSettingsSection';
import { JobsSection } from '../../components/settings/JobsSection';
import { PlacesSection } from '../../components/settings/PlacesSection';
import { ChargingSection } from '../../components/settings/ChargingSection';
import { AppearanceSection } from './AppearanceSection';
import { UnitsSection } from './UnitsSection';
import { ApiAccessSection } from './ApiAccessSection';
import { VehiclesSection } from './VehiclesSection';
import { SettingsDraftProvider, useSettingsDraft, useSettingsLeaveGuard } from './drafts/SettingsDraftProvider';
import { useStagedValue } from './drafts/useStagedValue';
import { saveFailure } from './drafts/saveFailure';
import { IMPERIAL_UNITS, METRIC_UNITS, sameUnitPreferences } from './unitPreferenceDrafts';
import { RawTelemetryExplorer } from '../../components/settings/RawTelemetryExplorer';
import { ChartManagerSection } from './charts/ChartManagerSection';
import { DashboardSettingsList, dashboardActionId } from './DashboardSettingsList';
import { IngestionDiagnosticsSection } from './IngestionCaptureSection';
import { canManageSystemDashboards } from '../../components/dashboard/DashboardPage';
import { useDashboardEditButtonPreference } from '../../components/dashboard/useDashboardEditButtonPreference';
import { PASSWORD_MIN_LENGTH, PasswordRequirements } from '../../components/auth/PasswordRequirements';
import {
  Car, ChartLine, CircleDollarSign, Clipboard, Database, DatabaseBackup, Globe2, KeyRound, ListChecks, Lock, LogOut, MapPin, Ruler, ShieldCheck, Zap,
} from 'lucide-react';

type SettingsSection = 'vehicles' | 'dashboards' | 'charts' | 'units' | 'places' | 'charging' | 'ownership' | 'external' | 'api' | 'jobs' | 'raw' | 'backup' | 'appearance' | 'account' | 'authentication';

const baseSections: Array<{ id: SettingsSection; label: string; icon: React.ElementType }> = [
  { id: 'vehicles', label: 'Vehicles', icon: Car },
  { id: 'dashboards', label: 'Dashboards', icon: Clipboard },
  { id: 'charts', label: 'Charts', icon: ChartLine },
  { id: 'units', label: 'Units', icon: Ruler },
  { id: 'places', label: 'Places', icon: MapPin },
  { id: 'charging', label: 'Charging', icon: Zap },
  { id: 'ownership', label: 'Ownership', icon: CircleDollarSign },
  { id: 'external', label: 'External Connections', icon: Globe2 },
  { id: 'api', label: 'API Access', icon: KeyRound },
  { id: 'jobs', label: 'Jobs', icon: ListChecks },
  { id: 'raw', label: 'Raw Data', icon: Database },
  { id: 'appearance', label: 'Appearance', icon: ShieldCheck },
  { id: 'account', label: 'Account', icon: LogOut },
];

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
    const cloned = await cloneDashboard.mutateAsync(dashboardActionId(dashboard));
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

type SettingsContentProps = { initialSection?: SettingsSection; oidcFeedback?: string; oidcFeedbackKind?: 'success' | 'error' };

export function SettingsContent(props: SettingsContentProps = {}) {
  return (
    <SettingsDraftProvider>
      <SettingsContentInner {...props} />
    </SettingsDraftProvider>
  );
}

function SettingsContentInner({ initialSection, oidcFeedback, oidcFeedbackKind }: SettingsContentProps) {
  const requestLeave = useSettingsLeaveGuard();
  const { accessToken, clearSession, logout, defaultVehicleId } = useAuth();
  const authReady = useAuthReady();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: vehicles } = useVehicles();
  const me = useMe();
  // Applied (saved) edit-button preference; the section stages edits in `editButtonDraft`.
  const [savedShowEditButton, setShowEditButton] = useDashboardEditButtonPreference(me.data?.user_id);
  // The URL is the only source of the open section, so any navigation to /settings (sidebar links,
  // back/forward, the renewal notice) shows the section it names, and a plain /settings shows Vehicles.
  const activeSection: SettingsSection = initialSection ?? 'vehicles';
  const [apiKeyName, setApiKeyName] = React.useState('Local troubleshooting');
  const [apiKeyVehicleId, setApiKeyVehicleId] = React.useState('');
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);
  const [apiCatalogSearch, setApiCatalogSearch] = React.useState('');
  // Device-local copies of the applied unit and time zone preferences, used until the server answers.
  const [localUnitPreferences, setLocalUnitPreferences] = React.useState<UnitPreferences>(() => getUnitPreferences());
  const [localAppTimezone, setLocalAppTimezone] = React.useState(() => getAppTimezone());
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmNewPassword, setConfirmNewPassword] = React.useState('');
  const [passwordChangeError, setPasswordChangeError] = React.useState('');
  const [changingPassword, setChangingPassword] = React.useState(false);
  const canCreateDemoVehicle = me.data?.role === 'admin' || me.data?.role === 'super_user';
  const [latestInviteToken, setLatestInviteToken] = React.useState<string | null>(null);
  const isAdmin = canManageSystemDashboards(me.data?.role);
  const canManageBackups = me.data?.role === 'admin' || me.data?.role === 'super_user';
  const canManageAuthentication = me.data?.role === 'super_user';
  const sections = React.useMemo(
    () => {
      const available = canManageBackups
        ? [...baseSections.slice(0, 6), { id: 'backup' as const, label: 'Backups', icon: DatabaseBackup }, ...baseSections.slice(6)]
        : [...baseSections];
      const withAuthentication = canManageAuthentication
        ? [...available, { id: 'authentication' as const, label: 'Authentication', icon: Lock }]
        : available;
      return withAuthentication.sort((left, right) => left.label.localeCompare(right.label));
    },
    [canManageAuthentication, canManageBackups],
  );

  function selectSettingsSection(next: SettingsSection) {
    if (next === activeSection) return;
    // Staged edits belong to the open section; save or discard them first. The navigation
    // itself changes the open section, through `initialSection`.
    requestLeave(() => {
      navigate({ to: '/settings', search: next === 'vehicles' ? {} : { section: next } });
    });
  }

  const appVersion = useQuery({
    queryKey: queryKeys.appVersion.current,
    queryFn: () => api.getAppVersion(),
    enabled: authReady && !!accessToken,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const runningVersionLabel = appVersion.isLoading
    ? 'Loading version…'
    : appVersion.data?.version && appVersion.data.version !== 'unknown'
      ? appVersion.data.version
      : 'Unknown version';
  const releaseCheck = useReleaseCheckStatus();
  const updateCheckSettings = useQuery({
    queryKey: queryKeys.updateCheck.current,
    queryFn: () => api.getUpdateCheckSettings(),
    enabled: authReady && !!accessToken,
    staleTime: 60_000,
    retry: false,
  });
  const versionSubtitle = releaseCheck.updateAvailable && releaseCheck.latestVersion
    ? `${releaseCheck.latestVersion} available`
    : releaseCheck.latestVersion
      ? 'Up to date'
      : updateCheckSettings.data?.enabled === false
        ? 'Update checks off'
        : releaseCheck.error
          ? 'Update check failed'
          : releaseCheck.checking || updateCheckSettings.data?.enabled
            ? 'Checking for updates…'
            : ' ';

  const apiKeys = useQuery({
    queryKey: queryKeys.apiKeys.all,
    queryFn: () => api.listApiKeys(),
    enabled: authReady && activeSection === 'api' && !!accessToken,
    retry: false,
  });

  const apiCatalog = useQuery({
    queryKey: queryKeys.apiCatalog.all,
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
        dashboardId: dashboardActionId(dashboard),
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
    queryKey: queryKeys.unitPreferences.current,
    queryFn: () => api.getUnitPreferences(),
    enabled: authReady && !!accessToken,
  });

  const appTimezoneQuery = useQuery({
    queryKey: queryKeys.appTimezone.current,
    queryFn: () => api.getAppTimezone(),
    enabled: authReady && !!accessToken,
  });

  React.useEffect(() => {
    const next = unitPreferencesQuery.data?.units;
    if (!next) return;
    setLocalUnitPreferences(next);
    setUnitPreferences(next);
  }, [unitPreferencesQuery.data]);

  React.useEffect(() => {
    const next = appTimezoneQuery.data?.timezone;
    if (!next) return;
    setLocalAppTimezone(next);
    setAppTimezone(next);
  }, [appTimezoneQuery.data]);

  React.useEffect(() => {
    if (!apiKeyVehicleId && vehicles?.[0]?.id) {
      setApiKeyVehicleId(vehicles[0].id);
    }
  }, [apiKeyVehicleId, vehicles]);

  const createApiKey = useMutation({
    mutationFn: () => api.createApiKey({
      vehicle_id: apiKeyVehicleId,
      name: apiKeyName,
    }),
    onSuccess: (result) => {
      setCreatedKey(result.key);
      queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all });
    },
  });

  const revokeApiKey = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all }),
  });

  const updateUnitPreferences = useMutation({
    mutationFn: (units: UnitPreferences) => api.updateUnitPreferences(units),
    scope: { id: 'settings-unit-preferences' },
    onSuccess: (result) => {
      setLocalUnitPreferences(result.units);
      setUnitPreferences(result.units);
      queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences.current });
    },
  });

  const updateAppTimezone = useMutation({
    mutationFn: (timezone: string) => api.updateAppTimezone(timezone),
    onSuccess: (result) => {
      setLocalAppTimezone(result.timezone);
      setAppTimezone(result.timezone);
      queryClient.invalidateQueries({ queryKey: queryKeys.appTimezone.current });
      queryClient.invalidateQueries({ queryKey: queryKeys.backups.all });
    },
  });

  // Units, time zone, and the edit-button preference are staged until the page bar saves them.
  // Each applies its device-local copy only after the server accepts the change.
  const savedUnitPreferences = unitPreferencesQuery.data?.units ?? localUnitPreferences;
  const unitsDraft = useStagedValue<UnitPreferences>(savedUnitPreferences, sameUnitPreferences);
  const unitPreferences = unitsDraft.value;
  const placesUnitSystem: UnitSystem = savedUnitPreferences.place_radius_unit === 'meters' ? 'metric' : 'imperial';
  const saveUnitsDraft = async () => {
    const next = unitsDraft.value;
    let result: Awaited<ReturnType<typeof api.updateUnitPreferences>>;
    try {
      result = await updateUnitPreferences.mutateAsync(next);
    } catch (error) {
      throw saveFailure(error, 'Units could not be saved. Try again.');
    }
    unitsDraft.commit(result.units, next);
  };
  useSettingsDraft('units-preferences', { isDirty: unitsDraft.isDirty, save: saveUnitsDraft, discard: unitsDraft.reset });

  const savedAppTimezone = appTimezoneQuery.data?.timezone ?? localAppTimezone;
  const timezoneDraft = useStagedValue<string>(savedAppTimezone);
  const appTimezone = timezoneDraft.value;
  const saveTimezoneDraft = async () => {
    const next = timezoneDraft.value;
    let result: Awaited<ReturnType<typeof api.updateAppTimezone>>;
    try {
      result = await updateAppTimezone.mutateAsync(next);
    } catch (error) {
      throw saveFailure(error, 'The application time zone could not be saved. Try again.');
    }
    timezoneDraft.commit(result.timezone, next);
  };
  useSettingsDraft('app-timezone', { isDirty: timezoneDraft.isDirty, save: saveTimezoneDraft, discard: timezoneDraft.reset });

  const editButtonDraft = useStagedValue<boolean>(savedShowEditButton);
  useSettingsDraft('dashboard-edit-button', {
    isDirty: editButtonDraft.isDirty,
    save: async () => {
      setShowEditButton(editButtonDraft.value);
      editButtonDraft.commit(editButtonDraft.value);
    },
    discard: editButtonDraft.reset,
  });

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
    // navigator.clipboard is undefined on plain-HTTP LAN origins.
    if (createdKey) await navigator.clipboard?.writeText(createdKey);
  }

  function handleUnitModeChange(nextMode: UnitMode) {
    unitsDraft.setValue((current): UnitPreferences =>
      nextMode === 'imperial'
        ? { ...IMPERIAL_UNITS }
        : nextMode === 'metric'
          ? { ...METRIC_UNITS }
          : { ...current, mode: 'custom' });
  }

  function handleCustomUnitChange<K extends keyof UnitPreferences>(key: K, value: UnitPreferences[K]) {
    unitsDraft.setValue((current): UnitPreferences => ({ ...current, mode: 'custom', [key]: value }));
  }

  return (
    <AppLayout activeKey="settings">
      <PageLayout
        title="Settings"
        subtitle="Account, vehicle, and API controls for local troubleshooting."
        actions={(
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${runningVersionLabel}. ${versionSubtitle}. View GitHub releases`}
            title="View GitHub releases"
            className="rounded-md text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="block font-mono text-2xl font-semibold font-display tracking-tight text-fg">
              {runningVersionLabel}
            </span>
            <span className={`mt-0.5 block text-sm ${releaseCheck.updateAvailable ? 'text-status-warning' : 'text-fg-tertiary'}`}>
              {versionSubtitle}
            </span>
          </a>
        )}
      >
        {oidcFeedback && (
          <p
            role={oidcFeedbackKind === 'error' ? 'alert' : 'status'}
            className={`mb-4 rounded-lg border px-3 py-2 text-sm ${oidcFeedbackKind === 'error' ? 'border-status-warning/30 bg-status-warning/10 text-status-warning' : 'border-status-positive/30 bg-status-positive/10 text-status-positive'}`}
          >
            {oidcFeedback}
          </p>
        )}
        <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <div className="rounded-xl border border-accent/30 bg-accent/10 p-3 shadow-sm lg:hidden">
            <label
              className="mb-2 block text-xs font-semibold uppercase tracking-wider text-fg-secondary"
              htmlFor="settings-section-picker"
            >
              Settings section
            </label>
            <SelectPicker<SettingsSection>
              id="settings-section-picker"
              value={activeSection}
              onChange={selectSettingsSection}
              aria-label="Settings section"
              className="w-full"
              triggerClassName="min-h-11 border-accent bg-bg-surface text-fg shadow-sm focus-visible:ring-2 focus-visible:ring-accent"
              menuClassName="w-full border-accent bg-bg-surface shadow-lg"
              options={sections.map((section) => ({ value: section.id, label: section.label }))}
            />
          </div>

          <nav className="hidden gap-2 lg:flex lg:flex-col" aria-label="Settings sections">
            {sections.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => selectSettingsSection(section.id)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    active
                      ? 'bg-accent-muted text-accent'
                      : 'text-fg-secondary hover:bg-bg-elevated/70 hover:text-fg',
                  ].join(' ')}
                >
                  <Icon className="h-4 w-4" />
                  <span>{section.label}</span>
                  {active && <span className="ml-auto h-4 w-1 rounded-full bg-accent" aria-hidden="true" />}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0">
            {activeSection === 'vehicles' && (
              <VehiclesSection
                vehicles={vehicles}
                defaultVehicleId={defaultVehicleId}
                currentUserId={me.data?.user_id}
                isAdmin={isAdmin}
                canCreateDemoVehicle={canCreateDemoVehicle}
                latestInviteToken={latestInviteToken}
                onLatestInviteTokenChange={setLatestInviteToken}
              />
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
                showEditButton={editButtonDraft.value}
                onShowEditButtonChange={editButtonDraft.setValue}
                onCustomize={customizeDashboard}
                onEdit={openDashboard}
              />
            )}

            {activeSection === 'charts' && <ChartManagerSection />}

            {activeSection === 'api' && (
              <ApiAccessSection
                vehicles={vehicles}
                apiKeys={apiKeys}
                apiCatalog={apiCatalog}
                apiKeyName={apiKeyName}
                onApiKeyNameChange={setApiKeyName}
                apiKeyVehicleId={apiKeyVehicleId}
                onApiKeyVehicleIdChange={setApiKeyVehicleId}
                createdKey={createdKey}
                onCopyCreatedKey={copyCreatedKey}
                createPending={createApiKey.isPending}
                onCreate={() => createApiKey.mutate()}
                revokePending={revokeApiKey.isPending}
                onRevoke={(keyId) => revokeApiKey.mutate(keyId)}
                apiCatalogSearch={apiCatalogSearch}
                onApiCatalogSearchChange={setApiCatalogSearch}
                filteredApiEndpoints={filteredApiEndpoints}
              />
            )}

            {activeSection === 'units' && (
              <UnitsSection
                unitPreferences={unitPreferences}
                onUnitModeChange={handleUnitModeChange}
                onCustomUnitChange={handleCustomUnitChange}
                appTimezone={appTimezone}
                onAppTimezoneChange={(value) => timezoneDraft.setValue(value)}
                appTimezoneDisabled={!canManageBackups || updateAppTimezone.isPending || appTimezoneQuery.isLoading}
                canManageBackups={canManageBackups}
              />
            )}

            {activeSection === 'places' && <PlacesSection unitSystem={placesUnitSystem} />}

            {activeSection === 'charging' && <ChargingSection />}

            {activeSection === 'ownership' && <OwnershipSettingsSection vehicles={vehicles ?? []} />}

            {activeSection === 'external' && <ExternalConnectionsSection />}

            {activeSection === 'backup' && canManageBackups && <BackupSection />}

            {activeSection === 'jobs' && <JobsSection vehicles={vehicles ?? []} />}

            {activeSection === 'raw' && (
              <div className="grid gap-6">
                <IngestionDiagnosticsSection vehicles={vehicles ?? []} />
                <RawTelemetryExplorer vehicles={vehicles ?? []} isAdmin={isAdmin} />
              </div>
            )}

            {activeSection === 'appearance' && <AppearanceSection preferencesQuery={unitPreferencesQuery} />}

            {activeSection === 'account' && (
              <Card>
                <CardHeader>
                  <CardTitle>Account</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-6">
                  <AccountIdentitySection />
                  <div className="border-t border-border pt-5" />
                  {me.data?.password_configured !== false && <form className="grid max-w-md gap-4" onSubmit={handlePasswordChange}>
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
                  </form>}
                  <div className="border-t border-border pt-5">
                    <Button variant="danger" size="sm" iconLeft={<LogOut className="h-3.5 w-3.5" />}
                      onClick={handleLogout}>
                      Sign Out
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeSection === 'authentication' && canManageAuthentication && <AuthenticationSection />}
          </div>
        </div>
      </PageLayout>
    </AppLayout>
  );
}
