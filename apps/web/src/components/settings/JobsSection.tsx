import React from 'react';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw } from 'lucide-react';
import { api } from '@riviamigo/hooks';
import type { Vehicle } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@riviamigo/ui/primitives';

interface JobsSectionProps {
  vehicles: Vehicle[];
}

export function JobsSection({ vehicles }: JobsSectionProps) {
  const queryClient = useQueryClient();
  const backfillQueries = useQueries({
    queries: vehicles.map((vehicle) => ({
      queryKey: ['jobs', 'backfill-status', vehicle.id],
      queryFn: () => api.getBackfillStatus(vehicle.id),
      staleTime: 10_000,
      refetchInterval: 15_000,
    })),
  });
  const triggerBackfill = useMutation({
    mutationFn: (vehicleId: string) => api.triggerBackfill(vehicleId),
    onSuccess: (_result, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['jobs', 'backfill-status', vehicleId] });
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
                  const status = backfill.data?.status ?? vehicle.history_backfill_status ?? 'unknown';
                  const running = status === 'running' || status === 'pending';
                  return (
                    <React.Fragment key={vehicle.id}>
                      <tr>
                        <td className="py-3 pr-4 align-top">
                          <div className="font-medium text-fg">{vehicle.display_name}</div>
                          <div className="text-xs text-fg-tertiary">{vehicle.model}</div>
                        </td>
                        <td className="py-3 pr-4 align-top text-fg">Charging history backfill</td>
                        <td className="py-3 pr-4 align-top">
                          <StatusBadge status={status} loading={backfill.isLoading} />
                        </td>
                        <td className="py-3 pr-4 align-top text-fg-secondary">
                          {formatDateTime(backfill.data?.history_backfilled_at ?? vehicle.history_backfilled_at)}
                        </td>
                        <td className="py-3 pr-4 align-top text-fg-secondary">
                          {formatBackfillEvidence(backfill.data?.rivian_session_count ?? vehicle.history_session_count, backfill.data?.local_session_count)}
                        </td>
                        <td className="py-3 text-right align-top">
                          <Button
                            variant="secondary"
                            size="sm"
                            iconLeft={<Play className="h-3.5 w-3.5" />}
                            loading={triggerBackfill.isPending && triggerBackfill.variables === vehicle.id}
                            disabled={running}
                            onClick={() => triggerBackfill.mutate(vehicle.id)}
                          >
                            Run
                          </Button>
                        </td>
                      </tr>
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatBackfillEvidence(rivianCount: number | null | undefined, localCount: number | null | undefined) {
  const rivian = typeof rivianCount === 'number' ? rivianCount.toLocaleString() : '-';
  const local = typeof localCount === 'number' ? localCount.toLocaleString() : '-';
  return `${rivian} Rivian / ${local} local`;
}
