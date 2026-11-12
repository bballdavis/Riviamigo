import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { api, type MaintenanceJobStatus } from '@riviamigo/hooks';
import type { Vehicle } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import { formatAppDateTime } from '@riviamigo/ui/lib/dateTime';

interface JobsSectionProps {
  vehicles: Vehicle[];
  /** Admins and super users see and run site-wide jobs. */
  canManageInstallation: boolean;
}

const IDLE_POLL_MS = 15_000;
const RUNNING_POLL_MS = 3_000;

type JobState = 'running' | 'queued' | 'done' | 'error' | 'paused' | null;

export function JobsSection({ vehicles, canManageInstallation }: JobsSectionProps) {
  return (
    <div className="grid gap-6">
      {canManageInstallation ? <SiteJobsCard /> : null}
      <VehicleJobsCard vehicles={vehicles} />
    </div>
  );
}

function SiteJobsCard() {
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ['jobs', 'site'],
    queryFn: () => api.listSiteMaintenanceJobs(),
    staleTime: 2_000,
    refetchInterval: (query) => pollInterval(query.state.data?.some((job) => job.status === 'running')),
  });
  const start = useMutation({
    mutationFn: (kind: string) => api.startSiteMaintenanceJob(kind),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['jobs', 'site'] }),
  });
  const automatic = (jobs.data ?? []).filter((job) => job.automatic);
  const manual = (jobs.data ?? []).filter((job) => !job.automatic);

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>Site-wide jobs</CardTitle>
        <p className="text-sm text-fg-tertiary">Background work and repairs that cover every vehicle.</p>
      </CardHeader>
      <CardContent>
        {jobs.isError ? (
          <p className="text-sm text-status-danger">Could not load site-wide jobs.</p>
        ) : jobs.isLoading ? (
          <p className="text-sm text-fg-tertiary">Loading jobs…</p>
        ) : (
          <div className="grid gap-6">
            <JobGroup heading="Automatic">
              {automatic.map((job) => (
                <MaintenanceJobRow key={job.kind} job={job} canStart start={start} startKey={job.kind} />
              ))}
            </JobGroup>
            <JobGroup heading="Manual">
              {manual.map((job) => (
                <MaintenanceJobRow key={job.kind} job={job} canStart start={start} startKey={job.kind} />
              ))}
            </JobGroup>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VehicleJobsCard({ vehicles }: { vehicles: Vehicle[] }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = React.useState<string | null>(vehicles[0]?.id ?? null);
  const vehicle = vehicles.find((candidate) => candidate.id === selectedId) ?? vehicles[0] ?? null;
  const vehicleId = vehicle?.id ?? '';

  const backfill = useQuery({
    queryKey: ['jobs', 'backfill-status', vehicleId],
    queryFn: () => api.getBackfillStatus(vehicleId),
    enabled: vehicle != null,
    staleTime: 2_000,
    refetchInterval: (query) => pollInterval(isBackfillActive(query.state.data?.status)),
  });
  const jobs = useQuery({
    queryKey: ['jobs', 'maintenance', vehicleId],
    queryFn: () => api.listMaintenanceJobs(vehicleId),
    enabled: vehicle != null,
    staleTime: 2_000,
    refetchInterval: (query) => pollInterval(query.state.data?.some((job) => job.status === 'running')),
  });
  const triggerBackfill = useMutation({
    mutationFn: (id: string) => api.triggerBackfill(id),
    onSettled: (_result, _error, id) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['jobs', 'backfill-status', id] });
    },
  });
  const start = useMutation({
    mutationFn: (kind: string) => api.startMaintenanceJob(vehicleId, kind),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['jobs', 'maintenance', vehicleId] }),
  });

  const canManage = vehicle != null && canManageVehicle(vehicle);
  const backfillStatus = backfill.data?.status ?? vehicle?.history_backfill_status ?? null;
  const backfillState = backfillJobState(backfillStatus);
  const backfillFinishedAt = backfill.data?.history_backfilled_at ?? vehicle?.history_backfilled_at ?? null;
  const backfillError = triggerBackfill.isError && triggerBackfill.variables === vehicleId
    ? startErrorMessage(triggerBackfill.error)
    : null;

  return (
    <Card>
      <CardHeader className="flex-wrap gap-3">
        <div className="min-w-0">
          <CardTitle>Vehicle jobs</CardTitle>
          <p className="mt-1 text-sm text-fg-tertiary">Repairs for one vehicle's history.</p>
        </div>
        {vehicles.length > 0 ? (
          <SelectPicker
            aria-label="Vehicle"
            size="sm"
            align="right"
            className="w-full sm:w-56"
            value={vehicleId}
            options={vehicles.map((option) => ({
              value: option.id,
              label: option.display_name,
              description: option.model,
            }))}
            onChange={setSelectedId}
          />
        ) : null}
      </CardHeader>
      <CardContent>
        {vehicle == null ? (
          <p className="text-sm text-fg-tertiary">No vehicles connected yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            <JobRow
              title="Charging history backfill"
              description="Downloads this vehicle's full charging history from Rivian and merges it with recorded sessions."
              state={backfill.isLoading ? null : backfillState}
              meta={[
                backfillFinishedAt ? `Last run ${formatAppDateTime(backfillFinishedAt)}` : null,
                formatBackfillEvidence(
                  backfill.data?.rivian_session_count ?? vehicle.history_session_count,
                  backfill.data?.local_session_count,
                ),
              ]}
              error={backfillError}
              action={(
                <RunButton
                  label="Run charging history backfill"
                  loading={triggerBackfill.isPending && triggerBackfill.variables === vehicleId}
                  disabled={backfillState === 'running' || backfillState === 'queued' || !canManage}
                  onClick={() => triggerBackfill.mutate(vehicleId)}
                />
              )}
            />
            {(jobs.data ?? []).map((job) => (
              <MaintenanceJobRow
                key={job.kind}
                job={job}
                canStart={canManage}
                start={start}
                startKey={job.kind}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function JobGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">{heading}</h4>
      <ul className="mt-1 divide-y divide-border">{children}</ul>
    </section>
  );
}

interface StartMutation {
  mutate: (kind: string) => void;
  isPending: boolean;
  isError: boolean;
  variables: string | undefined;
  error: unknown;
}

function MaintenanceJobRow({
  job,
  canStart,
  start,
  startKey,
}: {
  job: MaintenanceJobStatus;
  canStart: boolean;
  start: StartMutation;
  startKey: string;
}) {
  const startError = start.isError && start.variables === startKey ? startErrorMessage(start.error) : null;
  return (
    <JobRow
      title={job.title}
      description={job.description}
      state={job.status}
      meta={[job.schedule, lastRunText(job), job.status === 'running' ? null : job.summary]}
      error={startError ?? (job.status === 'error' ? job.error ?? 'The last run failed.' : null)}
      action={job.can_run ? (
        <RunButton
          label={`Run ${job.title.toLowerCase()}`}
          text={job.automatic ? 'Run now' : 'Run'}
          loading={start.isPending && start.variables === startKey}
          disabled={job.status === 'running' || !canStart}
          onClick={() => start.mutate(job.kind)}
        />
      ) : null}
    />
  );
}

/** One job: what it does on the left; its state and Run button on the right (below on small screens). */
function JobRow({
  title,
  description,
  state,
  meta,
  error,
  action,
}: {
  title: string;
  description: string;
  state: JobState;
  meta: Array<string | null | undefined>;
  error: string | null;
  action: React.ReactNode;
}) {
  const metaText = meta.filter(Boolean).join(' · ');
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{title}</div>
        <p className="mt-0.5 max-w-prose text-xs text-fg-tertiary">{description}</p>
        {metaText ? <p className="mt-1.5 text-xs text-fg-secondary">{metaText}</p> : null}
        {error ? (
          <p role="alert" className="mt-1 text-xs text-status-danger">{error}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <JobStatusBadge state={state} />
        {action}
      </div>
    </li>
  );
}

function RunButton({
  label,
  text = 'Run',
  loading,
  disabled,
  onClick,
}: {
  label: string;
  text?: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      iconLeft={<Play className="h-3.5 w-3.5" />}
      loading={loading}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      {text}
    </Button>
  );
}

const STATE_BADGES: Record<Exclude<JobState, null>, { label: string; variant: 'success' | 'info' | 'danger' | 'warning' }> = {
  running: { label: 'Running', variant: 'info' },
  queued: { label: 'Queued', variant: 'info' },
  done: { label: 'Done', variant: 'success' },
  error: { label: 'Failed', variant: 'danger' },
  paused: { label: 'Paused', variant: 'warning' },
};

function JobStatusBadge({ state }: { state: JobState }) {
  if (state == null) return <Badge variant="default">Not run yet</Badge>;
  const { label, variant } = STATE_BADGES[state];
  return <Badge variant={variant} dot>{label}</Badge>;
}

function lastRunText(job: MaintenanceJobStatus) {
  if (job.status === 'running') {
    return job.started_at ? `Started ${formatAppDateTime(job.started_at)}` : 'Starting…';
  }
  const at = job.finished_at ?? job.started_at;
  if (!at) return null;
  const startedByHand = job.automatic && job.trigger === 'manual' ? ' (manual run)' : '';
  return `Last run ${formatAppDateTime(at)}${startedByHand}`;
}

function pollInterval(active: boolean | undefined) {
  return active ? RUNNING_POLL_MS : IDLE_POLL_MS;
}

function isBackfillActive(status: string | null | undefined) {
  const state = backfillJobState(status);
  return state === 'running' || state === 'queued';
}

function backfillJobState(status: string | null | undefined): JobState {
  switch ((status ?? '').toLowerCase()) {
    case 'running':
      return 'running';
    case 'pending':
      return 'queued';
    case 'done':
    case 'observed':
      return 'done';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return null;
  }
}

function startErrorMessage(error: unknown) {
  const detail = (error as { detail?: { message?: string } } | null)?.detail?.message;
  if (detail) return detail.charAt(0).toUpperCase() + detail.slice(1) + '.';
  return 'Could not start this job.';
}

function canManageVehicle(vehicle: Vehicle) {
  return vehicle.membership_role == null || vehicle.membership_role === 'owner' || vehicle.membership_role === 'manager';
}

function formatBackfillEvidence(rivianCount: number | null | undefined, localCount: number | null | undefined) {
  if (typeof rivianCount !== 'number' && typeof localCount !== 'number') return null;
  const rivian = typeof rivianCount === 'number' ? rivianCount.toLocaleString() : '-';
  const local = typeof localCount === 'number' ? localCount.toLocaleString() : '-';
  return `${rivian} from Rivian / ${local} recorded`;
}
