import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@riviamigo/hooks';
import type { BackupArtifact, BackupFrequency, BackupOverview, BackupTargetType, UpdateBackupSettingsBody } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@riviamigo/ui/primitives';
import { CloudUpload, Clock3, DatabaseBackup, History, Play, RotateCcw } from 'lucide-react';

const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

interface BackupDraft {
  enabled: boolean;
  frequency: BackupFrequency;
  run_at: string;
  timezone: string;
  day_of_week: number | null;
  day_of_month: number | null;
  retention_count: string;
  target_type: BackupTargetType;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  access_key: string;
}

function emitToast(title: string, message: string) {
  window.dispatchEvent(new CustomEvent('riviamigo:toast', {
    detail: { title, message, variant: 'error' },
  }));
}

function buildDraft(overview: BackupOverview): BackupDraft {
  const settings = overview.settings;
  return {
    enabled: settings.enabled,
    frequency: settings.frequency,
    run_at: settings.run_at,
    timezone: settings.timezone,
    day_of_week: settings.day_of_week,
    day_of_month: settings.day_of_month,
    retention_count: String(settings.retention_count),
    target_type: settings.target_type,
    endpoint: settings.endpoint,
    region: settings.region ?? '',
    bucket: settings.bucket,
    prefix: settings.prefix,
    access_key: settings.access_key ?? '',
  };
}

function buildPayload(draft: BackupDraft, secretKey: string, clearSecretKey: boolean): UpdateBackupSettingsBody | null {
  const retention = Number.parseInt(draft.retention_count, 10);
  if (!Number.isFinite(retention) || retention < 1) {
    return null;
  }

  return {
    enabled: draft.enabled,
    frequency: draft.frequency,
    run_at: draft.run_at,
    timezone: draft.timezone.trim(),
    day_of_week: draft.frequency === 'weekly' ? draft.day_of_week : null,
    day_of_month: draft.frequency === 'monthly' ? draft.day_of_month : null,
    retention_count: retention,
    target_type: draft.target_type,
    endpoint: draft.endpoint.trim(),
    region: draft.region.trim() || null,
    bucket: draft.bucket.trim(),
    prefix: draft.prefix.trim(),
    access_key: draft.access_key.trim() || null,
    ...(secretKey.trim() ? { secret_key: secretKey.trim() } : {}),
    ...(clearSecretKey ? { clear_secret_key: true } : {}),
  };
}

function describeSchedule(overview: BackupOverview) {
  const settings = overview.settings;
  const parts = [`${settings.frequency} at ${settings.run_at}`];
  if (settings.frequency === 'weekly') {
    const weekday = WEEKDAYS.find((entry) => entry.value === settings.day_of_week);
    if (weekday) parts.push(weekday.label);
  }
  if (settings.frequency === 'monthly' && settings.day_of_month) {
    parts.push(`day ${settings.day_of_month}`);
  }
  parts.push(settings.timezone);
  return parts.join(' / ');
}

export function BackupSection() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ['backup-overview'],
    queryFn: () => api.getBackupOverview(),
  });
  const [draft, setDraft] = React.useState<BackupDraft | null>(null);
  const [secretKey, setSecretKey] = React.useState('');
  const [clearSecretKey, setClearSecretKey] = React.useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = React.useState('');
  const [restoreConfirmation, setRestoreConfirmation] = React.useState('');
  const [restoreNotes, setRestoreNotes] = React.useState('');

  React.useEffect(() => {
    if (!overview.data) return;
    setDraft(buildDraft(overview.data));
    setSecretKey('');
    setClearSecretKey(false);
    setSelectedArtifactId((current) => current || overview.data.artifacts[0]?.id || '');
  }, [overview.data]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('Backup settings are not ready yet.');
      const payload = buildPayload(draft, secretKey, clearSecretKey);
      if (!payload) {
        throw new Error('Retention must be a whole number greater than zero.');
      }
      return api.updateBackupSettings(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-overview'] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Backup settings could not be saved.';
      emitToast('Backup settings', message);
    },
  });

  const runBackupNow = useMutation({
    mutationFn: () => api.runBackupNow(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-overview'] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Backup run could not be started.';
      emitToast('Backup run', message);
    },
  });

  const requestRestore = useMutation({
    mutationFn: () => {
      if (!selectedArtifactId) {
        throw new Error('Select a backup artifact before requesting a restore.');
      }
      return api.requestBackupRestore({
        artifact_id: selectedArtifactId,
        confirmation_phrase: restoreConfirmation,
        notes: restoreNotes.trim() || null,
      });
    },
    onSuccess: () => {
      setRestoreConfirmation('');
      setRestoreNotes('');
      queryClient.invalidateQueries({ queryKey: ['backup-overview'] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Restore request could not be created.';
      emitToast('Restore request', message);
    },
  });

  function updateDraft<K extends keyof BackupDraft>(key: K, value: BackupDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  if (overview.isLoading || !draft || !overview.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Backups</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-tertiary">Loading backup controls...</p>
        </CardContent>
      </Card>
    );
  }

  const currentSettings = overview.data.settings;
  const canSave = draft.run_at.trim().length === 5 && draft.timezone.trim().length > 0 && Number.parseInt(draft.retention_count, 10) >= 1;
  const restoreArtifact = overview.data.artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;
  const canRequestRestore = Boolean(restoreArtifact) && restoreConfirmation.trim() === 'RESTORE';

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Backups</CardTitle>
            <Badge variant={currentSettings.enabled ? 'success' : 'default'}>
              {currentSettings.enabled ? 'Automatic' : 'Disabled'}
            </Badge>
            <Badge variant="default">Runner active</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Play className="h-3.5 w-3.5" />}
              loading={runBackupNow.isPending}
              onClick={() => runBackupNow.mutate()}
            >
              Run now
            </Button>
            <Button
              size="sm"
              iconLeft={<CloudUpload className="h-3.5 w-3.5" />}
              loading={saveSettings.isPending}
              disabled={!canSave}
              onClick={() => saveSettings.mutate()}
            >
              Save backup settings
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-bg-elevated/40 p-3">
              <p className="text-xs uppercase tracking-wide text-fg-tertiary">Next run</p>
              <p className="mt-1 text-sm font-medium text-fg">
                {overview.data.next_run_at ? new Date(overview.data.next_run_at).toLocaleString() : 'Not scheduled'}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-bg-elevated/40 p-3">
              <p className="text-xs uppercase tracking-wide text-fg-tertiary">Schedule</p>
              <p className="mt-1 text-sm font-medium text-fg">{describeSchedule(overview.data)}</p>
            </div>
            <div className="rounded-lg border border-border bg-bg-elevated/40 p-3">
              <p className="text-xs uppercase tracking-wide text-fg-tertiary">Latest success</p>
              <p className="mt-1 text-sm font-medium text-fg">
                {overview.data.latest_successful_run?.completed_at
                  ? new Date(overview.data.latest_successful_run.completed_at).toLocaleString()
                  : 'No completed backups yet'}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-bg-elevated/40 p-3">
              <p className="text-xs uppercase tracking-wide text-fg-tertiary">Retention</p>
              <p className="mt-1 text-sm font-medium text-fg">Keep {currentSettings.retention_count} backup set{currentSettings.retention_count === 1 ? '' : 's'}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_10rem] md:items-end">
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Timezone</span>
              <input
                value={draft.timezone}
                onChange={(event) => updateDraft('timezone', event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                placeholder="America/Chicago"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Run time</span>
              <input
                type="time"
                step={60}
                value={draft.run_at}
                onChange={(event) => updateDraft('run_at', event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-border bg-bg-elevated/30 px-3 py-2">
              <span className="text-sm text-fg">Automatic backups</span>
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => updateDraft('enabled', event.target.checked)}
                className="h-4 w-4 rounded border-border bg-bg-elevated text-accent focus:ring-accent"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-[10rem_10rem_10rem_10rem] md:items-end">
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Frequency</span>
              <select
                value={draft.frequency}
                onChange={(event) => updateDraft('frequency', event.target.value as BackupFrequency)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
              >
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
              </select>
            </label>

            {draft.frequency === 'weekly' && (
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Weekday</span>
                <select
                  value={draft.day_of_week ?? 0}
                  onChange={(event) => updateDraft('day_of_week', Number.parseInt(event.target.value, 10))}
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                >
                  {WEEKDAYS.map((weekday) => (
                    <option key={weekday.value} value={weekday.value}>{weekday.label}</option>
                  ))}
                </select>
              </label>
            )}

            {draft.frequency === 'monthly' && (
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Day of month</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={draft.day_of_month ?? 1}
                  onChange={(event) => updateDraft('day_of_month', Number.parseInt(event.target.value, 10) || 1)}
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                />
              </label>
            )}

            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Retention count</span>
              <input
                type="number"
                min={1}
                value={draft.retention_count}
                onChange={(event) => updateDraft('retention_count', event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-fg-secondary" />
            <CardTitle>Backup target</CardTitle>
          </div>
          <Badge variant="default">S3-compatible</Badge>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Endpoint</span>
              <input
                value={draft.endpoint}
                onChange={(event) => updateDraft('endpoint', event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                placeholder="https://s3.example.com"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Region</span>
              <input
                value={draft.region}
                onChange={(event) => updateDraft('region', event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                placeholder="us-east-1"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Bucket</span>
              <input
                value={draft.bucket}
                onChange={(event) => updateDraft('bucket', event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                placeholder="riviamigo-backups"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Prefix</span>
              <input
                value={draft.prefix}
                onChange={(event) => updateDraft('prefix', event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                placeholder="prod/riviamigo"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Access key</span>
              <input
                value={draft.access_key}
                onChange={(event) => updateDraft('access_key', event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                placeholder="Optional if runtime credentials are injected"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Secret key</span>
              <input
                type="password"
                value={secretKey}
                onChange={(event) => {
                  setSecretKey(event.target.value);
                  setClearSecretKey(false);
                }}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                placeholder={currentSettings.has_secret_key ? 'Leave blank to keep the stored secret' : 'Enter secret key'}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-elevated/30 p-3 text-sm text-fg-tertiary">
            <Clock3 className="h-4 w-4 shrink-0" />
            <span>Secrets are stored encrypted in the application database. Backup runs create verified database artifacts in the configured artifact store and reuse the schedule you configure here.</span>
          </div>

          <label className="flex items-center gap-3 text-sm text-fg">
            <input
              type="checkbox"
              checked={clearSecretKey}
              onChange={(event) => setClearSecretKey(event.target.checked)}
              className="h-4 w-4 rounded border-border bg-bg-elevated text-accent focus:ring-accent"
              disabled={!currentSettings.has_secret_key}
            />
            <span>{currentSettings.has_secret_key ? 'Clear the stored secret key on next save' : 'No stored secret key yet'}</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-fg-secondary" />
            <CardTitle>Recent backup runs</CardTitle>
          </div>
          <Badge variant="default">Execution history</Badge>
        </CardHeader>
        <CardContent>
          {overview.data.recent_runs.length === 0 ? (
            <p className="text-sm text-fg-tertiary">
              No backup executions have been recorded yet. Use Run now to create the first cataloged database artifact.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {overview.data.recent_runs.map((run) => (
                <div key={run.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-fg">{run.trigger}</p>
                      <Badge variant={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'danger' : 'default'}>{run.status}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-fg-tertiary">{run.id}</p>
                    <p className="mt-1 text-xs text-fg-tertiary">
                      Requested {new Date(run.created_at).toLocaleString()}
                      {run.completed_at ? ` / Completed ${new Date(run.completed_at).toLocaleString()}` : ''}
                    </p>
                    {run.error_message && <p className="mt-1 text-xs text-[#FCA5A5]">{run.error_message}</p>}
                  </div>
                  {run.artifact_key && (
                    <p className="text-xs font-mono text-fg-tertiary">{run.artifact_key}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-fg-secondary" />
            <CardTitle>Artifacts</CardTitle>
          </div>
          <Badge variant="default">Local catalog</Badge>
        </CardHeader>
        <CardContent>
          {overview.data.artifacts.length === 0 ? (
            <p className="text-sm text-fg-tertiary">No backup artifact has been written yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {overview.data.artifacts.map((artifact) => (
                <div key={artifact.id} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-fg">{artifact.file_name}</p>
                      <Badge variant="success">{artifact.storage_type}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-fg-tertiary">{artifact.storage_path}</p>
                    <p className="mt-1 text-xs text-fg-tertiary">
                      {Math.max(artifact.size_bytes, 0).toLocaleString()} bytes / SHA-256 {artifact.checksum_sha256.slice(0, 16)}...
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
                    onClick={() => setSelectedArtifactId(artifact.id)}
                  >
                    Select for restore
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-fg-secondary" />
            <CardTitle>Restore requests</CardTitle>
          </div>
          <Badge variant="danger">Admin only</Badge>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem] md:items-end">
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Artifact</span>
              <select
                value={selectedArtifactId}
                onChange={(event) => setSelectedArtifactId(event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
              >
                <option value="">Select an artifact</option>
                {overview.data.artifacts.map((artifact) => (
                  <option key={artifact.id} value={artifact.id}>{artifact.file_name}</option>
                ))}
              </select>
            </label>
            <div className="rounded-lg border border-border bg-bg-elevated/30 px-3 py-2 text-xs text-fg-tertiary">
              Type <span className="font-mono text-fg">RESTORE</span> to request a restore.
            </div>
          </div>

          {restoreArtifact && (
            <div className="rounded-lg border border-border bg-bg-elevated/30 p-3 text-xs text-fg-tertiary">
              <p>Selected artifact: <span className="font-mono text-fg">{restoreArtifact.file_name}</span></p>
              <p className="mt-1">Path: <span className="font-mono text-fg">{restoreArtifact.storage_path}</span></p>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)] md:items-end">
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Confirmation</span>
              <input
                value={restoreConfirmation}
                onChange={(event) => setRestoreConfirmation(event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                placeholder="RESTORE"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Notes</span>
              <input
                value={restoreNotes}
                onChange={(event) => setRestoreNotes(event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                placeholder="Optional maintenance or incident context"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-[#F87171]/25 bg-[#7F1D1D]/20 px-3 py-3 text-xs text-fg-secondary">
            <p>Restore requests are recorded here for the maintenance runner to execute against a selected backup artifact. They do not overwrite the live database inline.</p>
            <Button
              variant="danger"
              size="sm"
              loading={requestRestore.isPending}
              disabled={!canRequestRestore}
              onClick={() => requestRestore.mutate()}
            >
              Request restore
            </Button>
          </div>

          {overview.data.restore_requests.length === 0 ? (
            <p className="text-sm text-fg-tertiary">No restore requests have been recorded yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {overview.data.restore_requests.map((request) => (
                <div key={request.id} className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-fg">{request.status}</p>
                      <Badge variant="default">{request.artifact_id.slice(0, 8)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-fg-tertiary">
                      Requested {new Date(request.requested_at).toLocaleString()}
                    </p>
                    {request.notes && <p className="mt-1 text-xs text-fg-tertiary">{request.notes}</p>}
                    {request.error_message && <p className="mt-1 text-xs text-[#FCA5A5]">{request.error_message}</p>}
                  </div>
                  <p className="font-mono text-xs text-fg-tertiary">{request.id}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
