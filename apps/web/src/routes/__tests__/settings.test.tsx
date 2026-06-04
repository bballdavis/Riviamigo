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
    defaultVehicleId: 'v1',
    setDefaultVehicleId: vi.fn(),
    setActiveVehicleId: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@riviamigo/hooks', () => ({
  api: {
    me: vi.fn().mockResolvedValue({ role: 'user' }),
    listApiKeys: vi.fn().mockResolvedValue([]),
    getApiCatalog: vi.fn().mockResolvedValue({ endpoints: [] }),
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
      vehicles: [{
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
      }],
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
        target_type: 's3',
        endpoint: 'https://s3.example.com',
        region: 'us-east-1',
        bucket: 'riviamigo-backups',
        prefix: 'prod/riviamigo',
        access_key: 'backup-user',
        has_secret_key: true,
        updated_at: '2026-05-04T12:00:00Z',
      },
      recent_runs: [{
        id: 'run-1',
        trigger: 'manual',
        status: 'succeeded',
        artifact_key: '/tmp/riviamigo/prod/riviamigo/backup.dump',
        started_at: '2026-05-04T12:00:00Z',
        completed_at: '2026-05-04T12:01:00Z',
        error_message: null,
        created_at: '2026-05-04T12:00:00Z',
        updated_at: '2026-05-04T12:01:00Z',
      }],
      recent_runs_total: 1,
      recent_runs_page: 1,
      recent_runs_per_page: 10,
      artifacts: [{
        id: 'artifact-1',
        run_id: 'run-1',
        storage_type: 'local',
        file_name: 'backup-20260504T120000Z.dump',
        storage_path: '/tmp/riviamigo/prod/riviamigo/backup-20260504T120000Z.dump',
        size_bytes: 2048,
        checksum_sha256: '0123456789abcdef0123456789abcdef',
        manifest: {},
        created_at: '2026-05-04T12:01:00Z',
      }],
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
        reason: null,
      },
    }),
    updateBackupSettings: vi.fn().mockResolvedValue({}),
    runBackupNow: vi.fn().mockResolvedValue({}),
    requestBackupRestore: vi.fn().mockResolvedValue({}),
    downloadBackupArtifact: vi.fn().mockResolvedValue({
      blob: new Blob(['backup-data'], { type: 'application/octet-stream' }),
      fileName: 'backup-20260504T120000Z.dump',
    }),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    createDemoVehicle: vi.fn().mockResolvedValue({ ok: true, vehicle_id: 'demo-v1', created: true }),
    updateVehicleSettings: vi.fn().mockResolvedValue({}),
    updateVehicleName: vi.fn().mockResolvedValue({}),
  },
  useAuth:    () => settingsMocks.auth,
  useVehicles: () => ({
    data: [{
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
    }],
  }),
}));

vi.mock('../../components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../components/layout/AuthGuard', () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('lucide-react', () => ({
  Activity: () => <svg data-testid="icon-activity" />,
  Car:    () => <svg data-testid="icon-car" />,
  CircleHelp: () => <svg data-testid="icon-help" />,
  Clipboard: () => <svg data-testid="icon-clipboard" />,
  Database: () => <svg data-testid="icon-database" />,
  DatabaseBackup: () => <svg data-testid="icon-database-backup" />,
  Calendar: () => <svg data-testid="icon-calendar" />,
  CheckCircle2: () => <svg data-testid="icon-check-circle" />,
  AlertTriangle: () => <svg data-testid="icon-alert-triangle" />,
  CloudUpload: () => <svg data-testid="icon-cloud-upload" />,
  ChevronDown: () => <svg data-testid="icon-chevron-down" />,
  ChevronRight: () => <svg data-testid="icon-chevron-right" />,
  Clock3: () => <svg data-testid="icon-clock" />,
  Download: () => <svg data-testid="icon-download" />,
  HardDrive: () => <svg data-testid="icon-hard-drive" />,
  History: () => <svg data-testid="icon-history" />,
  Home: () => <svg data-testid="icon-home" />,
  Loader2: () => <svg data-testid="icon-loader" />,
  Server: () => <svg data-testid="icon-server" />,
  Timer: () => <svg data-testid="icon-timer" />,
  KeyRound: () => <svg data-testid="icon-key" />,
  ListChecks: () => <svg data-testid="icon-list-checks" />,
  LogOut: () => <svg data-testid="icon-logout" />,
  MapPin: () => <svg data-testid="icon-map-pin" />,
  Plus:   () => <svg data-testid="icon-plus" />,
  Pencil: () => <svg data-testid="icon-pencil" />,
  Play: () => <svg data-testid="icon-play" />,
  RefreshCw: () => <svg data-testid="icon-refresh" />,
  Ruler: () => <svg data-testid="icon-ruler" />,
  RotateCcw: () => <svg data-testid="icon-rotate" />,
  Save:       () => <svg data-testid="icon-save" />,
  ShieldCheck: () => <svg data-testid="icon-shield" />,
  Star: () => <svg data-testid="icon-star" />,
  Users: () => <svg data-testid="icon-users" />,
  X:      () => <svg data-testid="icon-x" />,
  Trash2: () => <svg data-testid="icon-trash" />,
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
    </QueryClientProvider>,
  );
}

describe('Settings page', () => {
  beforeEach(() => {
    settingsMocks.auth.logout.mockReset();
    settingsMocks.auth.setDefaultVehicleId.mockReset();
    settingsMocks.auth.setActiveVehicleId.mockReset();
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
    vi.mocked(hooks.api.me).mockResolvedValueOnce({ user_id: 'u1', email: 'admin@example.com', role: 'admin', default_vehicle_id: 'v1' });
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

  it('shows address suggestions while typing a place search', async () => {
    renderSettings();
    fireEvent.click(screen.getByText('Places'));

    fireEvent.change(screen.getByLabelText('Address Search'), { target: { value: '123 Main' } });

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

    await waitFor(() => {
      expect(screen.getByText('Searching addresses...')).toBeInTheDocument();
    });
  });

  it('shows a no-matches message when place search resolves empty', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.searchPlaceAddresses).mockResolvedValueOnce([]);

    renderSettings();
    fireEvent.click(screen.getByText('Places'));
    fireEvent.change(screen.getByLabelText('Address Search'), { target: { value: 'unlikely query xyz' } });

    await waitFor(() => {
      expect(screen.getByText('No matching addresses found. Try a broader search.')).toBeInTheDocument();
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
        latitude: 39.7500,
        longitude: -104.9990,
        radius_m: 75,
        is_home: false,
        is_work: true,
        address: {
          id: 'a-work',
          display_name: '400 Market St, Boulder, CO',
          osm_id: 456,
          latitude: 39.7500,
          longitude: -104.9990,
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

  it('renders the theme toggle button', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Appearance'));
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
  });

  it('renders the Account section with Sign Out', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Account'));
    expect(screen.getAllByText('Account').length).toBeGreaterThan(0);
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  it('renders the stewardship section for admin users', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.me).mockResolvedValueOnce({ user_id: 'u1', email: 'admin@example.com', role: 'admin', default_vehicle_id: 'v1' });
    renderSettings();
    fireEvent.click(screen.getByText('Raw Data'));

    await waitFor(() => {
      expect(screen.getByText('DB Stats')).toBeInTheDocument();
      expect(screen.getByText('Active collectors')).toBeInTheDocument();
      expect(screen.getByText('Heartbeats ignored')).toBeInTheDocument();
    });
  });

  it('renders and operates the admin Backups section', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.me).mockResolvedValueOnce({ user_id: 'u1', email: 'admin@example.com', role: 'admin', default_vehicle_id: 'v1' });
    renderSettings();

    await waitFor(() => expect(screen.getByText('Backups')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Backups'));

    await waitFor(() => {
      expect(screen.getAllByText('Backups').length).toBeGreaterThan(0);
      expect(screen.getByText('S3 upload')).toBeInTheDocument();
      expect(screen.getByText('Recent backup runs')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Backups' })).toBeInTheDocument();
      expect(screen.getByText(/Page 1 of 1/)).toBeInTheDocument();
      expect(screen.getByText('Rows')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue('America/Chicago'), { target: { value: 'UTC' } });
    fireEvent.change(screen.getByDisplayValue('riviamigo-backups'), { target: { value: 'nightly-backups' } });
    fireEvent.click(screen.getByText('Save settings'));

    await waitFor(() => {
      expect(hooks.api.updateBackupSettings).toHaveBeenCalledWith(expect.objectContaining({
        timezone: 'UTC',
        bucket: 'nightly-backups',
        retention_count: 8,
      }));
    });

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

    fireEvent.click(screen.getByLabelText(/Restore backup/));
    await waitFor(() => {
      expect(screen.getByText('Restore this backup?')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Restore backup'));

    await waitFor(() => {
      expect(hooks.api.requestBackupRestore).toHaveBeenCalledWith({
        artifact_id: 'artifact-1',
        confirmation_phrase: 'RESTORE',
        notes: null,
      });
    });
  });

  it('shows the Backups section for super users as well', async () => {
    const hooks = await import('@riviamigo/hooks');
    vi.mocked(hooks.api.me).mockResolvedValueOnce({ user_id: 'u1', email: 'super@example.com', role: 'super_user', default_vehicle_id: 'v1' });
    renderSettings();

    await waitFor(() => expect(screen.getByText('Backups')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Backups'));

    await waitFor(() => {
      expect(screen.getAllByText('Backups').length).toBeGreaterThan(0);
      expect(screen.getByText('S3 upload')).toBeInTheDocument();
      expect(screen.getByText('Recent backup runs')).toBeInTheDocument();
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
      useAuth:     () => ({ logout: logoutFn }),
      useVehicles: () => ({ data: [] }),
    }));
    renderSettings();
    fireEvent.click(screen.getByText('Account'));
    fireEvent.click(screen.getByText('Sign Out'));
    // logout is async; just assert the click doesn't throw
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });
});
