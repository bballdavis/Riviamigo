import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaintenanceJobStatus } from '@riviamigo/hooks';
import type { Vehicle } from '@riviamigo/types';

vi.mock('@riviamigo/ui/primitives', async () => import('../../../test/mockPrimitives'));
vi.mock('@riviamigo/ui/lib/dateTime', () => ({ formatAppDateTime: (value: string) => `at ${value}` }));
vi.mock('lucide-react', () => ({ Play: () => <svg /> }));

const api = vi.hoisted(() => ({
  getBackfillStatus: vi.fn(),
  triggerBackfill: vi.fn(),
  listMaintenanceJobs: vi.fn(),
  startMaintenanceJob: vi.fn(),
  listSiteMaintenanceJobs: vi.fn(),
  startSiteMaintenanceJob: vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({ api }));

import { JobsSection } from '../JobsSection';

function job(overrides: Partial<MaintenanceJobStatus> = {}): MaintenanceJobStatus {
  return {
    kind: 'recompute_charging_costs',
    title: 'Recalculate charging costs',
    description: "Prices every vehicle's charging sessions again.",
    automatic: false,
    schedule: null,
    can_run: true,
    status: null,
    trigger: null,
    started_at: null,
    finished_at: null,
    summary: null,
    error: null,
    ...overrides,
  };
}

const catchUp = job({
  kind: 'location_weather_catch_up',
  title: 'Location and weather catch-up',
  description: 'Fills in missing addresses and queues weather lookups.',
  automatic: true,
  schedule: 'Every 6 hours',
  status: 'done',
  trigger: 'automatic',
  started_at: '2026-11-12T12:00:00Z',
  finished_at: '2026-11-12T12:01:00Z',
  summary: '37 addresses filled · 12 weather lookups queued',
});

const cleanup = job({
  kind: 'security_log_cleanup',
  title: 'Security log cleanup',
  description: 'Removes security log events older than a year.',
  automatic: true,
  schedule: 'Daily',
  can_run: false,
});

const recovery = job({
  kind: 'recover_missed_charge_sessions',
  title: 'Recover missed charging sessions',
  description: 'Adds charging sessions that telemetry shows but Riviamigo never recorded.',
});

function vehicle(id: string, name: string, role: Vehicle['membership_role'] = 'owner'): Vehicle {
  return {
    id,
    display_name: name,
    model: 'R1S',
    membership_role: role,
    history_backfill_status: 'done',
    history_backfilled_at: null,
    history_session_count: 12,
  } as Vehicle;
}

function renderSection({
  canManageInstallation = true,
  vehicles = [vehicle('vehicle-1', 'Castor')],
}: { canManageInstallation?: boolean; vehicles?: Vehicle[] } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JobsSection vehicles={vehicles} canManageInstallation={canManageInstallation} />
    </QueryClientProvider>,
  );
}

async function rowFor(title: string) {
  return (await screen.findByText(title)).closest('li') as HTMLLIElement;
}

describe('JobsSection', () => {
  beforeEach(() => {
    api.getBackfillStatus.mockReset().mockResolvedValue({
      vehicle_id: 'vehicle-1',
      history_backfilled_at: null,
      status: 'done',
      rivian_session_count: 12,
      local_session_count: 12,
    });
    api.triggerBackfill.mockReset();
    api.listMaintenanceJobs.mockReset().mockResolvedValue([recovery]);
    api.startMaintenanceJob.mockReset();
    api.listSiteMaintenanceJobs.mockReset().mockResolvedValue([catchUp, cleanup, job()]);
    api.startSiteMaintenanceJob.mockReset();
  });

  it('groups site-wide jobs into automatic and manual', async () => {
    renderSection();
    const automatic = (await screen.findByText('Automatic')).closest('section') as HTMLElement;
    const manual = screen.getByText('Manual').closest('section') as HTMLElement;
    expect(within(automatic).getByText('Location and weather catch-up')).toBeInTheDocument();
    expect(within(automatic).getByText('Security log cleanup')).toBeInTheDocument();
    expect(within(manual).getByText('Recalculate charging costs')).toBeInTheDocument();
    expect(within(manual).queryByText('Security log cleanup')).not.toBeInTheDocument();
  });

  it('shows an automatic job’s schedule, last run, and result on one line', async () => {
    renderSection();
    const row = await rowFor('Location and weather catch-up');
    expect(within(row).getByText(
      'Every 6 hours · Last run at 2026-11-12T12:01:00Z · 37 addresses filled · 12 weather lookups queued',
    )).toBeInTheDocument();
    expect(within(row).getByText('Done')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Run location and weather catch-up' })).toHaveTextContent('Run now');
  });

  it('marks an automatic job someone ran by hand', async () => {
    api.listSiteMaintenanceJobs.mockResolvedValue([{ ...catchUp, trigger: 'manual', summary: null }]);
    renderSection();
    const row = await rowFor('Location and weather catch-up');
    expect(within(row).getByText('Every 6 hours · Last run at 2026-11-12T12:01:00Z (manual run)')).toBeInTheDocument();
  });

  it('shows never-run jobs as not run yet and leaves out Run where a job cannot be started', async () => {
    renderSection();
    const row = await rowFor('Security log cleanup');
    expect(within(row).getByText('Not run yet')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it('starts a site-wide job and refreshes its status', async () => {
    api.startSiteMaintenanceJob.mockResolvedValue(job({ status: 'running' }));
    renderSection();
    const row = await rowFor('Recalculate charging costs');
    api.listSiteMaintenanceJobs.mockResolvedValue([
      catchUp,
      cleanup,
      job({ status: 'running', trigger: 'manual', started_at: '2026-11-12T15:00:00Z' }),
    ]);
    fireEvent.click(within(row).getByRole('button', { name: 'Run recalculate charging costs' }));
    await waitFor(() => expect(api.startSiteMaintenanceJob).toHaveBeenCalledWith('recompute_charging_costs'));
    await waitFor(() => expect(within(row).getByText('Running')).toBeInTheDocument());
    expect(within(row).getByText('Started at 2026-11-12T15:00:00Z')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Run recalculate charging costs' })).toBeDisabled();
  });

  it('explains why a job could not start', async () => {
    api.startSiteMaintenanceJob.mockRejectedValue(Object.assign(new Error('409 conflict'), {
      detail: { status: 409, code: 'conflict', message: 'this job is already running' },
    }));
    renderSection();
    const row = await rowFor('Recalculate charging costs');
    fireEvent.click(within(row).getByRole('button', { name: 'Run recalculate charging costs' }));
    expect(await within(row).findByRole('alert')).toHaveTextContent('This job is already running.');
  });

  it('shows a failed run with its error', async () => {
    api.listSiteMaintenanceJobs.mockResolvedValue([
      job({ status: 'error', error: 'Interrupted before finishing. Run it again.' }),
    ]);
    renderSection();
    const row = await rowFor('Recalculate charging costs');
    expect(within(row).getByText('Failed')).toBeInTheDocument();
    expect(within(row).getByRole('alert')).toHaveTextContent('Interrupted before finishing. Run it again.');
  });

  it('hides site-wide jobs from people who cannot manage the installation', async () => {
    renderSection({ canManageInstallation: false });
    expect(await screen.findByText('Recover missed charging sessions')).toBeInTheDocument();
    expect(screen.queryByText('Site-wide jobs')).not.toBeInTheDocument();
    expect(api.listSiteMaintenanceJobs).not.toHaveBeenCalled();
  });

  it('runs vehicle jobs for the vehicle picked in the dropdown', async () => {
    api.startMaintenanceJob.mockResolvedValue({ ...recovery, status: 'running' });
    renderSection({ vehicles: [vehicle('vehicle-1', 'Castor'), vehicle('vehicle-2', 'Pollux')] });
    await rowFor('Recover missed charging sessions');
    expect(api.listMaintenanceJobs).toHaveBeenLastCalledWith('vehicle-1');

    fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle' }), { target: { value: 'vehicle-2' } });
    await waitFor(() => expect(api.listMaintenanceJobs).toHaveBeenLastCalledWith('vehicle-2'));
    expect(api.getBackfillStatus).toHaveBeenLastCalledWith('vehicle-2');

    const row = await rowFor('Recover missed charging sessions');
    fireEvent.click(within(row).getByRole('button', { name: 'Run recover missed charging sessions' }));
    await waitFor(() => expect(api.startMaintenanceJob).toHaveBeenCalledWith('vehicle-2', 'recover_missed_charge_sessions'));
  });

  it('lets viewers see vehicle jobs but not run them', async () => {
    renderSection({ canManageInstallation: false, vehicles: [vehicle('vehicle-1', 'Castor', 'viewer')] });
    const row = await rowFor('Recover missed charging sessions');
    expect(within(row).getByRole('button', { name: 'Run recover missed charging sessions' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run charging history backfill' })).toBeDisabled();
  });

  it('says so when there are no vehicles', async () => {
    renderSection({ canManageInstallation: false, vehicles: [] });
    expect(await screen.findByText('No vehicles connected yet.')).toBeInTheDocument();
  });
});
