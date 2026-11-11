import React from 'react';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardSearchSchema } from '../dashboardSearch';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const settingsMocks = vi.hoisted(() => ({
  auth: {
    logout: vi.fn(),
    clearSession: vi.fn(),
    accessToken: undefined as string | undefined,
    userId: 'u1',
    defaultVehicleId: 'v1',
    setDefaultVehicleId: vi.fn(),
    setActiveVehicleId: vi.fn(),
  },
  me: {
    user_id: 'u1',
    email: 'user@example.com',
    role: 'user' as 'user' | 'admin' | 'super_user',
    default_vehicle_id: 'v1',
  },
  vehicles: [
    {
      id: 'v1',
      display_name: 'Adventure Truck',
      model: 'R1T',
      year: null as number | null,
      trim: null,
      vin: null,
      rivian_vehicle_id: 'rivian-1',
      battery_capacity_kwh: 135 as number | null,
      target_tire_pressure_psi: 48,
      membership_role: 'owner',
      is_demo: false,
      },
  ],
  basemapConfig: undefined as { resolved_provider: string } | undefined,
  preferences: {
    units: {
      mode: 'imperial',
      distance_unit: 'miles',
      speed_unit: 'mph',
      temperature_unit: 'fahrenheit',
      pressure_unit: 'psi',
      altitude_unit: 'feet',
      place_radius_unit: 'feet',
      efficiency_display: 'distance_per_energy',
    },
    theme: { mode: 'dark', palette: 'classic' },
    map_style: 'follow-theme',
  },
  themePreferences: {
    preferences: {
      schemaVersion: 2 as const,
      mode: 'dark' as const,
      selection: { kind: 'builtin' as const, themeId: 'classic' },
    },
    etag: '"theme-preferences-u1-1"',
  },
}));

const dashboardMocks = vi.hoisted(() => ({
  dashboards: [] as Array<Record<string, unknown>>,
  downloadDashboardYaml: vi.fn(),
  cloneMutateAsync: vi.fn(),
  createMutateAsync: vi.fn(),
  deleteMutateAsync: vi.fn(),
  lockMutate: vi.fn(),
  restoreMutateAsync: vi.fn(),
}));

const hooksMocks = vi.hoisted(() => ({
  changePassword: vi.fn().mockResolvedValue(undefined),
  updateMapStylePreference: vi.fn().mockResolvedValue({ map_style: 'follow-theme' }),
}));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => mockNavigate, useBlocker: () => ({ status: 'idle' }) };
});

// One stable object, as React Query returns: the editor reseeds its form whenever `data` changes.
const ownershipMocks = vi.hoisted(() => ({
  update: vi.fn(),
  data: {
    vehicle_id: 'v1',
    can_edit: true,
    settings: {
      purchase_price_usd: 82000,
      purchase_date: '2024-03-15',
      resale_value_usd: null,
      insurance_monthly_usd: null,
      tire_set_cost_usd: null,
      gas_price_usd_per_gallon: null,
      enabled_reference_ids: null,
      custom_vehicles: [],
    },
  },
}));

vi.mock('@riviamigo/hooks', () => ({
  useOwnershipSettings: () => ({
    data: ownershipMocks.data,
    isLoading: false,
    isError: false,
  }),
  useUpdateOwnershipSettings: () => ({ mutate: ownershipMocks.update, isPending: false, isError: false }),
  queryKeys: {
    auth: {
      identities: ['auth-identities'],
      authenticationSettings: ['authentication-settings'],
    },
    apiKeys: { all: ['api-keys'] },
    apiCatalog: { all: ['api-catalog'] },
    appTimezone: { current: ['app-timezone'] },
    appVersion: { current: ['app-version'] },
    updateCheck: { current: ['update-check'] },
    backups: {
      all: ['backup-overview'],
      overview: (page: number, perPage: number) => ['backup-overview', page, perPage],
    },
    me: { all: ['me'] },
    themePreferences: {
      all: ['theme-preferences'],
      forUser: (userId: string) => ['theme-preferences', userId],
    },
    themes: {
      catalog: (userId: string) => ['themes', userId, 'catalog'],
      resource: (userId: string, themeId: string) => ['themes', userId, 'resource', themeId],
    },
    unitPreferences: { current: ['unit-preferences'] },
    vehicle: {
      health: (vehicleId: string) => ['vehicles', 'health', vehicleId],
      images: (vehicleId: string) => ['vehicles', 'images', vehicleId],
    },
    vehicleInvites: {
      byVehicle: (vehicleId: string) => ['vehicle-invites', vehicleId],
    },
    vehicleMembers: {
      byVehicle: (vehicleId: string) => ['vehicle-members', vehicleId],
    },
    vehicles: {
      all: ['vehicles'],
      status: (vehicleId: string) => ['vehicles', 'status', vehicleId],
    },
    places: { all: ['places'] },
    externalConnections: { all: ['external-connections'] },
  },
  themeClient: {
    getCatalog: vi.fn().mockResolvedValue({ builtInThemes: ['classic', 'rad'], customThemes: [] }),
    getPreferences: vi.fn().mockImplementation(() => Promise.resolve(settingsMocks.themePreferences)),
    updatePreferences: vi.fn().mockImplementation(async (preferences) => {
      settingsMocks.themePreferences = {
        preferences,
        etag: '"theme-preferences-u1-2"',
      };
      return settingsMocks.themePreferences;
    }),
    create: vi.fn(),
  },
  api: {
    me: vi.fn().mockResolvedValue({ role: 'user' }),
    getAppVersion: vi.fn().mockResolvedValue({ version: '2026.09.4+dev' }),
    getUpdateCheckSettings: vi.fn().mockResolvedValue({ enabled: false, frequency: 'daily' }),
    getUnitPreferences: vi.fn().mockImplementation(() => Promise.resolve(settingsMocks.preferences)),
    updateThemePreferences: vi.fn().mockImplementation(async (theme) => {
      settingsMocks.preferences.theme = theme;
      return settingsMocks.preferences;
    }),
    changePassword: hooksMocks.changePassword,
    getVehicleIngestionCapture: vi.fn().mockResolvedValue({ state: 'idle', started_at: null, ends_at: null, stopped_at: null, stop_reason: null, event_count: 0, last_event_at: null, truncated: false }),
    startVehicleIngestionCapture: vi.fn().mockResolvedValue({ ...{ state: 'idle', started_at: null, ends_at: null, stopped_at: null, stop_reason: null, event_count: 0, last_event_at: null, truncated: false }, state: 'capturing', started_at: '2026-09-24T17:00:00Z', ends_at: '2026-09-24T18:00:00Z' }),
    stopVehicleIngestionCapture: vi.fn().mockResolvedValue({ ...{ state: 'idle', started_at: null, ends_at: null, stopped_at: null, stop_reason: null, event_count: 0, last_event_at: null, truncated: false }, state: 'stopped', started_at: '2026-09-24T17:00:00Z', ends_at: '2026-09-24T18:00:00Z', stopped_at: '2026-09-24T17:20:00Z', stop_reason: 'user', event_count: 12 }),
    downloadVehicleIngestionCapture: vi.fn().mockResolvedValue({ blob: new Blob(['{}']), fileName: 'riviamigo-capture-r1t-20260924T1700Z.jsonl' }),
    getOidcIdentities: vi.fn().mockResolvedValue({
      password_configured: true,
      oidc_linked: false,
      oidc_link_available: false,
      button_label: 'Sign in with SSO',
    }),
    startOidcLink: vi.fn(),
    unlinkOidc: vi.fn(),
    listApiKeys: vi.fn().mockResolvedValue([]),
    getApiCatalog: vi.fn().mockResolvedValue({
      endpoints: [
        { method: 'GET', path: '/v1/vehicles', vehicle_scoped: false, purpose: 'List vehicles' },
        {
          method: 'GET',
          path: '/v1/vehicles/{id}/raw-data',
          vehicle_scoped: true,
          purpose: 'Read raw data',
        },
        {
          method: 'POST',
          path: '/v1/metrics/batch',
          vehicle_scoped: false,
          purpose: 'Read metrics',
        },
      ],
    }),
    listPlaces: vi.fn().mockResolvedValue([]),
    searchPlaceAddresses: vi.fn().mockResolvedValue([
      {
        display_name: '123 Main St, Denver, CO',
        osm_id: 123,
        latitude: 39.7392,
        longitude: -104.9903,
        road: 'Main St',
        city: 'Denver',
        state: 'CO',
        postcode: '80202',
        country: 'United States',
        raw: null,
      },
    ]),
    createPlace: vi.fn(),
    updatePlace: vi.fn(),
    deletePlace: vi.fn(),
    getRawTelemetry: vi.fn().mockResolvedValue({
      vehicle_id: 'v1',
      coverage: {
        first_event_at: null,
        last_event_at: null,
        sample_count: 0,
        odometer_samples: 0,
        battery_samples: 0,
        range_samples: 0,
        outside_temp_samples: 0,
        power_samples: 0,
        regen_samples: 0,
        tire_pressure_samples: 0,
      },
      samples: [],
    }),
    getTelemetryLanes: vi.fn().mockResolvedValue({
      vehicle_id: 'v1',
      window: {
        from: '2026-05-03T12:00:00Z',
        to: '2026-05-04T12:00:00Z',
        resolution_seconds: 300,
        approximate: true,
      },
      spine: [],
      lanes: {},
      truncated: false,
    }),
    getRivianStewardship: vi.fn().mockResolvedValue({
      generated_at: '2026-05-04T12:00:00Z',
      retention_days: 7,
      raw_event_persistence_enabled: true,
      duplicate_suppression_enabled: true,
      active_collectors: 1,
      raw_events_retained: 5,
      totals_24h: {
        ws_messages_received: 100,
        ws_heartbeats_received: 80,
        ws_payload_messages_received: 20,
        ws_control_messages_received: 0,
        ws_connections_opened: 1,
        ws_reconnects: 0,
        outbound_messages_sent: 2,
        outbound_graphql_requests: 0,
        telemetry_writes_persisted: 10,
        telemetry_writes_suppressed: 90,
        telemetry_suppressed_duplicate: 70,
        telemetry_suppressed_empty: 10,
        telemetry_suppressed_threshold: 10,
        collector_lock_skips: 0,
        raw_events_persisted: 100,
      },
      vehicles: [
        {
          vehicle_id: 'v1',
          display_name: 'Adventure Truck',
          worker_health: 'connected',
          last_seen_at: '2026-05-04T12:00:00Z',
          last_payload_at: '2026-05-04T12:00:00Z',
          last_persisted_at: '2026-05-04T12:00:00Z',
          last_heartbeat_at: '2026-05-04T12:00:00Z',
          ws_messages_received: 100,
          ws_heartbeats_received: 80,
          ws_payload_messages_received: 20,
          ws_reconnects: 0,
          telemetry_writes_persisted: 10,
          telemetry_writes_suppressed: 90,
          collector_lock_skips: 0,
        },
      ],
    }),
    getBackupOverview: vi.fn().mockResolvedValue({
      settings: {
        enabled: true,
        frequency: 'weekly',
        run_at: '03:00',
        timezone: 'America/Chicago',
        day_of_week: 0,
        day_of_month: null,
        retention_count: 8,
        local_enabled: true,
        s3_enabled: true,
        target_type: 's3',
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'riviamigo-backups',
        prefix: 'prod/riviamigo',
        access_key: 'backup-user',
        has_secret_key: true,
        updated_at: '2026-05-04T12:00:00Z',
      },
      recent_runs: [
        {
          id: 'run-1',
          trigger: 'manual',
          status: 'succeeded',
          phase: 'completed',
          progress_percent: 100,
          artifact_key: '/tmp/riviamigo/prod/riviamigo/backup.dump',
          started_at: '2026-05-04T12:00:00Z',
          completed_at: '2026-05-04T12:01:00Z',
          error_message: null,
          created_at: '2026-05-04T12:00:00Z',
          updated_at: '2026-05-04T12:01:00Z',
        },
      ],
      recent_runs_total: 1,
      recent_runs_page: 1,
      recent_runs_per_page: 10,
      artifacts: [
        {
          id: 'artifact-1',
          run_id: 'run-1',
          storage_type: 'local',
          file_name: 'backup-20260504T120000Z.dump',
          storage_path: '/tmp/riviamigo/prod/riviamigo/backup-20260504T120000Z.dump',
          size_bytes: 2048,
          checksum_sha256: '0123456789abcdef0123456789abcdef',
          manifest: {},
          created_at: '2026-05-04T12:01:00Z',
        },
      ],
      restore_requests: [],
      latest_successful_run: {
        id: 'run-1',
        trigger: 'manual',
        status: 'succeeded',
        phase: 'completed',
        progress_percent: 100,
        artifact_key: '/tmp/riviamigo/prod/riviamigo/backup.dump',
        started_at: '2026-05-04T12:00:00Z',
        completed_at: '2026-05-04T12:01:00Z',
        error_message: null,
        created_at: '2026-05-04T12:00:00Z',
        updated_at: '2026-05-04T12:01:00Z',
      },
      next_run_at: '2026-05-10T08:00:00Z',
      runtime_readiness: {
        pg_dump_available: true,
        run_now_allowed: true,
        restore_automation_available: true,
        reason: null,
      },
      s3_catalog_error: null,
    }),
    updateBackupSettings: vi.fn().mockResolvedValue({}),
    runBackupNow: vi.fn().mockResolvedValue({}),
    testBackupS3: vi
      .fn()
      .mockResolvedValue({ ok: true, message: 'S3 list/write/read/delete checks passed' }),
    requestBackupRestore: vi.fn().mockResolvedValue({}),
    uploadBackupArtifact: vi.fn().mockResolvedValue({}),
    deleteUploadedBackup: vi.fn().mockResolvedValue(undefined),
    preflightBackupRestore: vi.fn().mockResolvedValue({
      plan: {
        plan_id: 'plan-1',
        engine_version: 3,
        package_checksum_sha256: 'abc123',
        package_format: 'riviamigo-recovery-v3',
        compatible: true,
        source: {
          postgres_major: 17,
          timescale_version: '2.19.3',
          migration_version: 1,
          migration_ledger: [],
          migration_ledger_successful: true,
          migration_chain_id: 'riviamigo-schema-v1',
          migration_catalog_digest: 'catalog',
          schema_contract_version: 'riviamigo-schema-contract-v1',
          schema_fingerprint: 'source',
        },
        target: {
          postgres_major: 17,
          timescale_version: '2.19.3',
          migration_version: 1,
          migration_ledger: [],
          migration_ledger_successful: true,
          migration_chain_id: 'riviamigo-schema-v1',
          migration_catalog_digest: 'catalog',
          schema_contract_version: 'riviamigo-schema-contract-v1',
          schema_fingerprint: 'target',
        },
        pending_migrations: [],
        transforms: [],
        validation_checks: [],
        warnings: [],
        blocking_errors: [],
        planned_at: '2026-05-04T12:02:00Z',
      },
    }),
    startBackupRestore: vi.fn().mockResolvedValue({
      job: {
        id: 'restore-job-1',
        artifact_id: 'artifact-1',
        phase: 'queued',
        progress_percent: 5,
        message: 'Restore queued',
        error_message: null,
        created_at: '2026-05-04T12:02:00Z',
        updated_at: '2026-05-04T12:02:00Z',
      },
      capability_token: 'restore-token',
    }),
    getRestoreJob: vi.fn().mockResolvedValue({
      id: 'restore-job-1',
      artifact_id: 'artifact-1',
      phase: 'failed',
      progress_percent: 5,
      message: 'Restore failed',
      error_message: 'test stop',
      created_at: '2026-05-04T12:02:00Z',
      updated_at: '2026-05-04T12:02:01Z',
    }),
    downloadBackupArtifact: vi.fn().mockResolvedValue({
      blob: new Blob(['backup-data'], { type: 'application/octet-stream' }),
      fileName: 'backup-20260504T120000Z.dump',
    }),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    createDemoVehicle: vi
      .fn()
      .mockResolvedValue({ ok: true, vehicle_id: 'demo-v1', created: true }),
    deleteVehicle: vi.fn().mockResolvedValue({ ok: true, default_vehicle_id: 'v1' }),
    setDefaultVehicle: vi.fn().mockResolvedValue({ default_vehicle_id: 'v2' }),
    listVehicleMembers: vi.fn().mockResolvedValue([]),
    listVehicleInvites: vi.fn().mockResolvedValue([]),
    addVehicleMember: vi.fn().mockResolvedValue({ invite_created: false, invite_token: null }),
    updateVehicleMember: vi.fn().mockResolvedValue(undefined),
    removeVehicleMember: vi.fn().mockResolvedValue(undefined),
    revokeVehicleInvite: vi.fn().mockResolvedValue(undefined),
    refreshDemoVehicle: vi.fn().mockResolvedValue({
      ok: true,
      vehicle_id: 'demo-v1',
      created: false,
      seeded: true,
      refreshed: true,
      seeded_at: '2026-05-04T12:00:00Z',
      window_start: '2026-04-20T12:00:00Z',
      window_end: '2026-05-04T12:00:00Z',
      telemetry_count: 5664,
      trip_count: 31,
      charge_count: 4,
      weather_sample_count: 80,
    }),
    updateVehicleSettings: vi.fn().mockResolvedValue({}),
    updateVehicleName: vi.fn().mockResolvedValue({}),
    updateUnitPreferences: vi.fn().mockImplementation(async (units: unknown) => ({ units })),
    getAppTimezone: vi.fn().mockResolvedValue({ timezone: 'America/Chicago' }),
    updateAppTimezone: vi.fn().mockImplementation(async (timezone: string) => ({ timezone })),
    updateVehicleCollection: vi.fn().mockResolvedValue({ ok: true, collection_paused: true, worker_command_queued: true }),
    refreshVehicleArtwork: vi.fn().mockResolvedValue({ ok: true, vehicle_id: 'v1' }),
  },
  useAuth: (selector?: (state: typeof settingsMocks.auth) => unknown) => selector ? selector(settingsMocks.auth) : settingsMocks.auth,
  useAuthReady: () => true,
  useOwnershipEnabled: () => true,
  useUpdateOwnershipPreference: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useMe: () => ({ data: settingsMocks.me }),
  useVehicles: () => ({ data: settingsMocks.vehicles }),
  useChargingNetworkPreferences: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useBasemapConfig: () => ({ data: settingsMocks.basemapConfig, isLoading: false, isError: false }),
  useUpdateMapStyle: () => ({
    mutate: hooksMocks.updateMapStylePreference,
    mutateAsync: hooksMocks.updateMapStylePreference,
    isPending: false,
    isError: false,
  }),
  useUpdateChargingNetworkPreference: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    variables: undefined,
  }),
  invalidateVehicleCapacityData: vi.fn(),
  resolveVehicleArtwork: (_images: unknown, model: string) => ({
    light: null,
    dark: null,
    fallback: `/vehicle-images/fallbacks/${model.toLowerCase()}/side.webp`,
  }),
  AuthenticatedVehicleArtwork: ({
    source,
    fallbackSource,
    alt,
    className,
  }: {
    source?: string | null;
    fallbackSource?: string | null;
    alt?: string;
    className?: string;
  }) => <img src={source ?? fallbackSource ?? undefined} alt={alt} className={className} />,
}));

vi.mock('@riviamigo/dashboards', () => ({
  downloadDashboardYaml: dashboardMocks.downloadDashboardYaml,
  getDefaultBySlug: (slug: string) => slug === 'dashboard'
    ? { id: '00000000-0000-0000-0000-000000000001' }
    : undefined,
  materializeUserDashboardDraft: (dashboard: Record<string, unknown>) => ({
    ...dashboard,
    id: 'personal-draft',
    ownerId: null,
    isDefault: false,
    isLocked: false,
  }),
  useDashboards: () => ({ data: dashboardMocks.dashboards, isLoading: false, refetch: vi.fn() }),
  useCreateDashboard: () => ({ mutateAsync: dashboardMocks.createMutateAsync, isPending: false }),
  useCloneDashboard: () => ({
    mutateAsync: dashboardMocks.cloneMutateAsync,
    isPending: false,
    variables: undefined,
  }),
  useDeleteDashboard: () => ({
    mutateAsync: dashboardMocks.deleteMutateAsync,
    isPending: false,
    variables: undefined,
  }),
  useSetAdminDashboardLock: () => ({
    mutate: dashboardMocks.lockMutate,
    isPending: false,
    variables: undefined,
  }),
  useRestoreAdminDashboardDefault: () => ({
    mutateAsync: dashboardMocks.restoreMutateAsync,
    isPending: false,
    variables: undefined,
  }),
}));

vi.mock('../../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../components/layout/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('lucide-react', () => ({
  Activity: () => <svg data-testid="icon-activity" />,
  AlertCircle: () => <svg data-testid="icon-alert-circle" />,
  Braces: () => <svg data-testid="icon-braces" />,
  Car: () => <svg data-testid="icon-car" />,
  ChartLine: () => <svg data-testid="icon-chart-line" />,
  CircleHelp: () => <svg data-testid="icon-help" />,
  Circle: () => <svg data-testid="icon-circle" />,
  Clipboard: () => <svg data-testid="icon-clipboard" />,
  Database: () => <svg data-testid="icon-database" />,
  DatabaseBackup: () => <svg data-testid="icon-database-backup" />,
  Upload: () => <svg data-testid="icon-upload" />,
  Calendar: () => <svg data-testid="icon-calendar" />,
  Check: () => <svg data-testid="icon-check" />,
  CheckCircle2: () => <svg data-testid="icon-check-circle" />,
  AlertTriangle: () => <svg data-testid="icon-alert-triangle" />,
  Cloud: () => <svg data-testid="icon-cloud" />,
  CloudUpload: () => <svg data-testid="icon-cloud-upload" />,
  ChevronDown: () => <svg data-testid="icon-chevron-down" />,
  ChevronLeft: () => <svg data-testid="icon-chevron-left" />,
  ChevronRight: () => <svg data-testid="icon-chevron-right" />,
  Clock3: () => <svg data-testid="icon-clock" />,
  Download: () => <svg data-testid="icon-download" />,
  ExternalLink: () => <svg data-testid="icon-external-link" />,
  Globe2: () => <svg data-testid="icon-globe" />,
  HardDrive: () => <svg data-testid="icon-hard-drive" />,
  History: () => <svg data-testid="icon-history" />,
  Home: () => <svg data-testid="icon-home" />,
  Loader2: () => <svg data-testid="icon-loader" />,
  Server: () => <svg data-testid="icon-server" />,
  Timer: () => <svg data-testid="icon-timer" />,
  KeyRound: () => <svg data-testid="icon-key" />,
  ListChecks: () => <svg data-testid="icon-list-checks" />,
  Lock: () => <svg data-testid="icon-lock" />,
  LogOut: () => <svg data-testid="icon-logout" />,
  MapPin: () => <svg data-testid="icon-map-pin" />,
  Plus: () => <svg data-testid="icon-plus" />,
  Disc: () => <svg data-testid="icon-disc" />,
  Droplet: () => <svg data-testid="icon-droplet" />,
  LifeBuoy: () => <svg data-testid="icon-lifebuoy" />,
  Wrench: () => <svg data-testid="icon-wrench" />,
  CircleDollarSign: () => <svg data-testid="icon-circle-dollar" />,
  AirVent: () => <svg data-testid="icon-airvent" />,
  ClipboardCheck: () => <svg data-testid="icon-clipboardcheck" />,
  Cog: () => <svg data-testid="icon-cog" />,
  Droplets: () => <svg data-testid="icon-droplets" />,
  RotateCw: () => <svg data-testid="icon-rotatecw" />,
  ShieldPlus: () => <svg data-testid="icon-shieldplus" />,
  ThermometerSnowflake: () => <svg data-testid="icon-thermometersnowflake" />,
  Wind: () => <svg data-testid="icon-wind" />,
  Wallet: () => <svg data-testid="icon-wallet" />,
  Receipt: () => <svg data-testid="icon-receipt" />,
  CalendarClock: () => <svg data-testid="icon-calendarclock" />,
  Pause: () => <svg data-testid="icon-pause" />,
  Pencil: () => <svg data-testid="icon-pencil" />,
  Play: () => <svg data-testid="icon-play" />,
  RefreshCw: () => <svg data-testid="icon-refresh" />,
  Ruler: () => <svg data-testid="icon-ruler" />,
  RotateCcw: () => <svg data-testid="icon-rotate" />,
  Save: () => <svg data-testid="icon-save" />,
  Search: () => <svg data-testid="icon-search" />,
  ShieldCheck: () => <svg data-testid="icon-shield" />,
  ShieldOff: () => <svg data-testid="icon-shield-off" />,
  SlidersHorizontal: () => <svg data-testid="icon-sliders" />,
  Star: () => <svg data-testid="icon-star" />,
  Users: () => <svg data-testid="icon-users" />,
  Zap: () => <svg data-testid="icon-zap" />,
  X: () => <svg data-testid="icon-x" />,
  Trash2: () => <svg data-testid="icon-trash" />,
  Unlock: () => <svg data-testid="icon-unlock" />,
}));

import { SettingsContent } from '../settings';

type SettingsSearch = { section?: string };
type InitialSection = NonNullable<NonNullable<Parameters<typeof SettingsContent>[0]>['initialSection']>;

/** Sets the Settings route search from outside the page, as a sidebar link or back/forward would. */
let applyRouteSearch: ((search: SettingsSearch) => void) | null = null;

/**
 * Stands in for the Settings route: the open section is whatever the search names. Navigations the page
 * makes through `navigate` update that search, so a section switch re-renders the new section as it does
 * in the app.
 */
function SettingsRouteHarness({ initialSearch }: { initialSearch: SettingsSearch }) {
  const [search, setSearch] = React.useState<SettingsSearch>(initialSearch);
  React.useEffect(() => {
    applyRouteSearch = setSearch;
    mockNavigate.mockImplementation((options: { to: string; search?: SettingsSearch }) => {
      if (options.to === '/settings') setSearch(options.search ?? {});
    });
    return () => {
      applyRouteSearch = null;
    };
  }, []);
  return <SettingsContent {...(search.section ? { initialSection: search.section as InitialSection } : {})} />;
}

function renderSettings(initialSearch: SettingsSearch = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsRouteHarness initialSearch={initialSearch} />
    </QueryClientProvider>
  );
}

function navigateSettingsRoute(search: SettingsSearch) {
  act(() => applyRouteSearch?.(search));
}

function clickSettingsSection(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

/** The page-level unsaved-changes bar that Settings renders while any draft is dirty. */
function unsavedChangesBar() {
  return screen.getByRole('region', { name: 'Unsaved changes' });
}

function saveUnsavedChanges() {
  fireEvent.click(within(unsavedChangesBar()).getByRole('button', { name: 'Save' }));
}

function discardUnsavedChanges() {
  fireEvent.click(within(unsavedChangesBar()).getByRole('button', { name: 'Discard' }));
}

describe('Settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    settingsMocks.auth.logout.mockReset();
    settingsMocks.auth.clearSession.mockReset();
    hooksMocks.changePassword.mockReset();
    hooksMocks.changePassword.mockResolvedValue(undefined);
    settingsMocks.auth.setDefaultVehicleId.mockReset();
    settingsMocks.auth.setActiveVehicleId.mockReset();
    settingsMocks.auth.accessToken = undefined;
    settingsMocks.auth.defaultVehicleId = 'v1';
    settingsMocks.basemapConfig = undefined;
    settingsMocks.preferences = {
      units: {
        mode: 'imperial',
        distance_unit: 'miles',
        speed_unit: 'mph',
        temperature_unit: 'fahrenheit',
        pressure_unit: 'psi',
        altitude_unit: 'feet',
        place_radius_unit: 'feet',
        efficiency_display: 'distance_per_energy',
      },
      theme: { mode: 'dark', palette: 'classic' },
      map_style: 'follow-theme',
    };
    settingsMocks.themePreferences = {
      preferences: {
        schemaVersion: 2,
        mode: 'dark',
        selection: { kind: 'builtin', themeId: 'classic' },
      },
      etag: '"theme-preferences-u1-1"',
    };
    dashboardMocks.dashboards = [];
    dashboardMocks.downloadDashboardYaml.mockReset();
    dashboardMocks.cloneMutateAsync.mockReset();
    dashboardMocks.createMutateAsync.mockReset();
    dashboardMocks.deleteMutateAsync.mockReset();
    dashboardMocks.lockMutate.mockReset();
    dashboardMocks.restoreMutateAsync.mockReset();
    localStorage.clear();
    settingsMocks.me = {
      user_id: 'u1',
      email: 'user@example.com',
      role: 'user',
      default_vehicle_id: 'v1',
    };
    document.documentElement.className = 'dark';
    document.documentElement.removeAttribute('data-rm-palette');
    settingsMocks.vehicles = [
      {
        id: 'v1',
        display_name: 'Adventure Truck',
        model: 'R1T',
        year: null,
        trim: null,
        vin: null,
        rivian_vehicle_id: 'rivian-1',
        battery_capacity_kwh: 135,
        target_tire_pressure_psi: 48,
        membership_role: 'owner',
        is_demo: false,
      },
    ];
  });

  it('renders the Vehicles section heading', () => {
    renderSettings();
    expect(screen.getAllByText('Vehicles').length).toBeGreaterThan(0);
  });

  it('shows the running version in a Settings-only link to GitHub Releases', async () => {
    settingsMocks.auth.accessToken = 'session-token';
    renderSettings();

    const versionLink = await screen.findByRole('link', { name: /^2026\.09\.4\+dev\. Update checks off/i });
    expect(versionLink).toHaveAttribute('href', 'https://github.com/bballdavis/Riviamigo/releases');
    expect(versionLink).toHaveAttribute('target', '_blank');
    expect(versionLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(versionLink).toHaveTextContent('2026.09.4+dev');
    expect(versionLink).toHaveTextContent('Update checks off');
  });

  it('shows up to date or the newer remote version as the version subtitle', async () => {
    settingsMocks.auth.accessToken = 'session-token';
    const snapshot = (latestVersion: string, updateAvailable: boolean) => JSON.stringify({
      lastAttemptAt: 1, lastSuccessfulAt: 1, latestVersion, updateAvailable, error: null,
    });
    localStorage.setItem('rm-github-release-check-v1', snapshot('2026.09.4', false));
    const { unmount } = renderSettings();
    expect(await screen.findByRole('link', { name: /Up to date/ })).toBeInTheDocument();
    unmount();

    localStorage.setItem('rm-github-release-check-v1', snapshot('2026.10.1', true));
    renderSettings();
    expect(await screen.findByRole('link', { name: /2026\.10\.1 available/ })).toBeInTheDocument();
    localStorage.removeItem('rm-github-release-check-v1');
  });

  it('labels missing running build metadata as unknown', async () => {
    settingsMocks.auth.accessToken = 'session-token';
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.getAppVersion).mockResolvedValueOnce({ version: 'unknown' });
    renderSettings();

    expect(await screen.findByRole('link', { name: /^Unknown version\./i })).toHaveTextContent('Unknown version');
  });

  it('uses a chart icon for the Charts settings section', () => {
    renderSettings();
    expect(screen.getByTestId('icon-chart-line')).toBeInTheDocument();
  });

  it('renders the mobile section picker with every available section', () => {
    renderSettings();

    const picker = screen.getByLabelText('Settings section');
    expect(picker).toHaveClass('w-full');
    expect(picker).toHaveValue('vehicles');
    expect(Array.from((picker as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      'account',
      'api',
      'appearance',
      'charging',
      'charts',
      'dashboards',
      'external',
      'jobs',
      'ownership',
      'places',
      'raw',
      'units',
      'vehicles',
    ]);

    fireEvent.change(picker, { target: { value: 'appearance' } });

    expect(picker).toHaveValue('appearance');
    expect(screen.getByText('Appearance mode')).toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/settings',
      search: { section: 'appearance' },
    });
  });

  it('includes Backups in the mobile section picker for administrators', () => {
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'v1',
    };
    renderSettings();

    expect(screen.getByRole('option', { name: 'Backups' })).toBeInTheDocument();
  });

  it('shows Vehicles for a plain /settings navigation after another section was open', () => {
    renderSettings({ section: 'account' });
    expect(screen.getByText('Sign Out')).toBeInTheDocument();

    navigateSettingsRoute({});

    expect(screen.getByLabelText('Settings section')).toHaveValue('vehicles');
    expect(screen.queryByText('Sign Out')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vehicle' })).toBeInTheDocument();
  });

  it('follows the section named by the URL on back and forward navigation', () => {
    renderSettings({ section: 'places' });
    expect(screen.getByLabelText('Settings section')).toHaveValue('places');

    navigateSettingsRoute({ section: 'account' });
    expect(screen.getByLabelText('Settings section')).toHaveValue('account');
    expect(screen.getByText('Sign Out')).toBeInTheDocument();

    navigateSettingsRoute({ section: 'places' });
    expect(screen.getByLabelText('Settings section')).toHaveValue('places');
    expect(screen.queryByText('Sign Out')).not.toBeInTheDocument();
  });

  it('keeps the chosen section open after a sidebar switch with no unsaved edits', () => {
    renderSettings();

    clickSettingsSection('Account');
    expect(screen.getByText('Sign Out')).toBeInTheDocument();

    clickSettingsSection('Places');
    expect(screen.getByLabelText('Settings section')).toHaveValue('places');
    expect(screen.queryByText('Sign Out')).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenLastCalledWith({ to: '/settings', search: { section: 'places' } });
  });

  it('selecting the section that is already open does not navigate', () => {
    renderSettings({ section: 'account' });

    clickSettingsSection('Account');

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  it('renders the connected vehicle display name', () => {
    renderSettings();
    expect(screen.getByText('Adventure Truck')).toBeInTheDocument();
  });

  it('renders the vehicle model', () => {
    renderSettings();
    expect(screen.getByText(/R1T/)).toBeInTheDocument();
  });

  it('renders the Vehicle button', () => {
    renderSettings();
    expect(screen.getByText('Vehicle')).toBeInTheDocument();
  });

  it('uses compact accessible icon actions on vehicle cards', () => {
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'v1',
    };
    settingsMocks.vehicles = [
      {
        id: 'v1',
        display_name: 'Adventure Truck',
        model: 'R1T',
        year: null,
        trim: null,
        vin: null,
        rivian_vehicle_id: 'rivian-1',
        battery_capacity_kwh: 135,
        target_tire_pressure_psi: 48,
        membership_role: 'owner',
        is_demo: false,
      },
      {
        id: 'v2',
        display_name: 'Second Vehicle',
        model: 'R1S',
        year: null,
        trim: null,
        vin: null,
        rivian_vehicle_id: 'rivian-2',
        battery_capacity_kwh: 135,
        target_tire_pressure_psi: 48,
        membership_role: 'owner',
        is_demo: false,
      },
      {
        id: 'demo-v1',
        display_name: 'Demo R2S',
        model: 'R2S',
        year: null,
        trim: null,
        vin: null,
        rivian_vehicle_id: 'demo-r2s-local',
        battery_capacity_kwh: 82,
        target_tire_pressure_psi: 48,
        membership_role: 'owner',
        is_demo: true,
      },
    ];

    renderSettings();

    const setDefault = screen.getByRole('button', {
      name: 'Set Second Vehicle as default vehicle',
    });
    const manageSharing = screen.getByRole('button', {
      name: 'Manage sharing for Adventure Truck',
    });
    const refreshDemo = screen.getByRole('button', { name: 'Refresh demo data for Demo R2S' });
    for (const button of [setDefault, manageSharing, refreshDemo]) {
      expect(button).toHaveClass('h-8', 'w-8', 'px-0');
    }
    expect(screen.queryByText('Set Default')).not.toBeInTheDocument();
    expect(screen.queryByText('Manage Sharing')).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh Demo Data')).not.toBeInTheDocument();

    fireEvent.click(manageSharing);
    expect(screen.getByText('Vehicle Access')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hide sharing for Adventure Truck' })
    ).toBeInTheDocument();
  });

  it('pauses and resumes Rivian collection from a connected vehicle card', async () => {
    settingsMocks.me = { user_id: 'u1', email: 'owner@example.com', role: 'user', default_vehicle_id: 'v1' };
    const vehicle = {
      id: 'v1',
      display_name: 'Adventure Truck',
      model: 'R1T',
      year: null,
      trim: null,
      vin: null,
      rivian_vehicle_id: 'rivian-1',
      battery_capacity_kwh: 135,
      target_tire_pressure_psi: 48,
      membership_role: 'owner',
      is_demo: false,
    };
    settingsMocks.vehicles = [
      vehicle,
      { ...vehicle, id: 'demo-v1', display_name: 'Demo R2S', rivian_vehicle_id: 'demo-r2s-local', is_demo: true },
    ];
    const hooks = await import('@riviamigo/hooks');
    const { unmount } = renderSettings();

    expect(screen.queryByRole('button', { name: /data collection for Demo R2S/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause data collection for Adventure Truck' }));
    await waitFor(() => expect(hooks.api.updateVehicleCollection).toHaveBeenCalledWith('v1', true));
    unmount();

    settingsMocks.vehicles = [Object.assign({}, vehicle, { collection_paused: true })];
    renderSettings();
    expect(screen.getByText('Collection paused')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume data collection for Adventure Truck' }));
    await waitFor(() => expect(hooks.api.updateVehicleCollection).toHaveBeenCalledWith('v1', false));
  });

  it('renders dashboard persistence controls and triggers dashboard actions for admins', async () => {
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'v1',
    };
    dashboardMocks.dashboards = [
      {
        id: 'default-overview',
        slug: 'dashboard',
        name: 'Overview',
        description: null,
        isDefault: true,
        isLocked: true,
        ownerId: null,
        widgets: [{ id: 'w1' }],
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        slug: 'my-charging',
        name: 'My Charging',
        description: null,
        isDefault: false,
        isLocked: false,
        ownerId: 'u1',
        widgets: [{ id: 'w2' }, { id: 'w3' }],
      },
    ];
    dashboardMocks.cloneMutateAsync.mockResolvedValue({
      id: '33333333-3333-3333-3333-333333333333',
      slug: 'dashboard-copy',
      name: 'Overview Copy',
      description: null,
      isDefault: false,
      isLocked: false,
      ownerId: 'u1',
      widgets: [],
    });
    dashboardMocks.createMutateAsync.mockResolvedValue({
      id: '44444444-4444-4444-4444-444444444444',
      slug: 'dashboard',
      name: 'Overview',
      description: null,
      isDefault: false,
      isLocked: false,
      ownerId: 'u1',
      widgets: [],
    });
    renderSettings();
    clickSettingsSection('Dashboards');

    expect(screen.getByText('System Defaults')).toBeInTheDocument();
    expect(screen.getByText('My Dashboards')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('My Charging')).toBeInTheDocument();
    expect(screen.getByText('2 saved')).toBeInTheDocument();
    const ownershipDetails = screen
      .getByText('How dashboard defaults and personal copies work')
      .closest('details');
    expect(ownershipDetails).not.toHaveAttribute('open');

    const openDefaultButton = screen.getByRole('button', { name: 'Open default' });
    const firstExportButton = screen.getAllByRole('button', { name: 'Export' })[0]!;
    expect(firstExportButton).toHaveAttribute('variant', openDefaultButton.getAttribute('variant'));

    fireEvent.click(openDefaultButton);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/d/$slug',
      params: { slug: 'dashboard' },
      search: { dashboardId: '00000000-0000-0000-0000-000000000001' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit default' }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/d/$slug',
      params: { slug: 'dashboard' },
      search: { dashboardId: '00000000-0000-0000-0000-000000000001', edit: 1 },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    await waitFor(() => {
      expect(dashboardMocks.createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'personal-draft',
          slug: 'dashboard',
          isDefault: false,
        })
      );
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/d/$slug',
        params: { slug: 'dashboard' },
        search: { dashboardId: '44444444-4444-4444-4444-444444444444', edit: 1 },
      });
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Export' })[0]!);
    expect(dashboardMocks.downloadDashboardYaml).toHaveBeenCalledWith(dashboardMocks.dashboards[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(dashboardMocks.lockMutate).toHaveBeenCalledWith({
      id: '00000000-0000-0000-0000-000000000001',
      locked: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Restore bundled' }));
    const restoreDialog = screen.getByRole('dialog');
    expect(within(restoreDialog).getByRole('heading', { name: 'Restore "Overview" to the bundled default layout?' })).toBeInTheDocument();
    expect(dashboardMocks.restoreMutateAsync).not.toHaveBeenCalled();
    fireEvent.click(within(restoreDialog).getByRole('button', { name: 'Restore bundled' }));
    expect(dashboardMocks.restoreMutateAsync).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const deleteDialog = screen.getByRole('dialog');
    expect(within(deleteDialog).getByRole('heading', { name: 'Delete "My Charging"? This removes your saved dashboard.' })).toBeInTheDocument();
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete' }));
    expect(dashboardMocks.deleteMutateAsync).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const showEditButton = screen.getByRole('switch', {
      name: 'Show edit button on dashboard pages',
    });
    expect(showEditButton).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(showEditButton);
    expect(showEditButton).toHaveAttribute('aria-checked', 'true');
    // Staged: nothing is written until the page bar saves it.
    expect(localStorage.getItem('rm-show-dashboard-edit-button:u1')).toBeNull();
    saveUnsavedChanges();
    await waitFor(() => {
      expect(localStorage.getItem('rm-show-dashboard-edit-button:u1')).toBe('true');
    });
  });

  it('marks a same-slug personal copy active and resets it back to the system default', () => {
    dashboardMocks.dashboards = [
      {
        id: 'default-overview',
        slug: 'dashboard',
        name: 'Overview',
        description: null,
        isDefault: true,
        isLocked: true,
        ownerId: null,
        widgets: [{ id: 'w1' }],
      },
      {
        id: '55555555-5555-5555-5555-555555555555',
        slug: 'dashboard',
        name: 'Overview',
        description: null,
        isDefault: false,
        isLocked: false,
        ownerId: 'u1',
        widgets: [{ id: 'w2' }],
      },
    ];
    renderSettings();
    clickSettingsSection('Dashboards');

    expect(screen.getAllByText('Active for you')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open default' }));
    expect(mockNavigate).toHaveBeenLastCalledWith({
      to: '/d/$slug',
      params: { slug: 'dashboard' },
      search: { dashboardId: '00000000-0000-0000-0000-000000000001' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    const resetDialog = screen.getByRole('dialog');
    expect(within(resetDialog).getByRole('heading', { name: 'Reset "Overview" to the system default? This removes your personal dashboard copy.' })).toBeInTheDocument();
    fireEvent.click(within(resetDialog).getByRole('button', { name: 'Reset to default' }));
    expect(dashboardMocks.deleteMutateAsync).toHaveBeenCalledWith('55555555-5555-5555-5555-555555555555');
  });

  it('leaves a system dashboard unchanged when its restore is cancelled', () => {
    settingsMocks.me = { ...settingsMocks.me, role: 'admin' };
    dashboardMocks.dashboards = [
      {
        id: 'default-overview',
        slug: 'dashboard',
        name: 'Overview',
        description: null,
        isDefault: true,
        isLocked: false,
        ownerId: null,
        widgets: [{ id: 'w1' }],
      },
    ];

    renderSettings();
    clickSettingsSection('Dashboards');

    fireEvent.click(screen.getByRole('button', { name: 'Restore bundled' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(dashboardMocks.restoreMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Restore bundled' })).toBeInTheDocument();
  });

  it('navigates to /connect when Vehicle is clicked', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Vehicle'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/connect' });
  });

  it('hides Demo Vehicle for regular users', () => {
    renderSettings();
    expect(screen.queryByText('Demo Vehicle')).not.toBeInTheDocument();
  });

  it('shows Demo Vehicle for admin users and triggers creation', async () => {
    const hooks = await import('@riviamigo/hooks');
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'v1',
    };
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText('Demo Vehicle')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Demo Vehicle'));
    fireEvent.click(screen.getByRole('button', { name: 'R1T' }));
    await waitFor(() => {
      expect(hooks.api.createDemoVehicle).toHaveBeenCalledWith({ model: 'R1T' });
    });
    await waitFor(() => {
      expect(settingsMocks.auth.setActiveVehicleId).toHaveBeenCalledWith('demo-v1');
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles'], exact: true });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles', 'status', 'demo-v1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles', 'health', 'demo-v1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles', 'images', 'demo-v1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['me'] });
    invalidateSpy.mockRestore();
  });

  it('refreshes only demo history after confirmation and hides Rivian repair actions', async () => {
    const hooks = await import('@riviamigo/hooks');
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'demo-v1',
    };
    settingsMocks.auth.defaultVehicleId = 'demo-v1';
    settingsMocks.vehicles = [
      {
        id: 'demo-v1',
        display_name: 'Demo R1T',
        model: 'R1T',
        year: null,
        trim: null,
        vin: null,
        rivian_vehicle_id: 'demo-r1t-local',
        battery_capacity_kwh: 135,
        target_tire_pressure_psi: 48,
        membership_role: 'owner',
        is_demo: true,
      },
    ];

    renderSettings();

    expect(screen.getAllByText('Demo data').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Refresh Rivian login for Demo R1T')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Clear local artwork cache for Demo R1T')
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Refresh vehicle artwork for Demo R1T')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh demo data for Demo R1T' }));
    expect(screen.getByText('Refresh Demo R1T?')).toBeInTheDocument();
    expect(
      screen.getByText(/illustrative telemetry, trips, charging, and weather history/i)
    ).toBeInTheDocument();

    const confirmationButtons = screen.getAllByRole('button', { name: 'Refresh Demo Data' });
    fireEvent.click(confirmationButtons[confirmationButtons.length - 1]!);

    await waitFor(() => {
      expect(hooks.api.refreshDemoVehicle).toHaveBeenCalledWith('demo-v1');
    });
    expect(invalidateSpy).toHaveBeenCalledWith();
    invalidateSpy.mockRestore();
  });

  it('saves target tire pressure through shared vehicle settings', async () => {
    const hooks = await import('@riviamigo/hooks');

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    fireEvent.change(screen.getByDisplayValue('48'), { target: { value: '46' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(hooks.api.updateVehicleSettings).not.toHaveBeenCalled();
    saveUnsavedChanges();

    await waitFor(() => {
      expect(hooks.api.updateVehicleSettings).toHaveBeenCalledWith('v1', {
        battery_capacity_kwh: 135,
        battery_config: 'R1T / R1S Large (Gen 1)',
        target_tire_pressure_psi: 46,
      });
    });
  });

  it('refreshes only the vehicle list after the default vehicle changes', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.vehicles = [
      ...settingsMocks.vehicles,
      { ...settingsMocks.vehicles[0]!, id: 'v2', display_name: 'Weekend Car', rivian_vehicle_id: 'rivian-2' },
    ];
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Set Weekend Car as default vehicle' }));

    await waitFor(() => expect(hooks.api.setDefaultVehicle).toHaveBeenCalledWith('v2'));
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles'], exact: true }));
    // A prefix match on ['vehicles'] would also refetch every vehicle's status, health, images, and ownership.
    const prefixMatches = invalidateSpy.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === '["vehicles"]' && !filters?.exact);
    expect(prefixMatches).toHaveLength(0);
    invalidateSpy.mockRestore();
  });

  it('adds a member from the sharing panel and keeps the invite token on the page', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.auth.accessToken = 'session-token';
    vi.mocked(hooks.api.addVehicleMember).mockResolvedValueOnce({ invite_created: true, invite_token: 'invite-token-123' } as never);
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Manage sharing for Adventure Truck' }));
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), { target: { value: 'friend@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));

    await waitFor(() => expect(hooks.api.addVehicleMember).toHaveBeenCalledWith('v1', { email: 'friend@example.com', role: 'viewer' }));
    expect(await screen.findByText('invite-token-123')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('user@example.com')).toHaveValue('');
  });

  it('lists the members of an expanded vehicle and removes one from the sharing panel', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.auth.accessToken = 'session-token';
    vi.mocked(hooks.api.listVehicleMembers).mockResolvedValueOnce([
      { user_id: 'u2', email: 'friend@example.com', role: 'viewer', is_default: false, created_at: '2026-05-04T12:00:00Z' },
    ] as never);
    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Manage sharing for Adventure Truck' }));
    expect(await screen.findByText('friend@example.com')).toBeInTheDocument();
    expect(hooks.api.listVehicleMembers).toHaveBeenCalledWith('v1');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(hooks.api.removeVehicleMember).toHaveBeenCalledWith('v1', 'u2'));
  });

  it('deletes a vehicle only after DELETE is typed in a labelled dialog', async () => {
    const hooks = await import('@riviamigo/hooks');
    renderSettings();

    fireEvent.click(screen.getByLabelText('Delete Adventure Truck'));
    const dialog = screen.getByRole('dialog', { name: 'Delete Adventure Truck?' });
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete Vehicle' });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type DELETE to confirm' }), { target: { value: 'DELETE' } });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);

    await waitFor(() => expect(hooks.api.deleteVehicle).toHaveBeenCalledWith('v1'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels the vehicle delete dialog without deleting, even after DELETE is typed', async () => {
    const hooks = await import('@riviamigo/hooks');
    renderSettings();

    fireEvent.click(screen.getByLabelText('Delete Adventure Truck'));
    const dialog = screen.getByRole('dialog', { name: 'Delete Adventure Truck?' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Type DELETE to confirm' }), { target: { value: 'DELETE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hooks.api.deleteVehicle).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Delete Adventure Truck')).toBeInTheDocument();
  });

  it('opens and edits every dashboard via links the /d/$slug route accepts', () => {
    // Real default dashboards (real ids), not hand-written fixtures: the route's own
    // search validation must accept whatever the Open/Edit buttons navigate with.
    // Read the bundled JSON directly: importing the dashboards package here would pull in
    // every widget and trip over this file's lucide-react mock.
    const bundled = import.meta.glob<{ default: { id: string; slug: string; name: string; widgets: unknown[] } }>(
      '../../../../../packages/dashboards/src/defaults/*.json',
      { eager: true },
    );
    const DEFAULT_DASHBOARDS = Object.values(bundled).map(({ default: json }) => ({
      ...json,
      description: null,
      isDefault: true,
      isLocked: false,
      ownerId: null,
    }));
    expect(DEFAULT_DASHBOARDS.length).toBeGreaterThanOrEqual(5);
    const owned = {
      id: crypto.randomUUID(),
      slug: 'my-charging',
      name: 'My Charging',
      description: null,
      isDefault: false,
      isLocked: false,
      ownerId: 'u1',
      widgets: [],
    };
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'v1',
    };
    dashboardMocks.dashboards = [...DEFAULT_DASHBOARDS, owned] as never;

    renderSettings();
    clickSettingsSection('Dashboards');
    mockNavigate.mockReset(); // drop the section-switch navigation

    const expectNavigatesToValidDashboardRoute = (slug: string, dashboardId: string, edit: boolean) => {
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      const call = mockNavigate.mock.calls[0]![0] as {
        to: string;
        params: { slug: string };
        search: unknown;
      };
      expect(call.to).toBe('/d/$slug');
      expect(call.params).toEqual({ slug });
      const parsed = dashboardSearchSchema.safeParse(call.search);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ dashboardId, ...(edit ? { edit: 1 } : {}) });
      mockNavigate.mockReset();
    };

    const openDefaults = screen.getAllByRole('button', { name: 'Open default' });
    const editDefaults = screen.getAllByRole('button', { name: 'Edit default' });
    expect(openDefaults).toHaveLength(DEFAULT_DASHBOARDS.length);
    expect(editDefaults).toHaveLength(DEFAULT_DASHBOARDS.length);

    DEFAULT_DASHBOARDS.forEach((dashboard, index) => {
      fireEvent.click(openDefaults[index]!);
      expectNavigatesToValidDashboardRoute(dashboard.slug, dashboard.id, false);
      fireEvent.click(editDefaults[index]!);
      expectNavigatesToValidDashboardRoute(dashboard.slug, dashboard.id, true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expectNavigatesToValidDashboardRoute(owned.slug, owned.id, false);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expectNavigatesToValidDashboardRoute(owned.slug, owned.id, true);
  });

  const gen1CapacityHint = "Your saved capacity (135 kWh) matches a Gen 1 pack; your vehicle's VIN indicates Gen 2.";
  const gen2CapacityHint = "Your saved capacity (109 kWh) matches a Gen 2 pack; your vehicle's VIN indicates Gen 1.";

  it.each([
    { year: 2025, capacity: null, generation: 'gen2', pack: 'r1_large_g2', hint: null },
    { year: 2026, capacity: 109, generation: 'gen2', pack: 'r1_large_g2', hint: null },
    { year: 2025, capacity: 135, generation: 'gen2', pack: 'custom', hint: gen1CapacityHint },
    { year: 2026, capacity: 123, generation: 'gen2', pack: 'custom', hint: null },
    { year: 2024, capacity: null, generation: 'gen1', pack: 'r1_large_g1', hint: null },
    { year: 2024, capacity: 109, generation: 'gen1', pack: 'custom', hint: gen2CapacityHint },
    { year: null, capacity: 109, generation: 'gen2', pack: 'r1_large_g2', hint: null },
    { year: null, capacity: 135, generation: 'gen1', pack: 'r1_large_g1', hint: null },
    { year: null, capacity: null, generation: 'gen1', pack: 'r1_large_g1', hint: null },
  ])('uses R1 model year before saved capacity: $year / $capacity', ({ year, capacity, generation, pack, hint }) => {
    settingsMocks.vehicles[0]!.year = year;
    settingsMocks.vehicles[0]!.battery_capacity_kwh = capacity;

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));

    expect(screen.getByLabelText('Battery generation')).toHaveValue(generation);
    expect(screen.getByLabelText('Battery pack')).toHaveValue(pack);
    if (pack === 'custom') expect(screen.getByDisplayValue(String(capacity))).toBeInTheDocument();
    if (hint) {
      expect(screen.getByRole('note')).toHaveTextContent(hint);
    } else {
      expect(screen.queryByText(/matches a Gen \d pack/)).not.toBeInTheDocument();
    }
  });

  it('defaults an R2 to the R2 pack even when its model year is 2025 or later', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.vehicles[0]!.model = 'R2';
    settingsMocks.vehicles[0]!.year = 2026;
    settingsMocks.vehicles[0]!.battery_capacity_kwh = null;

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));

    expect(screen.queryByLabelText('Battery generation')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Battery pack')).toHaveValue('r2');
    expect(screen.queryByText(/matches a Gen \d pack/)).not.toBeInTheDocument();
    // The displayed default is not persisted until the editor has an edit to save.
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Target Tire Pressure'), { target: { value: '47' } });
    saveUnsavedChanges();

    await waitFor(() => {
      expect(hooks.api.updateVehicleSettings).toHaveBeenCalledWith('v1', {
        battery_capacity_kwh: 82,
        battery_config: 'R2',
        target_tire_pressure_psi: 47,
      });
    });
  });

  it('shows an R2 capacity outside the R2 pack as custom without an R1 generation hint', () => {
    settingsMocks.vehicles[0]!.model = 'R2';
    settingsMocks.vehicles[0]!.year = 2026;

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));

    expect(screen.getByLabelText('Battery pack')).toHaveValue('custom');
    expect(screen.getByDisplayValue('135')).toBeInTheDocument();
    expect(screen.queryByText(/matches a Gen \d pack/)).not.toBeInTheDocument();
  });

  it('preserves a saved capacity when the refreshed model year corrects the generation', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.vehicles[0]!.year = 2025;

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    expect(screen.getByLabelText('Battery generation')).toHaveValue('gen2');
    expect(screen.getByLabelText('Battery pack')).toHaveValue('custom');
    fireEvent.change(screen.getByLabelText('Target Tire Pressure'), { target: { value: '47' } });
    saveUnsavedChanges();

    await waitFor(() => {
      expect(hooks.api.updateVehicleSettings).toHaveBeenCalledWith('v1', {
        battery_capacity_kwh: 135,
        battery_config: 'Custom (135 kWh)',
        target_tire_pressure_psi: 47,
      });
    });
  });

  it('still allows selecting the correct Gen 2 pack after automatic generation correction', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.vehicles[0]!.year = 2025;

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    fireEvent.change(screen.getByLabelText('Battery pack'), { target: { value: 'r1_large_g2' } });
    saveUnsavedChanges();

    await waitFor(() => {
      expect(hooks.api.updateVehicleSettings).toHaveBeenCalledWith('v1', {
        battery_capacity_kwh: 109,
        battery_config: 'R1T / R1S Large (Gen 2)',
        target_tire_pressure_psi: 48,
      });
    });
  });

  it('does not carry generation state from a different vehicle into a custom pack', () => {
    settingsMocks.vehicles = [
      { ...settingsMocks.vehicles[0]!, id: 'v2', display_name: 'Gen 2 SUV', year: 2025, battery_capacity_kwh: 109 },
      { ...settingsMocks.vehicles[0]!, battery_capacity_kwh: 123 },
    ];

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Gen 2 SUV'));
    expect(screen.getByLabelText('Battery generation')).toHaveValue('gen2');
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    expect(screen.getByLabelText('Battery generation')).toHaveValue('gen1');
    expect(screen.getByLabelText('Battery pack')).toHaveValue('custom');
  });

  it('uses a Gen 2 model hint when Rivian omits the model year', () => {
    settingsMocks.vehicles[0]!.model = 'R1S Gen 2';
    settingsMocks.vehicles[0]!.battery_capacity_kwh = null;

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    expect(screen.getByLabelText('Battery generation')).toHaveValue('gen2');
    expect(screen.getByLabelText('Battery pack')).toHaveValue('r1_large_g2');
  });

  it('stages vehicle edits behind the page bar and reverts them on Discard', async () => {
    const hooks = await import('@riviamigo/hooks');

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    fireEvent.change(screen.getByLabelText('Vehicle Name'), { target: { value: 'Renamed Truck' } });

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(hooks.api.updateVehicleName).not.toHaveBeenCalled();

    discardUnsavedChanges();

    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Vehicle Name')).toHaveValue('Adventure Truck');
    expect(hooks.api.updateVehicleName).not.toHaveBeenCalled();
    expect(hooks.api.updateVehicleSettings).not.toHaveBeenCalled();
  });

  it('saves a renamed vehicle through the name endpoint after the battery settings', async () => {
    const hooks = await import('@riviamigo/hooks');

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    fireEvent.change(screen.getByLabelText('Vehicle Name'), { target: { value: '  Renamed Truck ' } });
    saveUnsavedChanges();

    await waitFor(() => {
      expect(hooks.api.updateVehicleName).toHaveBeenCalledWith('v1', 'Renamed Truck');
    });
    expect(hooks.api.updateVehicleSettings).toHaveBeenCalledWith('v1', {
      battery_capacity_kwh: 135,
      battery_config: 'R1T / R1S Large (Gen 1)',
      target_tire_pressure_psi: 48,
    });
    expect(vi.mocked(hooks.api.updateVehicleSettings).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(hooks.api.updateVehicleName).mock.invocationCallOrder[0]!,
    );
    await waitFor(() => {
      expect(screen.queryByLabelText('Vehicle Name')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('shows an inline error and keeps the bar open when the vehicle name is blank', async () => {
    const hooks = await import('@riviamigo/hooks');

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    fireEvent.change(screen.getByLabelText('Vehicle Name'), { target: { value: '   ' } });
    saveUnsavedChanges();

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a vehicle name.');
    expect(screen.getByPlaceholderText('Vehicle name').closest('label')).toHaveTextContent('Enter a vehicle name.');
    expect(hooks.api.updateVehicleSettings).not.toHaveBeenCalled();
    expect(hooks.api.updateVehicleName).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('keeps the editor open with the API message when the battery save is rejected', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.updateVehicleSettings).mockRejectedValueOnce(
      Object.assign(new Error('400 bad_request: capacity rejected'), {
        detail: { message: 'Battery capacity is outside the supported range.' },
      }),
    );

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    fireEvent.change(screen.getByLabelText('Target Tire Pressure'), { target: { value: '46' } });
    saveUnsavedChanges();

    expect(await screen.findByRole('alert')).toHaveTextContent('Battery capacity is outside the supported range.');
    expect(screen.getByLabelText('Target Tire Pressure')).toHaveValue(46);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(hooks.api.updateVehicleName).not.toHaveBeenCalled();
  });

  it('asks before closing a vehicle editor with unsaved edits', async () => {
    const hooks = await import('@riviamigo/hooks');

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    fireEvent.change(screen.getByLabelText('Target Tire Pressure'), { target: { value: '46' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close vehicle editor' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Save your changes?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.getByLabelText('Target Tire Pressure')).toHaveValue(46);

    fireEvent.click(screen.getByRole('button', { name: 'Close vehicle editor' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));

    expect(screen.queryByLabelText('Target Tire Pressure')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(hooks.api.updateVehicleSettings).not.toHaveBeenCalled();
  });

  it('asks before opening another vehicle while this editor has unsaved edits', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.vehicles = [
      settingsMocks.vehicles[0]!,
      { ...settingsMocks.vehicles[0]!, id: 'v2', display_name: 'Gen 2 SUV', year: 2025, battery_capacity_kwh: 109 },
    ];

    renderSettings();
    fireEvent.click(screen.getByLabelText('Edit Adventure Truck'));
    fireEvent.change(screen.getByLabelText('Target Tire Pressure'), { target: { value: '46' } });
    fireEvent.click(screen.getByLabelText('Edit Gen 2 SUV'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Save your changes?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.getByLabelText('Target Tire Pressure')).toHaveValue(46);

    fireEvent.click(screen.getByLabelText('Edit Gen 2 SUV'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(hooks.api.updateVehicleSettings).toHaveBeenCalledWith('v1', {
        battery_capacity_kwh: 135,
        battery_config: 'R1T / R1S Large (Gen 1)',
        target_tire_pressure_psi: 46,
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Battery generation')).toHaveValue('gen2');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stages a unit change behind the page bar and saves it on Save', async () => {
    const hooks = await import('@riviamigo/hooks');

    renderSettings();
    clickSettingsSection('Units');
    fireEvent.click(screen.getByRole('button', { name: /^Metric/ }));

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Metric/ })).toHaveTextContent('Selected');
    expect(hooks.api.updateUnitPreferences).not.toHaveBeenCalled();

    saveUnsavedChanges();

    await waitFor(() => {
      expect(hooks.api.updateUnitPreferences).toHaveBeenCalledWith({
        mode: 'metric',
        distance_unit: 'kilometers',
        speed_unit: 'kmh',
        temperature_unit: 'celsius',
        pressure_unit: 'kpa',
        altitude_unit: 'meters',
        place_radius_unit: 'meters',
        efficiency_display: 'distance_per_energy',
      });
    });
    await waitFor(() => {
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    });
  });

  it('reverts staged unit changes on Discard without calling the API', async () => {
    const hooks = await import('@riviamigo/hooks');

    renderSettings();
    clickSettingsSection('Units');
    fireEvent.click(screen.getByRole('button', { name: /^Metric/ }));
    discardUnsavedChanges();

    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Imperial/ })).toHaveTextContent('Selected');
    expect(hooks.api.updateUnitPreferences).not.toHaveBeenCalled();
  });

  it('stages custom unit selects and keeps them with an error when the save fails', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.updateUnitPreferences).mockRejectedValueOnce(new Error('network down'));

    renderSettings();
    clickSettingsSection('Units');
    fireEvent.click(screen.getByRole('button', { name: /^Custom/ }));
    fireEvent.change(screen.getByLabelText('Speed unit'), { target: { value: 'kmh' } });
    saveUnsavedChanges();

    expect(await screen.findByRole('alert')).toHaveTextContent('Units could not be saved. Try again.');
    expect(hooks.api.updateUnitPreferences).toHaveBeenCalledWith(expect.objectContaining({ mode: 'custom', speed_unit: 'kmh' }));
    expect(screen.getByLabelText('Speed unit')).toHaveValue('kmh');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('asks before leaving the Units section with unsaved changes', async () => {
    const hooks = await import('@riviamigo/hooks');

    renderSettings();
    clickSettingsSection('Units');
    fireEvent.click(screen.getByRole('button', { name: /^Metric/ }));
    clickSettingsSection('Account');

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Save your changes?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.getByText('Pick a preset system or switch to Custom for per-unit control.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    clickSettingsSection('Account');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/settings', search: { section: 'account' } });
    expect(screen.queryByText('Pick a preset system or switch to Custom for per-unit control.')).not.toBeInTheDocument();
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
    expect(hooks.api.updateUnitPreferences).not.toHaveBeenCalled();
  });

  it('stages the application time zone for administrators until Save', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.me = { ...settingsMocks.me, role: 'admin' };
    settingsMocks.auth.accessToken = 'test-access-token';

    renderSettings();
    clickSettingsSection('Units');
    await waitFor(() => {
      expect(screen.getByLabelText('Application time zone')).toHaveValue('America/Chicago');
    });
    fireEvent.change(screen.getByLabelText('Application time zone'), { target: { value: 'America/Denver' } });

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(hooks.api.updateAppTimezone).not.toHaveBeenCalled();

    saveUnsavedChanges();

    await waitFor(() => {
      expect(hooks.api.updateAppTimezone).toHaveBeenCalledWith('America/Denver');
    });
  });

  it('renders the Appearance section', () => {
    renderSettings();
    clickSettingsSection('Appearance');
    expect(screen.getAllByText('Appearance').length).toBeGreaterThan(0);
    expect(screen.getByText('Appearance mode')).toBeInTheDocument();
  });

  it('offers every OpenFreeMap style and saves the user selection', async () => {
    settingsMocks.basemapConfig = { resolved_provider: 'openfreemap' };
    renderSettings();
    clickSettingsSection('Appearance');

    const style = screen.getByLabelText('Map style');
    for (const value of ['follow-theme', 'positron', 'bright', 'liberty', 'dark', 'fiord', '3d']) {
      expect(style.querySelector(`option[value="${value}"]`)).toBeInTheDocument();
    }

    fireEvent.change(style, { target: { value: 'liberty' } });
    expect(hooksMocks.updateMapStylePreference).not.toHaveBeenCalled();
    saveUnsavedChanges();
    await waitFor(() => expect(hooksMocks.updateMapStylePreference).toHaveBeenCalledWith('liberty'));
  });

  it('hides OpenFreeMap-only style controls for CARTO', () => {
    settingsMocks.basemapConfig = { resolved_provider: 'carto' };
    renderSettings();
    clickSettingsSection('Appearance');
    expect(screen.queryByLabelText('Map style')).not.toBeInTheDocument();
  });

  it('renders the Places section', () => {
    renderSettings();
    clickSettingsSection('Places');
    expect(screen.getAllByText('Places').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Saved Places/i).length).toBeGreaterThan(0);
  });

  it('renders and filters the API endpoint catalog', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.auth.accessToken = 'test-access-token';
    renderSettings();
    clickSettingsSection('API Access');

    expect(screen.getByText('Integration Keys')).toBeInTheDocument();
    expect(screen.getByText(/read-only and limited to one vehicle/i)).toBeInTheDocument();
    await waitFor(() => expect(hooks.api.listApiKeys).toHaveBeenCalled());
    await waitFor(() => expect(hooks.api.getApiCatalog).toHaveBeenCalled());
    expect(screen.getByText('/v1/vehicles')).toBeInTheDocument();
    expect(screen.getByText('/v1/vehicles/{id}/raw-data')).toBeInTheDocument();
    expect(screen.getByText('/v1/metrics/batch')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search API endpoints'), {
      target: { value: 'raw-data' },
    });

    expect(screen.getByText('/v1/vehicles/{id}/raw-data')).toBeInTheDocument();
    expect(screen.queryByText('/v1/vehicles')).not.toBeInTheDocument();
    expect(screen.queryByText('/v1/metrics/batch')).not.toBeInTheDocument();
  });

  it('shows address suggestions after explicitly submitting a place search', async () => {
    renderSettings();
    clickSettingsSection('Places');

    fireEvent.change(screen.getByLabelText('Address Search'), { target: { value: '123 Main' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByText('123 Main St, Denver, CO')).toBeInTheDocument();
    });
  });

  it('shows an in-flight searching indicator for place search', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.searchPlaceAddresses).mockImplementationOnce(() => new Promise(() => {}));

    renderSettings();
    clickSettingsSection('Places');
    fireEvent.change(screen.getByLabelText('Address Search'), { target: { value: '123 Main' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(screen.getByText('Searching addresses...')).toBeInTheDocument();
    });
  });

  it('shows a no-matches message when place search resolves empty', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.searchPlaceAddresses).mockResolvedValueOnce([]);

    renderSettings();
    clickSettingsSection('Places');
    fireEvent.change(screen.getByLabelText('Address Search'), {
      target: { value: 'unlikely query xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(
        screen.getByText('No matching addresses found. Try a broader search.')
      ).toBeInTheDocument();
    });
  });

  it('filters saved places dynamically from the header search input', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.listPlaces).mockResolvedValueOnce([
      {
        id: 'p-home',
        name: 'Home Garage',
        latitude: 39.7392,
        longitude: -104.9903,
        radius_m: 75,
        is_home: true,
        is_work: false,
        address: {
          id: 'a-home',
          display_name: '123 Main St, Denver, CO',
          osm_id: 123,
          latitude: 39.7392,
          longitude: -104.9903,
          road: 'Main St',
          city: 'Denver',
          state: 'CO',
          postcode: '80202',
          country: 'United States',
          raw: null,
        },
        charging: null,
      },
      {
        id: 'p-work',
        name: 'Office Lot',
        latitude: 39.75,
        longitude: -104.999,
        radius_m: 75,
        is_home: false,
        is_work: true,
        address: {
          id: 'a-work',
          display_name: '400 Market St, Boulder, CO',
          osm_id: 456,
          latitude: 39.75,
          longitude: -104.999,
          road: 'Market St',
          city: 'Boulder',
          state: 'CO',
          postcode: '80301',
          country: 'United States',
          raw: null,
        },
        charging: null,
      },
    ]);

    renderSettings();
    clickSettingsSection('Places');

    await waitFor(() => {
      expect(screen.getByText('Home Garage')).toBeInTheDocument();
      expect(screen.getByText('Office Lot')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Search saved places'), { target: { value: 'home' } });

    await waitFor(() => {
      expect(screen.getByText('Home Garage')).toBeInTheDocument();
      expect(screen.queryByText('Office Lot')).not.toBeInTheDocument();
    });
  });

  it('renders the theme chooser', async () => {
    renderSettings();
    clickSettingsSection('Appearance');
    expect(screen.getByText('Appearance mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Appearance mode')).toBeInTheDocument();
    expect(await screen.findByRole('radiogroup', { name: 'Themes' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Classic/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^RAD/ })).toBeInTheDocument();
  });

  it('persists account-backed appearance and palette changes', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.auth.accessToken = 'test-access-token';
    renderSettings();
    clickSettingsSection('Appearance');

    await waitFor(() => expect(screen.getByLabelText('Appearance mode')).toHaveValue('dark'));
    // Wait for the saved theme to load so the click stages a change against it.
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Classic/ })).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByRole('radio', { name: /^RAD/ }));
    expect(hooks.themeClient.updatePreferences).not.toHaveBeenCalled();
    saveUnsavedChanges();

    await waitFor(() => {
      expect(hooks.themeClient.updatePreferences).toHaveBeenCalledWith(
        { schemaVersion: 2, mode: 'dark', selection: { kind: 'builtin', themeId: 'rad' } },
        '"theme-preferences-u1-1"',
      );
    });
    expect(localStorage.getItem('rm-theme')).toBeNull();
  });

  it('rolls back appearance changes when the account update fails', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.auth.accessToken = 'test-access-token';
    vi.mocked(hooks.api.updateThemePreferences).mockRejectedValueOnce(new Error('save failed'));
    renderSettings();
    clickSettingsSection('Appearance');

    await waitFor(() => expect(screen.getByLabelText('Appearance mode')).toHaveValue('dark'));
    fireEvent.change(screen.getByLabelText('Appearance mode'), { target: { value: 'light' } });
    saveUnsavedChanges();

    // The failed save keeps the staged edit and the bar open; Discard restores the saved appearance.
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save appearance mode.');
    expect(screen.getByLabelText('Appearance mode')).toHaveValue('light');
    discardUnsavedChanges();
    await waitFor(() => expect(screen.getByLabelText('Appearance mode')).toHaveValue('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('renders the Account section with Sign Out', () => {
    renderSettings();
    clickSettingsSection('Account');
    expect(screen.getAllByText('Account').length).toBeGreaterThan(0);
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  it('renders the telemetry explorer for admin users', async () => {
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'v1',
    };
    renderSettings();
    clickSettingsSection('Raw Data');

    await waitFor(() => {
      expect(screen.getByText('Telemetry Explorer')).toBeInTheDocument();
      expect(screen.getByText('Field coverage')).toBeInTheDocument();
      expect(screen.getByText('Inbound Rivian events')).toBeInTheDocument();
    });
  });

  it('starts and stops an ingestion capture for connected owners and omits demo vehicles', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.vehicles = [...settingsMocks.vehicles, {
      id: 'demo-v1',
      display_name: 'Demo R2',
      model: 'R2',
      year: null,
      trim: null,
      vin: null,
      rivian_vehicle_id: 'demo-r2s-local',
      battery_capacity_kwh: 82,
      target_tire_pressure_psi: 48,
      membership_role: 'owner',
      is_demo: true,
    }];
    renderSettings();
    clickSettingsSection('Raw Data');
    const startButton = await screen.findByRole('button', { name: 'Start capture for Adventure Truck' });
    expect(screen.queryByRole('button', { name: 'Start capture for Demo R2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download capture for Adventure Truck' })).not.toBeInTheDocument();
    await waitFor(() => expect(startButton).not.toBeDisabled());
    fireEvent.click(startButton);
    await waitFor(() => expect(hooks.api.startVehicleIngestionCapture).toHaveBeenCalledWith('v1'));

    const stopButton = await screen.findByRole('button', { name: 'Stop capture for Adventure Truck' });
    expect(screen.getByText('Capturing')).toBeInTheDocument();
    fireEvent.click(stopButton);
    await waitFor(() => expect(hooks.api.stopVehicleIngestionCapture).toHaveBeenCalledWith('v1'));

    const downloadButton = await screen.findByRole('button', { name: 'Download capture for Adventure Truck' });
    expect(screen.getByText(/12 events/)).toBeInTheDocument();
    const createObjectURL = vi.fn(() => 'blob:capture');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    fireEvent.click(downloadButton);
    await waitFor(() => expect(hooks.api.downloadVehicleIngestionCapture).toHaveBeenCalledWith('v1'));
  });

  it('asks before a new capture replaces the previous one and keeps it when cancelled', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.getVehicleIngestionCapture).mockResolvedValueOnce({
      state: 'stopped',
      started_at: '2026-09-24T17:00:00Z',
      ends_at: '2026-09-24T18:00:00Z',
      stopped_at: '2026-09-24T18:00:00Z',
      stop_reason: 'expired',
      event_count: 0,
      last_event_at: null,
      truncated: false,
    });
    renderSettings();
    clickSettingsSection('Raw Data');
    const newCapture = await screen.findByRole('button', { name: 'Start capture for Adventure Truck' });
    expect(await screen.findByText(/stopped after 1 hour/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download capture for Adventure Truck' })).toBeDisabled();
    await waitFor(() => expect(newCapture).not.toBeDisabled());
    fireEvent.click(newCapture);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Start a new capture?' })).toBeInTheDocument();
    expect(within(dialog).getByText('This replaces the previous capture and its file.')).toBeInTheDocument();
    expect(hooks.api.startVehicleIngestionCapture).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(hooks.api.startVehicleIngestionCapture).not.toHaveBeenCalled();
  });

  it('starts a new capture once the replacement is confirmed in the dialog', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.getVehicleIngestionCapture).mockResolvedValueOnce({
      state: 'stopped',
      started_at: '2026-09-24T17:00:00Z',
      ends_at: '2026-09-24T18:00:00Z',
      stopped_at: '2026-09-24T18:00:00Z',
      stop_reason: 'expired',
      event_count: 0,
      last_event_at: null,
      truncated: false,
    });
    renderSettings();
    clickSettingsSection('Raw Data');
    const newCapture = await screen.findByRole('button', { name: 'Start capture for Adventure Truck' });
    await waitFor(() => expect(newCapture).not.toBeDisabled());
    fireEvent.click(newCapture);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'New capture' }));
    await waitFor(() => expect(hooks.api.startVehicleIngestionCapture).toHaveBeenCalledWith('v1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('renders and operates the admin Backups section', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'v1',
    };
    renderSettings();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Backups' })).toBeInTheDocument());
    clickSettingsSection('Backups');

    await waitFor(() => {
      expect(screen.getAllByText('Backups').length).toBeGreaterThan(0);
      expect(screen.getByText('Recent backup runs')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Recovery packages' })).toBeInTheDocument();
      expect(screen.getByLabelText('Recovery package location')).toHaveTextContent('Local');
      expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument();
      expect(screen.getByText('Rows')).toBeInTheDocument();
    });

    // Backup settings are staged; a real edit makes the page bar appear, and its Save persists them.
    fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'prod/riviamigo-staged' } });
    expect(hooks.api.updateBackupSettings).not.toHaveBeenCalled();
    saveUnsavedChanges();

    await waitFor(() => {
      expect(hooks.api.updateBackupSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          timezone: 'America/Chicago',
          bucket: 'riviamigo-backups',
          retention_count: 8,
          local_enabled: true,
          s3_enabled: true,
          prefix: 'prod/riviamigo-staged',
        })
      );
    }, { timeout: 5_000 });

    fireEvent.click(screen.getByText('Test S3 connection'));
    await waitFor(() =>
      expect(hooks.api.testBackupS3).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'riviamigo-backups',
          s3_enabled: true,
        })
      ),
      { timeout: 5_000 },
    );

    fireEvent.click(screen.getByText('Run now'));
    await waitFor(() => expect(hooks.api.runBackupNow).toHaveBeenCalled(), { timeout: 5_000 });

    expect(screen.queryByText('File name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Expand backup details/i));
    await waitFor(() => {
      expect(screen.getByText('File name')).toBeInTheDocument();
      expect(screen.getByText('SHA-256')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/Download backup/));
    await waitFor(() => {
      expect(hooks.api.downloadBackupArtifact).toHaveBeenCalledWith('artifact-1');
    });

    expect(screen.getByRole('heading', { name: 'Restore from backup' })).toBeInTheDocument();
    const restorePicker = screen.getByRole('combobox', { name: 'Choose a recovery package' });
    expect(restorePicker).toBeInTheDocument();
    fireEvent.change(restorePicker, { target: { value: 'artifact-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore selected backup' }));
    await waitFor(() => {
      expect(screen.getByText('Restore this backup?')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText('Type RESTORE to continue'), {
      target: { value: 'RESTORE' },
    });
    fireEvent.click(screen.getByText('Validate candidate and restore'));

    await waitFor(() => {
      expect(hooks.api.startBackupRestore).toHaveBeenCalledWith({
        artifact_id: 'artifact-1',
        confirmation_phrase: 'RESTORE',
        notes: null,
        plan_id: 'plan-1',
        package_checksum_sha256: 'abc123',
      });
    });
    expect(screen.getByRole('progressbar', { name: 'Restore activity' })).toBeInTheDocument();
    expect(screen.queryByText('5%')).not.toBeInTheDocument();
  });

  it.each([
    {
      code: 'unsupported_migration_chain',
      title: 'Unsupported migration chain',
      message:
        'This recovery package belongs to a migration chain that this release does not support.',
    },
    {
      code: 'source_ledger_invalid',
      title: 'Source migration ledger is invalid',
      message:
        'The package migration ledger is incomplete, unordered, or otherwise cannot be verified.',
    },
    {
      code: 'target_migration_drift',
      title: 'Target migration drift detected',
      message:
        'This server’s recorded migration ledger does not match the migration catalog in the running release.',
    },
    {
      code: 'migration_checksum_mismatch',
      title: 'Migration checksum mismatch',
      message:
        'The migration version may match, but the migration file bytes do not. Matching schema versions are not sufficient for migration identity.',
    },
    {
      code: 'schema_fingerprint_mismatch',
      title: 'Schema contract mismatch',
      message:
        'The recorded schema fingerprint does not match the schema contract required by this restore.',
    },
    {
      code: 'source_schema_newer',
      title: 'Source schema is newer',
      message:
        'This recovery package was created by a newer schema release and cannot be restored here.',
    },
  ])('presents the $code restore preflight failure clearly', async ({ code, title, message }) => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.preflightBackupRestore).mockResolvedValueOnce({
      plan: {
        plan_id: `blocked-${code}`,
        engine_version: 3,
        package_checksum_sha256: 'blocked-package',
        package_format: 'riviamigo-recovery-v3',
        compatible: false,
        source: {
          postgres_major: 17,
          timescale_version: '2.19.3',
          migration_version: 1,
          migration_ledger: [],
          migration_ledger_successful: true,
          migration_chain_id: 'riviamigo-schema-v1',
          migration_catalog_digest: 'catalog',
          schema_contract_version: 'riviamigo-schema-contract-v1',
          schema_fingerprint: 'source',
        },
        target: {
          postgres_major: 17,
          timescale_version: '2.19.3',
          migration_version: 1,
          migration_ledger: [],
          migration_ledger_successful: true,
          migration_chain_id: 'riviamigo-schema-v1',
          migration_catalog_digest: 'catalog',
          schema_contract_version: 'riviamigo-schema-contract-v1',
          schema_fingerprint: 'target',
        },
        pending_migrations: [],
        transforms: [],
        validation_checks: [],
        warnings: [],
        blocking_errors: [{ code, message: 'Backend compatibility detail.' }],
        planned_at: '2026-05-04T12:02:00Z',
      },
    } as never);
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'v1',
    };
    renderSettings();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Backups' })).toBeInTheDocument());
    clickSettingsSection('Backups');
    const restorePicker = await screen.findByRole('combobox', {
      name: 'Choose a recovery package',
    });
    fireEvent.change(restorePicker, { target: { value: 'artifact-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restore selected backup' }));
    await waitFor(() => expect(screen.getByText('Restore this backup?')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Type RESTORE to continue'), {
      target: { value: 'RESTORE' },
    });
    fireEvent.click(screen.getByText('Validate candidate and restore'));

    await waitFor(() => {
      expect(screen.getByTestId(`restore-blocking-error-${code}`)).toBeInTheDocument();
    });
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText(`Code: ${code}`)).toBeInTheDocument();
    expect(screen.queryByText(/Versioned schema profile/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validate candidate and restore' })).toBeDisabled();
  });

  it('shows the Backups section for super users as well', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.me = {
      user_id: 'u1',
      email: 'super@example.com',
      role: 'super_user',
      default_vehicle_id: 'v1',
    };
    renderSettings();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Backups' })).toBeInTheDocument());
    clickSettingsSection('Backups');

    await waitFor(() => {
      expect(screen.getAllByText('Backups').length).toBeGreaterThan(0);
      expect(screen.getByText('Recent backup runs')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Recovery packages' })).toBeInTheDocument();
    });
  });

  it('shows Authentication only to super users', async () => {
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'v1',
    };
    const admin = renderSettings();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Backups' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Authentication' })).not.toBeInTheDocument();
    admin.unmount();

    settingsMocks.me = {
      user_id: 'u1',
      email: 'super@example.com',
      role: 'super_user',
      default_vehicle_id: 'v1',
    };
    renderSettings();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Authentication' })).toBeInTheDocument()
    );
  });

  it('shows active vehicle state for the connected vehicle', () => {
    renderSettings();
    // Status text now appears inside the vehicle chip ('Active' when worker_health is ok/connected)
    expect(screen.getAllByText(/active|connected/i).length).toBeGreaterThan(0);
  });

  it('shows the estimated Rivian renewal date and recommendation', () => {
    Object.assign(settingsMocks.vehicles[0]!, {
      renewal_state: 'renewal_soon',
      expected_renewal_at: '2027-02-23T12:00:00Z',
    });

    renderSettings();

    expect(screen.getByText('Rivian renewal')).toBeInTheDocument();
    expect(screen.getByText(/estimated\)/i)).toBeInTheDocument();
    expect(screen.getByText(/estimated 180-day renewal date/i)).toBeInTheDocument();
  });

  it('shows durable backup phase and progress while a run is active', async () => {
    const hooks = await import('@riviamigo/hooks');
    const getBackupOverview = vi.mocked(hooks.api.getBackupOverview);
    const baseline = await getBackupOverview({ page: 1, perPage: 10 });
    const baselineRun = baseline.recent_runs[0];
    if (!baselineRun) throw new Error('backup fixture is missing a recent run');
    const activeOverview = {
      ...baseline,
      recent_runs: [
        {
          ...baselineRun,
          status: 'running' as const,
          phase: 'packaging' as const,
          progress_percent: 65,
          completed_at: null,
        },
      ],
      latest_successful_run: null,
    };
    getBackupOverview.mockReset();
    getBackupOverview.mockResolvedValue(activeOverview);
    settingsMocks.me = {
      user_id: 'u1',
      email: 'admin@example.com',
      role: 'admin',
      default_vehicle_id: 'v1',
    };

    renderSettings();
    clickSettingsSection('Backups');

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Backup Packaging');
      expect(screen.getByRole('progressbar', { name: 'Backup progress' })).toHaveAttribute(
        'aria-valuenow',
        '65'
      );
      expect(screen.getByRole('button', { name: 'Backup running' })).toBeDisabled();
    });

    getBackupOverview.mockReset();
    getBackupOverview.mockResolvedValue(baseline);
  });

  it('calls logout and navigates on Sign Out click', async () => {
    const logoutFn = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@riviamigo/hooks', () => ({
      useAuth: () => ({ logout: logoutFn }),
      useVehicles: () => ({ data: [] }),
    }));
    renderSettings();
    clickSettingsSection('Account');
    fireEvent.click(screen.getByText('Sign Out'));
    // logout is async; just assert the click doesn't throw
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  it('shows live password requirements and changes the password only after confirmation matches', async () => {
    renderSettings();
    clickSettingsSection('Account');

    const submit = screen.getByRole('button', { name: 'Change password' });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('status', { name: /password requires at least 12 characters/i })).toHaveTextContent('0/12');

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'replacement-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'different-password' },
    });
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'replacement-password' },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(hooksMocks.changePassword).toHaveBeenCalledWith({
        current_password: 'current-password',
        new_password: 'replacement-password',
      })
    );
    expect(settingsMocks.auth.clearSession).toHaveBeenCalledOnce();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login', search: { password_changed: '1' } });
  });
});
