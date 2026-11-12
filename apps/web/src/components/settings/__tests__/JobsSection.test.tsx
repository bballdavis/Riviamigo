import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaintenanceJobStatus } from '@riviamigo/hooks';
import type { Vehicle } from '@riviamigo/types';

vi.mock('@riviamigo/ui/primitives', async () => import('../../../test/mockPrimitives'));
vi.mock('@riviamigo/ui/lib/dateTime', () => ({ formatAppDateTime: (value: string) => `at ${value}` }));
vi.mock('lucide-react', () => ({ Play: () => <svg />, RefreshCw: () => <svg /> }));

const api = vi.hoisted(() => ({
  getBackfillStatus: vi.fn(),
  triggerBackfill: vi.fn(),
  listMaintenanceJobs: vi.fn(),
  startMaintenanceJob: vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({ api }));

import { JobsSection } from '../JobsSection';

function job(overrides: Partial<MaintenanceJobStatus> = {}): MaintenanceJobStatus {
  return {
    kind: 'recompute_charging_costs',
    title: 'Recalculate charging costs',
    description: 'Prices every charging session again with its current cost profile.',
    subject: 'sessions',
    changed_label: 'changed',
    status: null,
    started_at: null,
    finished_at: null,
    processed_count: null,
    changed_count: null,
    failed_count: null,
    error: null,
    ...overrides,
  };
}

function vehicle(role: Vehicle['membership_role'] = 'owner'): Vehicle {
  return {
    id: 'vehicle-1',
    display_name: 'Castor',
    model: 'R1S',
    membership_role: role,
    history_backfill_status: 'done',
    history_backfilled_at: null,
    history_session_count: 12,
  } as Vehicle;
}

function renderSection(role: Vehicle['membership_role'] = 'owner') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JobsSection vehicles={[vehicle(role)]} />
    </QueryClientProvider>,
  );
}

async function costRow() {
  const title = await screen.findByText('Recalculate charging costs');
  return title.closest('tr') as HTMLTableRowElement;
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
    api.listMaintenanceJobs.mockReset().mockResolvedValue([job()]);
    api.startMaintenanceJob.mockReset();
  });

  it('lists maintenance jobs under the vehicle with their description', async () => {
    renderSection();
    const row = await costRow();
    expect(within(row).getByText(/Prices every charging session again/)).toBeInTheDocument();
    expect(within(row).getByText('Never run')).toBeInTheDocument();
    expect(screen.getByText('Charging history backfill')).toBeInTheDocument();
  });

  it('shows what the last run touched', async () => {
    api.listMaintenanceJobs.mockResolvedValue([
      job({ status: 'done', started_at: '2026-11-12T15:00:00Z', finished_at: '2026-11-12T15:00:04Z', processed_count: 1240, changed_count: 1 }),
    ]);
    renderSection();
    const row = await costRow();
    expect(within(row).getByText('Done')).toBeInTheDocument();
    expect(within(row).getByText('at 2026-11-12T15:00:04Z')).toBeInTheDocument();
    expect(within(row).getByText(`${(1240).toLocaleString()} sessions · 1 changed`)).toBeInTheDocument();
  });

  it('names what each job counted, including failures', async () => {
    api.listMaintenanceJobs.mockResolvedValue([
      job(),
      job({
        kind: 'fill_addresses',
        title: 'Fill missing addresses',
        subject: 'places',
        changed_label: 'filled',
        status: 'done',
        finished_at: '2026-11-12T15:00:04Z',
        processed_count: 40,
        changed_count: 37,
        failed_count: 3,
      }),
    ]);
    renderSection();
    const row = (await screen.findByText('Fill missing addresses')).closest('tr') as HTMLTableRowElement;
    expect(within(row).getByText('40 places · 37 filled · 3 failed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Run / })).toHaveLength(3);
  });

  it('starts the job for the vehicle and refreshes its status', async () => {
    api.startMaintenanceJob.mockResolvedValue(job({ status: 'running' }));
    renderSection();
    const row = await costRow();
    api.listMaintenanceJobs.mockResolvedValue([job({ status: 'running', started_at: '2026-11-12T15:00:00Z' })]);
    fireEvent.click(within(row).getByRole('button', { name: 'Run recalculate charging costs' }));
    await waitFor(() => expect(api.startMaintenanceJob).toHaveBeenCalledWith('vehicle-1', 'recompute_charging_costs'));
    await waitFor(() => expect(within(row).getByText('Running')).toBeInTheDocument());
    expect(within(row).getByRole('button', { name: 'Run recalculate charging costs' })).toBeDisabled();
  });

  it('explains why a job could not start', async () => {
    api.startMaintenanceJob.mockRejectedValue(Object.assign(new Error('409 conflict'), {
      detail: { status: 409, code: 'conflict', message: 'this job is already running' },
    }));
    renderSection();
    const row = await costRow();
    fireEvent.click(within(row).getByRole('button', { name: 'Run recalculate charging costs' }));
    expect(await within(row).findByRole('alert')).toHaveTextContent('This job is already running.');
  });

  it('shows a failed run with its error', async () => {
    api.listMaintenanceJobs.mockResolvedValue([job({ status: 'error', error: 'Interrupted before finishing. Run it again.' })]);
    renderSection();
    const row = await costRow();
    expect(within(row).getByText('Error')).toBeInTheDocument();
    expect(within(row).getByText('Interrupted before finishing. Run it again.')).toBeInTheDocument();
  });

  it('lets viewers see jobs but not run them', async () => {
    renderSection('viewer');
    const row = await costRow();
    expect(within(row).getByRole('button', { name: 'Run recalculate charging costs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run charging history backfill' })).toBeDisabled();
  });
});
