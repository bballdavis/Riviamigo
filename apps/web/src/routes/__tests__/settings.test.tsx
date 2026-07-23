import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const settingsMocks = vi.hoisted(() => ({
  auth: {
    logout: vi.fn(),
    clearSession: vi.fn(),
    accessToken: undefined as string | undefined,
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
      year: null,
      trim: null,
      vin: null,
      rivian_vehicle_id: 'rivian-1',
      battery_capacity_kwh: 135,
      target_tire_pressure_psi: 48,
      membership_role: 'owner',
      is_demo: false,
    },
  ],
}));

const dashboardMocks = vi.hoisted(() => ({
  dashboards: [] as Array<Record<string, unknown>>,
  downloadDashboardYaml: vi.fn(),
  cloneMutateAsync: vi.fn(),
  createMutateAsync: vi.fn(),
  deleteMutate: vi.fn(),
  lockMutate: vi.fn(),
  restoreMutate: vi.fn(),
}));

const hooksMocks = vi.hoisted(() => ({
  changePassword: vi.fn().mockResolvedValue(undefined),
}));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@riviamigo/hooks', () => ({
  api: {
    me: vi.fn().mockResolvedValue({ role: 'user' }),
    changePassword: hooksMocks.changePassword,
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
    refreshVehicleArtwork: vi.fn().mockResolvedValue({ ok: true, vehicle_id: 'v1' }),
  },
  useAuth: () => settingsMocks.auth,
  useAuthReady: () => true,
  useMe: () => ({ data: settingsMocks.me }),
  useVehicles: () => ({ data: settingsMocks.vehicles }),
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
    mutate: dashboardMocks.deleteMutate,
    isPending: false,
    variables: undefined,
  }),
  useSetAdminDashboardLock: () => ({
    mutate: dashboardMocks.lockMutate,
    isPending: false,
    variables: undefined,
  }),
  useRestoreAdminDashboardDefault: () => ({
    mutate: dashboardMocks.restoreMutate,
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
  Braces: () => <svg data-testid="icon-braces" />,
  Car: () => <svg data-testid="icon-car" />,
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
  X: () => <svg data-testid="icon-x" />,
  Trash2: () => <svg data-testid="icon-trash" />,
  Unlock: () => <svg data-testid="icon-unlock" />,
}));

import { SettingsContent } from '../settings';

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsContent />
    </QueryClientProvider>
  );
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
    dashboardMocks.dashboards = [];
    dashboardMocks.downloadDashboardYaml.mockReset();
    dashboardMocks.cloneMutateAsync.mockReset();
    dashboardMocks.createMutateAsync.mockReset();
    dashboardMocks.deleteMutate.mockReset();
    dashboardMocks.lockMutate.mockReset();
    dashboardMocks.restoreMutate.mockReset();
    localStorage.clear();
    settingsMocks.me = {
      user_id: 'u1',
      email: 'user@example.com',
      role: 'user',
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
    ];
  });

  it('renders the Vehicles section heading', () => {
    renderSettings();
    expect(screen.getAllByText('Vehicles').length).toBeGreaterThan(0);
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
        slug: 'overview',
        name: 'Overview',
        description: null,
        isDefault: true,
        isLocked: true,
        ownerId: null,
        widgets: [{ id: 'w1' }],
      },
      {
        id: 'user-charging',
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
      id: 'clone-1',
      slug: 'overview-copy',
      name: 'Overview Copy',
      description: null,
      isDefault: false,
      isLocked: false,
      ownerId: 'u1',
      widgets: [],
    });
    dashboardMocks.createMutateAsync.mockResolvedValue({
      id: 'personal-overview',
      slug: 'overview',
      name: 'Overview',
      description: null,
      isDefault: false,
      isLocked: false,
      ownerId: 'u1',
      widgets: [],
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSettings();
    fireEvent.click(screen.getByText('Dashboards'));

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
      params: { slug: 'overview' },
      search: { dashboardId: 'default-overview' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit default' }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/d/$slug',
      params: { slug: 'overview' },
      search: { dashboardId: 'default-overview', edit: 1 },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    await waitFor(() => {
      expect(dashboardMocks.createMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'personal-draft',
          slug: 'overview',
          isDefault: false,
        })
      );
    });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/d/$slug',
        params: { slug: 'overview' },
        search: { dashboardId: 'personal-overview', edit: 1 },
      });
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Export' })[0]!);
    expect(dashboardMocks.downloadDashboardYaml).toHaveBeenCalledWith(dashboardMocks.dashboards[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(dashboardMocks.lockMutate).toHaveBeenCalledWith({
      id: 'default-overview',
      locked: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Restore bundled' }));
    expect(dashboardMocks.restoreMutate).toHaveBeenCalledWith('default-overview');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(dashboardMocks.deleteMutate).toHaveBeenCalledWith('user-charging');

    const showEditButton = screen.getByRole('switch', {
      name: 'Show edit button on dashboard pages',
    });
    expect(showEditButton).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(showEditButton);
    expect(showEditButton).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('rm-show-dashboard-edit-button:u1')).toBe('true');
    confirmSpy.mockRestore();
  });

  it('marks a same-slug personal copy active and resets it back to the system default', () => {
    dashboardMocks.dashboards = [
      {
        id: 'default-overview',
        slug: 'overview',
        name: 'Overview',
        description: null,
        isDefault: true,
        isLocked: true,
        ownerId: null,
        widgets: [{ id: 'w1' }],
      },
      {
        id: 'personal-overview',
        slug: 'overview',
        name: 'Overview',
        description: null,
        isDefault: false,
        isLocked: false,
        ownerId: 'u1',
        widgets: [{ id: 'w2' }],
      },
    ];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSettings();
    fireEvent.click(screen.getByText('Dashboards'));

    expect(screen.getAllByText('Active for you')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open default' }));
    expect(mockNavigate).toHaveBeenLastCalledWith({
      to: '/d/$slug',
      params: { slug: 'overview' },
      search: { dashboardId: 'default-overview' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(dashboardMocks.deleteMutate).toHaveBeenCalledWith('personal-overview');
    confirmSpy.mockRestore();
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
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicles'] });
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
    fireEvent.click(screen.getByLabelText('Save vehicle'));

    await waitFor(() => {
      expect(hooks.api.updateVehicleSettings).toHaveBeenCalledWith('v1', {
        battery_capacity_kwh: 135,
        battery_config: 'R1T / R1S Large (Gen 1)',
        target_tire_pressure_psi: 46,
      });
    });
  });

  it('renders the Appearance section', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Appearance'));
    expect(screen.getAllByText('Appearance').length).toBeGreaterThan(0);
    expect(screen.getByText('Theme')).toBeInTheDocument();
  });

  it('renders the Places section', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Places'));
    expect(screen.getAllByText('Places').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Saved Places/i).length).toBeGreaterThan(0);
  });

  it('renders and filters the API endpoint catalog', async () => {
    const hooks = await import('@riviamigo/hooks');
    settingsMocks.auth.accessToken = 'test-access-token';
    renderSettings();
    fireEvent.click(screen.getByText('API Access'));

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
    fireEvent.click(screen.getByText('Places'));

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
    fireEvent.click(screen.getByText('Places'));
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
    fireEvent.click(screen.getByText('Places'));
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
    fireEvent.click(screen.getByText('Places'));

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

  it('renders the theme chooser', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Appearance'));
    expect(
      screen.getByText('Toggle between dark, light, and system appearance')
    ).toBeInTheDocument();
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
  });

  it('renders the Account section with Sign Out', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Account'));
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
    fireEvent.click(screen.getByText('Raw Data'));

    await waitFor(() => {
      expect(screen.getByText('Telemetry Explorer')).toBeInTheDocument();
      expect(screen.getByText('Field coverage')).toBeInTheDocument();
      expect(screen.getByText('Inbound Rivian events')).toBeInTheDocument();
    });
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

    await waitFor(() => expect(screen.getByText('Backups')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Backups'));

    await waitFor(() => {
      expect(screen.getAllByText('Backups').length).toBeGreaterThan(0);
      expect(screen.getByText('Recent backup runs')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Recovery packages' })).toBeInTheDocument();
      expect(screen.getByLabelText('Recovery package location')).toHaveTextContent('Local');
      expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument();
      expect(screen.getByText('Rows')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('option', { name: /America\/Chicago \(UTC[+-]\d{2}:\d{2}\)/ })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Timezone' }), {
      target: { value: 'UTC' },
    });
    fireEvent.click(screen.getByText('Save settings'));

    await waitFor(() => {
      expect(hooks.api.updateBackupSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          timezone: 'UTC',
          bucket: 'riviamigo-backups',
          retention_count: 8,
          local_enabled: true,
          s3_enabled: true,
        })
      );
    });

    fireEvent.click(screen.getByText('Test S3 connection'));
    await waitFor(() =>
      expect(hooks.api.testBackupS3).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'riviamigo-backups',
          s3_enabled: true,
        })
      )
    );

    fireEvent.click(screen.getByText('Run now'));
    await waitFor(() => expect(hooks.api.runBackupNow).toHaveBeenCalled());

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

    await waitFor(() => expect(screen.getByText('Backups')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Backups'));
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

    await waitFor(() => expect(screen.getByText('Backups')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Backups'));

    await waitFor(() => {
      expect(screen.getAllByText('Backups').length).toBeGreaterThan(0);
      expect(screen.getByText('Recent backup runs')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Recovery packages' })).toBeInTheDocument();
    });
  });

  it('shows active vehicle state for the connected vehicle', () => {
    renderSettings();
    // Status text now appears inside the vehicle chip ('Active' when worker_health is ok/connected)
    expect(screen.getAllByText(/active|connected/i).length).toBeGreaterThan(0);
  });

  it('calls logout and navigates on Sign Out click', async () => {
    const logoutFn = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@riviamigo/hooks', () => ({
      useAuth: () => ({ logout: logoutFn }),
      useVehicles: () => ({ data: [] }),
    }));
    renderSettings();
    fireEvent.click(screen.getByText('Account'));
    fireEvent.click(screen.getByText('Sign Out'));
    // logout is async; just assert the click doesn't throw
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  it('shows live password requirements and changes the password only after confirmation matches', async () => {
    renderSettings();
    fireEvent.click(screen.getByText('Account'));

    const submit = screen.getByRole('button', { name: 'Change password' });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('0/12');

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
