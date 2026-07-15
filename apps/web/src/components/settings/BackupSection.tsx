import React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@riviamigo/hooks';
import type { BackupFrequency, BackupOverview, BackupTargetType, UpdateBackupSettingsBody } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  DatabaseBackup,
  Download,
  HardDrive,
  History,
  Play,
  RotateCcw,
  Save,
  Server,
  Timer,
  X,
} from 'lucide-react';

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

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
}

function emitToast(title: string, message: string) {
  window.dispatchEvent(new CustomEvent('riviamigo:toast', {
    detail: { title, message, variant: 'error' },
  }));
}

function buildDraft(overview: BackupOverview): BackupDraft {
  const s = overview.settings;
  return {
    enabled: s.enabled,
    frequency: s.frequency,
    run_at: s.run_at,
    timezone: s.timezone || detectTimezone(),
    day_of_week: s.day_of_week,
    day_of_month: s.day_of_month,
    retention_count: String(s.retention_count),
    target_type: s.target_type,
    endpoint: s.endpoint,
    region: s.region ?? '',
    bucket: s.bucket,
    prefix: s.prefix,
    access_key: s.access_key ?? '',
  };
}

function buildPayload(
  draft: BackupDraft,
  secretKey: string,
  clearSecretKey: boolean,
  s3Enabled: boolean,
): UpdateBackupSettingsBody | null {
  const retention = Number.parseInt(draft.retention_count, 10);
  if (!Number.isFinite(retention) || retention < 1) return null;

  return {
    enabled: draft.enabled,
    frequency: draft.frequency,
    run_at: draft.run_at,
    timezone: draft.timezone.trim(),
    day_of_week: draft.frequency === 'weekly' ? draft.day_of_week : null,
    day_of_month: draft.frequency === 'monthly' ? draft.day_of_month : null,
    retention_count: retention,
    target_type: draft.target_type,
    endpoint: s3Enabled ? draft.endpoint.trim() : '',
    region: s3Enabled ? (draft.region.trim() || null) : null,
    bucket: s3Enabled ? draft.bucket.trim() : '',
    prefix: s3Enabled ? draft.prefix.trim() : '',
    access_key: s3Enabled ? (draft.access_key.trim() || null) : null,
    ...(secretKey.trim() ? { secret_key: secretKey.trim() } : {}),
    ...(clearSecretKey ? { clear_secret_key: true } : {}),
  };
}

function describeSchedule(overview: BackupOverview) {
  const s = overview.settings;
  const parts = [`${s.frequency} at ${s.run_at}`];
  if (s.frequency === 'weekly') {
    const weekday = WEEKDAYS.find((w) => w.value === s.day_of_week);
    if (weekday) parts.push(weekday.label);
  }
  if (s.frequency === 'monthly' && s.day_of_month) parts.push(`day ${s.day_of_month}`);
  parts.push(s.timezone);
  return parts.join(' / ');
}

function capitalizeFirstLetter(value: string) {
  if (!value) return value;
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-[22px] w-10 shrink-0 rounded-full border transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        checked ? 'border-accent/60 bg-accent' : 'border-border bg-bg-elevated',
        disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none absolute top-[2px] inline-block h-4 w-4 rounded-full shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[22px] bg-fg' : 'translate-x-[2px] bg-fg-tertiary',
        ].join(' ')}
      />
    </button>
  );
}

function InfoChip({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        'flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5',
        accent ? 'border-accent/40 bg-accent/10' : 'border-border bg-bg-elevated/50',
      ].join(' ')}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${accent ? 'text-accent' : 'text-fg-tertiary'}`} />
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium uppercase leading-none tracking-wider text-fg-tertiary">
          {label}
        </p>
        <p className="mt-1 truncate font-mono text-xs font-semibold leading-none text-fg">{value}</p>
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled = false,
  indent = false,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={[
        'flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/30 px-3 py-2.5',
        indent ? 'ml-4' : '',
      ].join(' ')}
    >
      <div>
        <p className={`text-sm font-medium ${disabled ? 'text-fg-tertiary' : 'text-fg'}`}>{title}</p>
        <p className="mt-0.5 text-xs text-fg-tertiary">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function BackupSection() {
  const queryClient = useQueryClient();
  const [recentRunsPage, setRecentRunsPage] = React.useState(1);
  const [recentRunsPerPage, setRecentRunsPerPage] = React.useState(10);
  const overview = useQuery({
    queryKey: ['backup-overview', recentRunsPage, recentRunsPerPage],
    queryFn: () => api.getBackupOverview({ page: recentRunsPage, perPage: recentRunsPerPage }),
    placeholderData: keepPreviousData,
  });
  const [draft, setDraft] = React.useState<BackupDraft | null>(null);
  const [localEnabled, setLocalEnabled] = React.useState(true);
  const s3Enabled = false;
  const [secretKey, setSecretKey] = React.useState('');
  const [clearSecretKey, setClearSecretKey] = React.useState(false);
  const [expandedArtifactId, setExpandedArtifactId] = React.useState<string | null>(null);
  const [pendingRestoreArtifact, setPendingRestoreArtifact] = React.useState<BackupOverview['artifacts'][number] | null>(null);
  const detectedTimezone = React.useMemo(() => detectTimezone(), []);

  React.useEffect(() => {
    if (!overview.data) return;
    setDraft(buildDraft(overview.data));
    setLocalEnabled(true);
    setSecretKey('');
    setClearSecretKey(false);
  }, [overview.data?.settings.updated_at]);

  React.useEffect(() => {
    if (!overview.data) return;
    setExpandedArtifactId((current) => {
      if (current && overview.data.artifacts.some((artifact) => artifact.id === current)) {
        return current;
      }
      return null;
    });
  }, [overview.data?.artifacts]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('Backup settings are not ready yet.');
      const payload = buildPayload(draft, secretKey, clearSecretKey, false);
      if (!payload) throw new Error('Retention must be a whole number greater than zero.');
      return api.updateBackupSettings(payload);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backup-overview'] }),
    onError: (error) => {
      emitToast('Backup settings', error instanceof Error ? error.message : 'Backup settings could not be saved.');
    },
  });

  const runBackupNow = useMutation({
    mutationFn: () => api.runBackupNow(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backup-overview'] }),
    onError: (error) => {
      emitToast('Backup run', error instanceof Error ? error.message : 'Backup run could not be started.');
    },
  });

  const downloadArtifact = useMutation({
    mutationFn: async (artifact: BackupOverview['artifacts'][number]) => {
      const { blob, fileName } = await api.downloadBackupArtifact(artifact.id);
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
    onError: (error) => {
      emitToast('Download backup', error instanceof Error ? error.message : 'Backup download could not be started.');
    },
  });

  const requestRestore = useMutation({
    mutationFn: (artifact: BackupOverview['artifacts'][number]) =>
      api.requestBackupRestore({
        artifact_id: artifact.id,
        confirmation_phrase: 'RESTORE',
        notes: null,
      }),
    onSuccess: () => {
      setPendingRestoreArtifact(null);
      queryClient.invalidateQueries({ queryKey: ['backup-overview'] });
    },
    onError: (error) => {
      emitToast('Restore request', error instanceof Error ? error.message : 'Restore request could not be created.');
    },
  });

  function updateDraft<K extends keyof BackupDraft>(key: K, value: BackupDraft[K]) {
    setDraft((cur) => cur ? { ...cur, [key]: value } : cur);
  }

  if (overview.isLoading || !draft || !overview.data) {
    return (
      <Card>
        <CardHeader><CardTitle>Backup schedule</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-fg-tertiary">Loading backup controls...</p></CardContent>
      </Card>
    );
  }

  const currentSettings = overview.data.settings;
  const s3Valid = !s3Enabled || (draft.bucket.trim().length > 0 && draft.endpoint.trim().length > 0);
  const canSave = draft.run_at.trim().length === 5
    && draft.timezone.trim().length > 0
    && Number.parseInt(draft.retention_count, 10) >= 1
    && s3Valid;
  const recentRunsTotal = overview.data.recent_runs_total;
  const recentRunsPageCount = Math.max(1, Math.ceil(recentRunsTotal / recentRunsPerPage));
  const timezoneIsAutoDetected = !!detectedTimezone && draft.timezone === detectedTimezone && !currentSettings.timezone;
  const runNowAllowed = overview.data.runtime_readiness?.run_now_allowed ?? true;
  const runNowReason = overview.data.runtime_readiness?.reason;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Schedule card ── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Backup schedule</CardTitle>
            <Badge variant={currentSettings.enabled ? 'success' : 'default'}>
              {currentSettings.enabled ? 'Automatic' : 'Disabled'}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Play className="h-3.5 w-3.5" />}
              loading={runBackupNow.isPending}
              disabled={!runNowAllowed}
              onClick={() => runBackupNow.mutate()}
            >
              Run now
            </Button>
            <Button
              size="sm"
              iconLeft={<Save className="h-3.5 w-3.5" />}
              loading={saveSettings.isPending}
              disabled={!canSave}
              onClick={() => saveSettings.mutate()}
            >
              Save settings
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!runNowAllowed && runNowReason && (
            <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
              Manual backup unavailable: {runNowReason}
            </div>
          )}

          {/* Status chips — equal-width grid */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <InfoChip
              icon={Timer}
              label="Next run"
              value={overview.data.next_run_at ? new Date(overview.data.next_run_at).toLocaleString() : 'Not scheduled'}
              accent={currentSettings.enabled}
            />
            <InfoChip
              icon={Calendar}
              label="Schedule"
              value={describeSchedule(overview.data)}
            />
            <InfoChip
              icon={CheckCircle2}
              label="Latest success"
              value={
                overview.data.latest_successful_run?.completed_at
                  ? new Date(overview.data.latest_successful_run.completed_at).toLocaleString()
                  : 'None yet'
              }
            />
            <InfoChip
              icon={HardDrive}
              label="Retention"
              value={`${currentSettings.retention_count} set${currentSettings.retention_count === 1 ? '' : 's'}`}
            />
          </div>

          {/* Master scheduling toggle */}
          <ToggleRow
            title="Scheduled backups"
            description="Run automated backups on the schedule below"
            checked={draft.enabled}
            onChange={(v) => updateDraft('enabled', v)}
          />

          {/* Sub-toggles — only shown when scheduling is on */}
          {draft.enabled && (
            <div className="grid gap-2">
              <ToggleRow
                title="Local backup"
                description="Store a copy of each backup artifact on disk"
                checked={localEnabled}
                onChange={setLocalEnabled}
                indent
              />
            </div>
          )}

          {/* Schedule fields */}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                Timezone
                {timezoneIsAutoDetected && (
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-accent/80">
                    auto-detected
                  </span>
                )}
              </span>
              <input
                value={draft.timezone}
                onChange={(e) => updateDraft('timezone', e.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                placeholder={detectedTimezone || 'America/Chicago'}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Run time</span>
              <input
                type="time"
                step={60}
                value={draft.run_at}
                onChange={(e) => updateDraft('run_at', e.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-[10rem_10rem_10rem_10rem] md:items-end">
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Frequency</span>
              <SelectPicker
                className="w-full"
                value={draft.frequency}
                onChange={(value) => updateDraft('frequency', value as BackupFrequency)}
                aria-label="Backup frequency"
                options={[{ value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' }]}
              />
            </label>

            {draft.frequency === 'weekly' && (
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Weekday</span>
                <SelectPicker
                  className="w-full"
                  value={String(draft.day_of_week ?? 0)}
                  onChange={(value) => updateDraft('day_of_week', Number.parseInt(value, 10))}
                  aria-label="Weekday"
                  options={WEEKDAYS.map((weekday) => ({ value: String(weekday.value), label: weekday.label }))}
                />
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
                  onChange={(e) => updateDraft('day_of_month', Number.parseInt(e.target.value, 10) || 1)}
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
                onChange={(e) => updateDraft('retention_count', e.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* ── S3 upload card ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-fg-secondary" />
            <CardTitle>Off-site storage</CardTitle>
            <span className="text-xs text-fg-tertiary">Optional — uploads in addition to local storage</span>
          </div>
          <Badge variant="default">Not configured</Badge>
        </CardHeader>

        {s3Enabled ? (
          <CardContent className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Endpoint</span>
                <input
                  value={draft.endpoint}
                  onChange={(e) => updateDraft('endpoint', e.target.value)}
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                  placeholder="https://s3.example.com"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Region</span>
                <input
                  value={draft.region}
                  onChange={(e) => updateDraft('region', e.target.value)}
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                  placeholder="us-east-1"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Bucket</span>
                <input
                  value={draft.bucket}
                  onChange={(e) => updateDraft('bucket', e.target.value)}
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                  placeholder="riviamigo-backups"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Prefix</span>
                <input
                  value={draft.prefix}
                  onChange={(e) => updateDraft('prefix', e.target.value)}
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                  placeholder="prod/riviamigo"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Access key</span>
                <input
                  value={draft.access_key}
                  onChange={(e) => updateDraft('access_key', e.target.value)}
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                  placeholder="Optional if runtime credentials are injected"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Secret key</span>
                <input
                  type="password"
                  value={secretKey}
                  onChange={(e) => { setSecretKey(e.target.value); setClearSecretKey(false); }}
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                  placeholder={currentSettings.has_secret_key ? 'Leave blank to keep the stored secret' : 'Enter secret key'}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-elevated/30 p-3 text-sm text-fg-tertiary">
              <Clock3 className="h-4 w-4 shrink-0" />
              <span>Secrets are stored encrypted in the application database. Backups create verified local artifacts then upload to the configured S3 target.</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-fg">
                {currentSettings.has_secret_key ? 'Clear the stored secret key on next save' : 'No stored secret key yet'}
              </span>
              <Toggle
                checked={clearSecretKey}
                onChange={setClearSecretKey}
                disabled={!currentSettings.has_secret_key}
              />
            </div>
          </CardContent>
        ) : (
          <CardContent>
            <p className="text-sm text-fg-tertiary">
              S3 upload is off — backups are stored locally only. Enable to configure an S3-compatible upload target.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Recent runs */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-fg-secondary" />
            <CardTitle>Recent backup runs</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="default">Execution history</Badge>
            <label className="flex items-center gap-2 text-xs text-fg-tertiary">
              Rows
              <SelectPicker
                className="min-w-[4.5rem]"
                value={String(recentRunsPerPage)}
                onChange={(value) => {
                  setRecentRunsPerPage(Number(value));
                  setRecentRunsPage(1);
                }}
                aria-label="Recent backup runs per page"
                size="sm"
                options={[10, 25, 50, 100].map((option) => ({ value: String(option), label: String(option) }))}
              />
            </label>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {overview.data.recent_runs.length === 0 ? (
            <p className="text-sm text-fg-tertiary">
              No backup executions recorded yet. Use Run now to create the first cataloged artifact.
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="divide-y divide-border">
                  {overview.data.recent_runs.map((run) => (
                    <div key={run.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="shrink-0 text-xs text-fg-tertiary tabular-nums">
                          {new Date(run.created_at).toLocaleString()}
                        </span>
                        <span className="text-xs font-medium capitalize text-fg-secondary">{capitalizeFirstLetter(run.trigger)}</span>
                        {run.error_message && (
                          <span className="min-w-0 truncate text-xs text-status-danger" title={run.error_message}>
                            {run.error_message}
                          </span>
                        )}
                      </div>
                      <Badge
                        className="justify-self-start sm:justify-self-end"
                        variant={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'danger' : 'default'}
                      >
                        {capitalizeFirstLetter(run.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-between border-t border-border pt-3">
                <p className="text-xs text-fg-tertiary">
                  Page {overview.data.recent_runs_page} of {recentRunsPageCount} · {recentRunsTotal} run{recentRunsTotal === 1 ? '' : 's'}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={overview.data.recent_runs_page <= 1}
                    onClick={() => setRecentRunsPage((page) => Math.max(1, page - 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={overview.data.recent_runs_page >= recentRunsPageCount}
                    onClick={() => setRecentRunsPage((page) => Math.min(recentRunsPageCount, page + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Backups */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-4 w-4 text-fg-secondary" />
            <CardTitle>Backups</CardTitle>
          </div>
          <Badge variant="default">Local catalog</Badge>
        </CardHeader>
        <CardContent>
          {overview.data.artifacts.length === 0 ? (
            <p className="text-sm text-fg-tertiary">No backup artifact has been written yet.</p>
          ) : (
            <div className="space-y-2">
              {overview.data.artifacts.map((artifact) => {
                const isExpanded = expandedArtifactId === artifact.id;
                return (
                  <div
                    key={artifact.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedArtifactId((current) => current === artifact.id ? null : artifact.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setExpandedArtifactId((current) => current === artifact.id ? null : artifact.id);
                      }
                    }}
                    className="rounded-lg border border-border bg-bg-elevated/20 transition-colors hover:bg-bg-elevated/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <button
                        type="button"
                        aria-label={isExpanded ? 'Collapse backup details' : 'Expand backup details'}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-surface text-fg-secondary hover:text-fg"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedArtifactId((current) => current === artifact.id ? null : artifact.id);
                        }}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-fg">
                          {new Date(artifact.created_at).toLocaleString()}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-tertiary capitalize">
                          {artifact.storage_type}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Download backup ${artifact.id}`}
                          iconLeft={<Download className="h-3.5 w-3.5" />}
                          loading={downloadArtifact.isPending && downloadArtifact.variables?.id === artifact.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            downloadArtifact.mutate(artifact);
                          }}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Restore backup ${artifact.id}`}
                          iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPendingRestoreArtifact(artifact);
                          }}
                        />
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-border bg-bg-elevated/25 px-3 py-3 text-xs text-fg-tertiary">
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">File name</p>
                            <p className="mt-1 font-mono text-xs text-fg">{artifact.file_name}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Type</p>
                            <p className="mt-1 font-mono text-xs text-fg capitalize">{artifact.storage_type}</p>
                          </div>
                          <div className="md:col-span-2">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Location</p>
                            <p className="mt-1 break-all font-mono text-xs text-fg">{artifact.storage_path}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Size</p>
                            <p className="mt-1 font-mono text-xs text-fg">{Math.max(artifact.size_bytes, 0).toLocaleString()} bytes</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">SHA-256</p>
                            <p className="mt-1 break-all font-mono text-xs text-fg">{artifact.checksum_sha256}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Run ID</p>
                            <p className="mt-1 font-mono text-xs text-fg">{artifact.run_id}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Created</p>
                            <p className="mt-1 font-mono text-xs text-fg">{new Date(artifact.created_at).toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {pendingRestoreArtifact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-page/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-surface p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-status-warning/30 bg-status-warning/10 text-status-warning">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">Restore this backup?</p>
                <p className="mt-1 text-sm text-fg-tertiary">
                  This will create a restore request for <span className="font-mono text-fg">{pendingRestoreArtifact.file_name}</span>.
                  It does not overwrite the database immediately.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-fg-tertiary hover:bg-bg-elevated hover:text-fg"
                aria-label="Close restore confirmation"
                onClick={() => setPendingRestoreArtifact(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPendingRestoreArtifact(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={requestRestore.isPending}
                onClick={() => requestRestore.mutate(pendingRestoreArtifact)}
              >
                Restore backup
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Restore requests */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-fg-secondary" />
            <CardTitle>Restore requests</CardTitle>
          </div>
          <Badge variant="danger">Admin only</Badge>
        </CardHeader>
        <CardContent>
          {overview.data.restore_requests.length === 0 ? (
            <p className="text-sm text-fg-tertiary">No restore requests have been recorded yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {overview.data.restore_requests.map((request) => (
                <div key={request.id} className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-fg">{capitalizeFirstLetter(request.status)}</p>
                      <Badge variant="default">{request.artifact_id.slice(0, 8)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-fg-tertiary">
                      Requested {new Date(request.requested_at).toLocaleString()}
                    </p>
                    {request.notes && <p className="mt-1 text-xs text-fg-tertiary">{request.notes}</p>}
                    {request.error_message && <p className="mt-1 text-xs text-status-danger">{request.error_message}</p>}
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
