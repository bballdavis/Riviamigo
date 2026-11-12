import React from 'react';
import { useMutation, useQueries, useQueryClient, type Query } from '@tanstack/react-query';
import { Play, RefreshCw } from 'lucide-react';
import { api, type MaintenanceJobStatus } from '@riviamigo/hooks';
import type { Vehicle } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@riviamigo/ui/primitives';
import { formatAppDateTime } from '@riviamigo/ui/lib/dateTime';

interface JobsSectionProps {
  vehicles: Vehicle[];
}

const IDLE_POLL_MS = 15_000;
const RUNNING_POLL_MS = 3_000;

export function JobsSection({ vehicles }: JobsSectionProps) {
  const queryClient = useQueryClient();
  const backfillQueries = useQueries({
    queries: vehicles.map((vehicle) => ({
      queryKey: ['jobs', 'backfill-status', vehicle.id],
      queryFn: () => api.getBackfillStatus(vehicle.id),
      staleTime: 10_000,
      refetchInterval: IDLE_POLL_MS,
    })),
  });
  const maintenanceQueries = useQueries({
    queries: vehicles.map((vehicle) => ({
      queryKey: ['jobs', 'maintenance', vehicle.id],
      queryFn: () => api.listMaintenanceJobs(vehicle.id),
      staleTime: 2_000,
      refetchInterval: (query: Query<MaintenanceJobStatus[], Error, MaintenanceJobStatus[], readonly unknown[]>) =>
        query.state.data?.some((job) => job.status === 'running') ? RUNNING_POLL_MS : IDLE_POLL_MS,
    })),
  });
  const triggerBackfill = useMutation({
    mutationFn: (vehicleId: string) => api.triggerBackfill(vehicleId),
    onSuccess: (_result, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['jobs', 'backfill-status', vehicleId] });
    },
  });
  const startMaintenanceJob = useMutation({
    mutationFn: ({ vehicleId, kind }: { vehicleId: string; kind: string }) => api.startMaintenanceJob(vehicleId, kind),
    onSettled: (_result, _error, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: ['jobs', 'maintenance', vehicleId] });
    },
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    queryClient.invalidateQueries({ queryKey: ['vehicles'] });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jobs</CardTitle>
        <Button variant="secondary" size="sm" iconLeft={<RefreshCw className="h-3.5 w-3.5" />} onClick={refresh}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {vehicles.length === 0 ? (
          <p className="text-sm text-fg-tertiary">No vehicles connected yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-fg-tertiary">
                <tr>
                  <th className="py-2 pr-4 text-left font-medium">Vehicle</th>
                  <th className="py-2 pr-4 text-left font-medium">Job</th>
                  <th className="py-2 pr-4 text-left font-medium">Status</th>
                  <th className="py-2 pr-4 text-left font-medium">Last Run</th>
                  <th className="py-2 pr-4 text-left font-medium">Evidence</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vehicles.map((vehicle, index) => {
                  const backfill = backfillQueries[index]!;
                  const maintenance = maintenanceQueries[index]!;
                  const maintenanceJobs = maintenance.data ?? [];
                  const canManage = canManageVehicle(vehicle);
                  const backfillStatus = backfill.data?.status ?? vehicle.history_backfill_status ?? 'unknown';
                  const backfillRunning = backfillStatus === 'running' || backfillStatus === 'pending';
                  const rowCount = 1 + maintenanceJobs.length;
                  return (
                    <React.Fragment key={vehicle.id}>
                      <tr>
                        <td className="py-3 pr-4 align-top" rowSpan={rowCount}>
                          <div className="font-medium text-fg">{vehicle.display_name}</div>
                          <div className="text-xs text-fg-tertiary">{vehicle.model}</div>
                        </td>
                        <td className="py-3 pr-4 align-top">
                          <JobName
                            title="Charging history backfill"
                            description="Downloads this vehicle's full charging history from Rivian and merges it with recorded sessions."
                          />
                        </td>
                        <td className="py-3 pr-4 align-top">
                          <StatusBadge status={backfillStatus} loading={backfill.isLoading} />
                        </td>
                        <td className="py-3 pr-4 align-top text-fg-secondary">
                          {formatDateTime(backfill.data?.history_backfilled_at ?? vehicle.history_backfilled_at)}
                        </td>
                        <td className="py-3 pr-4 align-top text-fg-secondary">
                          {formatBackfillEvidence(backfill.data?.rivian_session_count ?? vehicle.history_session_count, backfill.data?.local_session_count)}
                        </td>
                        <td className="py-3 text-right align-top">
                          <RunButton
                            label="Run charging history backfill"
                            loading={triggerBackfill.isPending && triggerBackfill.variables === vehicle.id}
                            disabled={backfillRunning || !canManage}
                            onClick={() => triggerBackfill.mutate(vehicle.id)}
                          />
                        </td>
                      </tr>
                      {maintenanceJobs.map((job) => {
                        const starting = startMaintenanceJob.isPending
                          && startMaintenanceJob.variables?.vehicleId === vehicle.id
                          && startMaintenanceJob.variables.kind === job.kind;
                        const startError = startMaintenanceJob.isError
                          && startMaintenanceJob.variables?.vehicleId === vehicle.id
                          && startMaintenanceJob.variables.kind === job.kind
                          ? startMaintenanceJob.error
                          : null;
                        return (
                          <tr key={job.kind}>
                            <td className="py-3 pr-4 align-top">
                              <JobName title={job.title} description={job.description} />
                            </td>
                            <td className="py-3 pr-4 align-top">
                              <StatusBadge status={job.status ?? 'never run'} loading={false} />
                            </td>
                            <td className="py-3 pr-4 align-top text-fg-secondary">
                              {formatDateTime(job.finished_at ?? job.started_at)}
                            </td>
                            <td className="py-3 pr-4 align-top text-fg-secondary">
                              <MaintenanceEvidence job={job} />
                            </td>
                            <td className="py-3 text-right align-top">
                              <RunButton
                                label={`Run ${job.title.toLowerCase()}`}
                                loading={starting}
                                disabled={job.status === 'running' || !canManage}
                                onClick={() => startMaintenanceJob.mutate({ vehicleId: vehicle.id, kind: job.kind })}
                              />
                              {startError ? (
                                <p role="alert" className="mt-1 text-xs text-status-danger">
                                  {startErrorMessage(startError)}
                                </p>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function startErrorMessage(error: unknown) {
  const detail = (error as { detail?: { message?: string } } | null)?.detail?.message;
  if (detail) return detail.charAt(0).toUpperCase() + detail.slice(1) + '.';
  return 'Could not start this job.';
}

function canManageVehicle(vehicle: Vehicle) {
  return vehicle.membership_role == null || vehicle.membership_role === 'owner' || vehicle.membership_role === 'manager';
}

function JobName({ title, description }: { title: string; description: string }) {
  return (
    <div className="min-w-[14rem] max-w-sm">
      <div className="text-fg">{title}</div>
      <p className="mt-0.5 text-xs text-fg-tertiary">{description}</p>
    </div>
  );
}

function RunButton({ label, loading, disabled, onClick }: { label: string; loading: boolean; disabled: boolean; onClick: () => void }) {
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
      Run
    </Button>
  );
}

function MaintenanceEvidence({ job }: { job: MaintenanceJobStatus }) {
  if (job.status === 'error') {
    return <span className="text-status-danger">{job.error ?? 'Failed'}</span>;
  }
  if (job.status === 'running') return <>Running…</>;
  if (job.status === 'done' && job.processed_count != null) {
    return <>{formatJobCounts(job)}</>;
  }
  return <>-</>;
}

function formatJobCounts(job: MaintenanceJobStatus) {
  const parts = [`${(job.processed_count ?? 0).toLocaleString()} ${job.subject}`];
  if (job.changed_count != null) parts.push(`${job.changed_count.toLocaleString()} ${job.changed_label}`);
  if (job.failed_count) parts.push(`${job.failed_count.toLocaleString()} failed`);
  return parts.join(' · ');
}

function StatusBadge({ status, loading }: { status: string | null; loading: boolean }) {
  const normalized = loading ? 'loading' : (status ?? 'unknown').toLowerCase();
  const variant = normalized === 'done' || normalized === 'observed'
    ? 'success'
    : normalized === 'running' || normalized === 'pending' || normalized === 'loading'
      ? 'info'
      : normalized === 'error'
        ? 'danger'
        : 'default';
  const label = normalized === 'loading' ? 'Loading' : normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return <Badge variant={variant} dot>{label}</Badge>;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return formatAppDateTime(value);
}

function formatBackfillEvidence(rivianCount: number | null | undefined, localCount: number | null | undefined) {
  const rivian = typeof rivianCount === 'number' ? rivianCount.toLocaleString() : '-';
  const local = typeof localCount === 'number' ? localCount.toLocaleString() : '-';
  return `${rivian} Rivian / ${local} local`;
}
