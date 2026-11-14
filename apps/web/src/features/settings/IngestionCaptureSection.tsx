import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@riviamigo/hooks';
import type { Vehicle } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@riviamigo/ui/primitives';
import { SettingsConfirmationDialog, type SettingsConfirmation } from './SettingsConfirmationDialog';

export function IngestionDiagnosticsSection({ vehicles }: { vehicles: Vehicle[] }) {
  const manageableVehicles = vehicles.filter((vehicle) => (
    (vehicle.membership_role === 'owner' || vehicle.membership_role === 'manager')
    && !(vehicle.is_demo ?? vehicle.rivian_vehicle_id?.startsWith('demo-') ?? false)
  ));
  if (manageableVehicles.length === 0) return null;

  return (
    <Card>
      <CardHeader><CardTitle>Ingestion capture</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-fg-secondary">
          Record what Riviamigo receives from Rivian while you reproduce a problem, then download one file to share.
          A capture keeps Parallax and legacy frames, decoded values, and ingestion decisions for up to an hour.
          It never includes coordinates, credentials, the VIN, or vehicle names, and it is deleted 24 hours after it stops.
        </p>
        {manageableVehicles.map((vehicle) => (
          <VehicleIngestionCaptureRow key={vehicle.id} vehicle={vehicle} />
        ))}
      </CardContent>
    </Card>
  );
}

function formatCaptureTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
}

function minutesLeft(endsAt: string | null | undefined, now: number): number {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 60_000));
}

function VehicleIngestionCaptureRow({ vehicle }: { vehicle: Vehicle }) {
  const queryClient = useQueryClient();
  const queryKey = ['vehicle-ingestion-capture', vehicle.id];
  const query = useQuery({
    queryKey,
    queryFn: () => api.getVehicleIngestionCapture(vehicle.id),
    refetchInterval: (current) => (current.state.data?.state === 'capturing' ? 5_000 : false),
  });
  const onChanged = (data: Awaited<ReturnType<typeof api.getVehicleIngestionCapture>>) => {
    queryClient.setQueryData(queryKey, data);
  };
  const start = useMutation({
    mutationFn: () => api.startVehicleIngestionCapture(vehicle.id),
    onSuccess: onChanged,
  });
  const stop = useMutation({
    mutationFn: () => api.stopVehicleIngestionCapture(vehicle.id),
    onSuccess: onChanged,
  });
  const download = useMutation({
    mutationFn: async () => {
      const { blob, fileName } = await api.downloadVehicleIngestionCapture(vehicle.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });

  const capture = query.data;
  const state = capture?.state ?? 'idle';
  const busy = query.isPending || query.isError || start.isPending || stop.isPending;
  const events = `${(capture?.event_count ?? 0).toLocaleString()} event${capture?.event_count === 1 ? '' : 's'}`;
  const [confirmation, setConfirmation] = React.useState<SettingsConfirmation | null>(null);
  const startCapture = () => {
    if (state !== 'stopped') {
      start.mutate();
      return;
    }
    setConfirmation({
      title: 'Start a new capture?',
      description: 'This replaces the previous capture and its file.',
      confirmLabel: 'New capture',
      run: () => start.mutateAsync(),
    });
  };

  let status: string;
  if (query.isPending) status = 'Checking capture status…';
  else if (query.isError) status = 'Could not check capture status.';
  else if (state === 'capturing') status = `${events} · ${minutesLeft(capture?.ends_at, Date.now())} min left`;
  else if (state === 'stopped') {
    status = `Last capture ${formatCaptureTime(capture?.started_at)}–${formatCaptureTime(capture?.stopped_at)} · ${events}`
      + (capture?.stop_reason === 'expired' ? ' · stopped after 1 hour' : '')
      + (capture?.truncated ? ' · event limit reached' : '');
  } else status = 'No capture yet. Records for up to 1 hour.';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/35 px-3 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-fg">{vehicle.display_name}</p>
          {state === 'capturing' && <Badge variant="accent">Capturing</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-fg-tertiary">{status}</p>
        {query.isError && (
          <button type="button" className="mt-1 text-xs text-accent underline" onClick={() => void query.refetch()}>
            Retry status check
          </button>
        )}
        {(start.isError || stop.isError) && <p className="mt-1 text-xs text-status-danger">Could not change the capture. Try again.</p>}
        {download.isError && <p className="mt-1 text-xs text-status-danger">Could not download the capture. Try again.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {state === 'stopped' && (
          <Button
            size="sm"
            variant="secondary"
            disabled={download.isPending || (capture?.event_count ?? 0) === 0}
            onClick={() => download.mutate()}
            aria-label={`Download capture for ${vehicle.display_name}`}
          >
            {download.isPending ? 'Preparing…' : 'Download'}
          </Button>
        )}
        {state === 'capturing' ? (
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => stop.mutate()}
            aria-label={`Stop capture for ${vehicle.display_name}`}
          >
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant={state === 'stopped' ? 'ghost' : 'primary'}
            disabled={busy}
            onClick={startCapture}
            aria-label={`Start capture for ${vehicle.display_name}`}
          >
            {state === 'stopped' ? 'New capture' : 'Start capture'}
          </Button>
        )}
      </div>
      {confirmation ? (
        <SettingsConfirmationDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
      ) : null}
    </div>
  );
}
