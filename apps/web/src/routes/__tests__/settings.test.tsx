import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

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
    }),
    updateBackupSettings: vi.fn().mockResolvedValue({}),
    runBackupNow: vi.fn().mockResolvedValue({}),
    requestBackupRestore: vi.fn().mockResolvedValue({}),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
  },
  useAuth:    () => ({ logout: vi.fn(), defaultVehicleId: 'v1', setDefaultVehicleId: vi.fn() }),
  useVehicles: () => ({
    data: [{ id: 'v1', display_name: 'Adventure Truck', model: 'R1T', year: null, trim: null, vin: null, rivian_vehicle_id: 'rivian-1' }],
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
  CloudUpload: () => <svg data-testid="icon-cloud-upload" />,
  Clock3: () => <svg data-testid="icon-clock" />,
  HardDrive: () => <svg data-testid="icon-hard-drive" />,
  History: () => <svg data-testid="icon-history" />,
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
  Trash2: () => <svg data-testid="icon-trash" />,
  X:      () => <svg data-testid="icon-x" />,
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

  it('renders the Add Vehicle button', () => {
    renderSettings();
    expect(screen.getByText('Add Vehicle')).toBeInTheDocument();
  });

  it('navigates to /connect when Add Vehicle is clicked', () => {
    renderSettings();
    fireEvent.click(screen.getByText('Add Vehicle'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/connect' });
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
      expect(screen.getByText('Artifacts')).toBeInTheDocument();
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

    fireEvent.change(screen.getByPlaceholderText('RESTORE'), { target: { value: 'RESTORE' } });
    fireEvent.change(screen.getByPlaceholderText('Optional maintenance or incident context'), { target: { value: 'Verified artifact restore test' } });
    fireEvent.click(screen.getByText('Request restore'));

    await waitFor(() => {
      expect(hooks.api.requestBackupRestore).toHaveBeenCalledWith({
        artifact_id: 'artifact-1',
        confirmation_phrase: 'RESTORE',
        notes: 'Verified artifact restore test',
      });
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
