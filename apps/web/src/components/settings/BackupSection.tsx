import React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@riviamigo/hooks';
import type { BackupFrequency, BackupOverview, BackupTargetType, RestoreJob, UpdateBackupSettingsBody } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, SelectPicker } from '@riviamigo/ui/primitives';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  DatabaseBackup,
  Download,
  Cloud,
  HardDrive,
  History,
  Play,
  RotateCcw,
  Save,
  Timer,
  Trash2,
  Upload,
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

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/New_York',
  'America/Phoenix',
  'America/Toronto',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/London',
  'Pacific/Auckland',
];

function listTimezones(): string[] {
  const supportedValuesOf = Intl.supportedValuesOf as ((key: string) => string[]) | undefined;
  const timezones = supportedValuesOf?.('timeZone') ?? FALLBACK_TIMEZONES;
  return Array.from(new Set(['UTC', ...timezones]));
}

function formatUtcOffset(timezone: string): string {
  try {
    const offset = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value;
    if (!offset || offset === 'GMT') return 'UTC+00:00';
    return `UTC${offset.replace(/^GMT/, '')}`;
  } catch {
    return 'UTC offset unavailable';
  }
}

function buildTimezoneOptions(currentTimezone?: string) {
  const timezones = listTimezones();
  if (currentTimezone && !timezones.includes(currentTimezone)) timezones.unshift(currentTimezone);
  return timezones.map((timezone) => ({
    value: timezone,
    label: `${timezone} (${formatUtcOffset(timezone)})`,
  }));
}

function formatRestoreDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours} hr` : `${hours} hr ${remainingMinutes} min`;
}

function estimateRestoreRange(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) return 'a few minutes';
  const sizeMiB = sizeBytes / (1024 * 1024);
  const minimum = Math.max(2, Math.ceil(2 + sizeMiB / 50));
  const maximum = Math.max(minimum + 3, Math.ceil(6 + sizeMiB / 15));
  return `${formatRestoreDuration(minimum)}–${formatRestoreDuration(maximum)}`;
}

interface BackupDraft {
  enabled: boolean;
  frequency: BackupFrequency;
  run_at: string;
  timezone: string;
  day_of_week: number | null;
  day_of_month: number | null;
  retention_count: string;
  local_enabled: boolean;
  s3_enabled: boolean;
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
    local_enabled: s.local_enabled ?? true,
    s3_enabled: s.s3_enabled ?? false,
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
    local_enabled: draft.local_enabled,
    s3_enabled: draft.s3_enabled,
    target_type: draft.target_type,
    endpoint: draft.s3_enabled ? draft.endpoint.trim() : '',
    region: draft.s3_enabled ? (draft.region.trim() || null) : null,
    bucket: draft.s3_enabled ? draft.bucket.trim() : '',
    prefix: draft.s3_enabled ? draft.prefix.trim() : '',
    access_key: draft.s3_enabled ? (draft.access_key.trim() || null) : null,
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

function storageLabel(storageType: BackupOverview['artifacts'][number]['storage_type'], manifest?: BackupOverview['artifacts'][number]['manifest']) {
  if (storageType === 's3') return 'S3';
  if (storageType === 'uploaded') return 'Imported';
  if (storageType === 'safety') return 'Safety';
  return manifest?.emergency_fallback ? 'Local fallback' : 'Local';
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
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={[
        'flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/30 px-3 py-2.5',
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
  const [secretKey, setSecretKey] = React.useState('');
  const [clearSecretKey, setClearSecretKey] = React.useState(false);
  const [expandedArtifactId, setExpandedArtifactId] = React.useState<string | null>(null);
  const [catalogSource, setCatalogSource] = React.useState<'all' | 'local' | 's3' | null>(null);
  const [restoreArtifactId, setRestoreArtifactId] = React.useState('');
  const [pendingRestoreArtifact, setPendingRestoreArtifact] = React.useState<BackupOverview['artifacts'][number] | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = React.useState('');
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(null);
  const [activeRestore, setActiveRestore] = React.useState<{ job: RestoreJob; token: string } | null>(null);
  const [activeRestoreSizeBytes, setActiveRestoreSizeBytes] = React.useState<number | null>(null);
  const [restoreStatusUnavailable, setRestoreStatusUnavailable] = React.useState(false);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const detectedTimezone = React.useMemo(() => detectTimezone(), []);

  React.useEffect(() => {
    if (!overview.data) return;
    setDraft(buildDraft(overview.data));
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

  React.useEffect(() => {
    if (!overview.data) return;
    setRestoreArtifactId((current) => (
      current && overview.data.artifacts.some((artifact) => artifact.id === current)
        ? current
        : overview.data.artifacts[0]?.id ?? ''
    ));
  }, [overview.data?.artifacts]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('Backup settings are not ready yet.');
      const payload = buildPayload(draft, secretKey, clearSecretKey);
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

  const testS3 = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('Backup settings are not ready yet.');
      const payload = buildPayload(draft, secretKey, clearSecretKey);
      if (!payload) throw new Error('Backup settings are invalid.');
      return api.testBackupS3(payload);
    },
    onSuccess: ({ message }) => window.dispatchEvent(new CustomEvent('riviamigo:toast', { detail: { title: 'S3 connection', message, variant: 'success' } })),
    onError: (error) => emitToast('S3 connection', error instanceof Error ? error.message : 'The S3 connection test failed.'),
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

  const uploadArtifact = useMutation({
    mutationFn: (file: File) => api.uploadBackupArtifact(file, (loaded, total) => {
      setUploadProgress(total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0);
    }),
    onSuccess: ({ artifact }) => {
      setUploadProgress(null);
      setExpandedArtifactId(artifact.id);
      setRestoreArtifactId(artifact.id);
      queryClient.invalidateQueries({ queryKey: ['backup-overview'] });
    },
    onError: (error) => {
      setUploadProgress(null);
      emitToast('Import recovery package', error instanceof Error ? error.message : 'The recovery package could not be imported.');
    },
  });

  const deleteUploadedArtifact = useMutation({
    mutationFn: (artifactId: string) => api.deleteUploadedBackup(artifactId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backup-overview'] }),
    onError: (error) => emitToast('Delete imported package', error instanceof Error ? error.message : 'The imported package could not be deleted.'),
  });

  const requestRestore = useMutation({
    mutationFn: (artifact: BackupOverview['artifacts'][number]) =>
      api.startBackupRestore({
        artifact_id: artifact.id,
        confirmation_phrase: restoreConfirmation,
        notes: null,
      }),
    onSuccess: ({ job, capability_token }, artifact) => {
      setActiveRestore({ job, token: capability_token });
      setActiveRestoreSizeBytes(artifact.size_bytes);
      setRestoreStatusUnavailable(false);
      setPendingRestoreArtifact(null);
      setRestoreConfirmation('');
      queryClient.invalidateQueries({ queryKey: ['backup-overview'] });
    },
    onError: (error) => {
      emitToast('Restore request', error instanceof Error ? error.message : 'Restore request could not be created.');
    },
  });

  React.useEffect(() => {
    if (!activeRestore || activeRestore.job.phase === 'completed' || activeRestore.job.phase === 'failed') return;
    let stopped = false;
    const poll = async () => {
      try {
        const job = await api.getRestoreJob(activeRestore.job.id, activeRestore.token);
        if (stopped) return;
        setRestoreStatusUnavailable(false);
        setActiveRestore((current) => current ? { ...current, job } : current);
        if (job.phase === 'completed') {
          window.setTimeout(() => window.location.reload(), 1200);
        }
      } catch {
        setRestoreStatusUnavailable(true);
        // The API process intentionally disappears during restore. The
        // restore supervisor or restarted API may remain available while the
        // application process is being replaced. Keep polling until it returns.
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [activeRestore?.job.id, activeRestore?.job.phase, activeRestore?.token]);

  function updateDraft<K extends keyof BackupDraft>(key: K, value: BackupDraft[K]) {
    setDraft((cur) => cur ? { ...cur, [key]: value } : cur);
  }

  const timezoneOptions = React.useMemo(() => buildTimezoneOptions(draft?.timezone), [draft?.timezone]);
  const activeRestoreEstimate = estimateRestoreRange(activeRestoreSizeBytes);

  if (overview.isLoading || !draft || !overview.data) {
    return (
      <Card>
        <CardHeader><CardTitle>Backup schedule</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-fg-tertiary">Loading backup controls...</p></CardContent>
      </Card>
    );
  }

  const currentSettings = overview.data.settings;
  const s3Valid = !draft.s3_enabled || (draft.bucket.trim().length > 0 && draft.access_key.trim().length > 0 && (currentSettings.has_secret_key || secretKey.trim().length > 0));
  const canSave = draft.run_at.trim().length === 5
    && draft.timezone.trim().length > 0
    && Number.parseInt(draft.retention_count, 10) >= 1
    && (draft.local_enabled || draft.s3_enabled)
    && s3Valid;
  const recentRunsTotal = overview.data.recent_runs_total;
  const recentRunsPageCount = Math.max(1, Math.ceil(recentRunsTotal / recentRunsPerPage));
  const timezoneIsAutoDetected = !!detectedTimezone && draft.timezone === detectedTimezone && !currentSettings.timezone;
  const runNowAllowed = overview.data.runtime_readiness?.run_now_allowed ?? true;
  const runNowReason = overview.data.runtime_readiness?.reason;
  const restoreArtifact = overview.data.artifacts.find((artifact) => artifact.id === restoreArtifactId) ?? null;
  const restoreArtifactOptions = overview.data.artifacts.map((artifact) => ({
    value: artifact.id,
    label: new Date(artifact.created_at).toLocaleString(),
    description: `${storageLabel(artifact.storage_type, artifact.manifest)} · ${artifact.file_name}`,
  }));
  const restoreAutomationReason = overview.data.runtime_readiness?.restore_automation_reason;
  const hasLocalArtifacts = overview.data.artifacts.some((artifact) => (artifact.storage_type as string) !== 's3');
  const hasS3Artifacts = overview.data.artifacts.some((artifact) => (artifact.storage_type as string) === 's3');
  const hasLocalCatalog = hasLocalArtifacts || !hasS3Artifacts;
  const s3Configured = Boolean(currentSettings.endpoint && currentSettings.bucket);
  const availableCatalogSources = [
    ...(hasLocalCatalog && (hasS3Artifacts || s3Configured) ? [{ value: 'all', label: 'All backups' }] : []),
    ...(hasLocalCatalog ? [{ value: 'local', label: 'Local' }] : []),
    ...(hasS3Artifacts || s3Configured ? [{ value: 's3', label: 'S3' }] : []),
  ];
  const defaultCatalogSource = hasLocalCatalog && hasS3Artifacts
    ? 'all'
    : hasS3Artifacts && !hasLocalCatalog
      ? 's3'
      : 'local';
  const selectedCatalogSource = catalogSource && availableCatalogSources.some((source) => source.value === catalogSource)
    ? catalogSource
    : defaultCatalogSource;
  const visibleArtifacts = overview.data.artifacts.filter((artifact) => (
    selectedCatalogSource === 'all'
      || (selectedCatalogSource === 's3' ? (artifact.storage_type as string) === 's3' : (artifact.storage_type as string) !== 's3')
  ));

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
          <div className="grid gap-2 md:grid-cols-2">
            <ToggleRow title="Local backup" description="Retain each recovery package on this host" checked={draft.local_enabled} onChange={(value) => updateDraft('local_enabled', value)} />
            <ToggleRow title="S3 backup" description="Upload each package to off-site S3-compatible storage" checked={draft.s3_enabled} onChange={(value) => updateDraft('s3_enabled', value)} />
          </div>

          {draft.s3_enabled && (
            <div className="grid gap-3 rounded-lg border border-border bg-bg-elevated/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="flex items-center gap-2 text-sm font-medium text-fg"><Cloud className="h-4 w-4 text-accent" />S3-compatible storage</p><p className="mt-0.5 text-xs text-fg-tertiary">Custom endpoints use path-style addressing for Garage, MinIO, and similar providers.</p></div>
                <Button variant="secondary" size="sm" loading={testS3.isPending} disabled={!s3Valid} onClick={() => testS3.mutate()}>Test S3 connection</Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 md:col-span-2"><span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Endpoint <span className="font-normal normal-case">(leave blank for AWS)</span></span><input value={draft.endpoint} onChange={(event) => updateDraft('endpoint', event.target.value)} placeholder="https://s3.example.com" className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Region</span><input value={draft.region} onChange={(event) => updateDraft('region', event.target.value)} placeholder="us-east-1" className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Bucket</span><input value={draft.bucket} onChange={(event) => updateDraft('bucket', event.target.value)} className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Prefix</span><input value={draft.prefix} onChange={(event) => updateDraft('prefix', event.target.value)} placeholder="riviamigo" className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent" /></label>
                <label className="grid gap-1"><span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Access key</span><input autoComplete="off" value={draft.access_key} onChange={(event) => updateDraft('access_key', event.target.value)} className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent" /></label>
                <label className="grid gap-1 md:col-span-2"><span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Secret key</span><input type="password" autoComplete="new-password" value={secretKey} onChange={(event) => { setSecretKey(event.target.value); setClearSecretKey(false); }} placeholder={currentSettings.has_secret_key ? 'Saved secret is unchanged' : 'Enter secret key'} className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent" /></label>
                {currentSettings.has_secret_key && <label className="flex items-center gap-2 text-xs text-fg-tertiary md:col-span-2"><input type="checkbox" checked={clearSecretKey} onChange={(event) => setClearSecretKey(event.target.checked)} />Clear the saved secret when settings are saved</label>}
              </div>
              {overview.data.s3_catalog_error && <p className="text-xs text-status-warning">S3 catalog unavailable: {overview.data.s3_catalog_error}</p>}
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
              <SelectPicker
                className="w-full"
                value={draft.timezone}
                onChange={(value) => updateDraft('timezone', value)}
                aria-label="Timezone"
                options={timezoneOptions}
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
            <div>
              <CardTitle>Recovery packages</CardTitle>
              <p className="mt-1 text-xs text-fg-tertiary">
                {s3Configured
                  ? 'Browse recovery packages stored locally and in the configured S3 target.'
                  : 'Browse retained local packages, or enable S3 above for off-site recovery.'}
              </p>
            </div>
          </div>
          <SelectPicker
            className="min-w-[9rem]"
            value={selectedCatalogSource}
            onChange={(value) => setCatalogSource(value as 'all' | 'local' | 's3')}
            aria-label="Recovery package location"
            size="sm"
            options={availableCatalogSources}
          />
        </CardHeader>
        <CardContent className="grid gap-3">
          {visibleArtifacts.length === 0 ? (
            <p className="text-sm text-fg-tertiary">
              {selectedCatalogSource === 's3'
                ? 'No S3 recovery packages are available yet.'
                : 'No local recovery package has been written yet.'}
            </p>
          ) : (
            <div className="space-y-2">
              {visibleArtifacts.map((artifact) => {
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
                        {artifact.storage_type === 'uploaded' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`Delete imported backup ${artifact.id}`}
                            iconLeft={<Trash2 className="h-3.5 w-3.5" />}
                            loading={deleteUploadedArtifact.isPending && deleteUploadedArtifact.variables === artifact.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (window.confirm(`Delete imported recovery package "${artifact.file_name}"?`)) {
                                deleteUploadedArtifact.mutate(artifact.id);
                              }
                            }}
                          />
                        )}
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
                        {artifact.manifest.package && (
                          <div className="mt-4 border-t border-border pt-3">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Recovery package</p>
                            <div className="mt-2 grid gap-3 md:grid-cols-2">
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Format</p>
                                <p className="mt-1 font-mono text-xs text-fg">
                                  {artifact.manifest.package.format ?? 'Unknown'} v{artifact.manifest.package.format_version ?? '?'}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Source release</p>
                                <p className="mt-1 font-mono text-xs text-fg">
                                  {artifact.manifest.package.source?.app_version ?? 'Unknown'}
                                </p>
                              </div>
                              {(['included', 'redacted', 'excluded'] as const).map((scopeKey) => {
                                const values = artifact.manifest.package?.scope?.[scopeKey] ?? [];
                                return (
                                  <div key={scopeKey} className="md:col-span-2">
                                    <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">{capitalizeFirstLetter(scopeKey)}</p>
                                    <p className="mt-1 text-xs text-fg">{values.join(' · ') || 'None listed'}</p>
                                  </div>
                                );
                              })}
                              <div className="md:col-span-2">
                                <p className="text-[10px] font-medium uppercase tracking-wider text-fg-tertiary">Restore instruction</p>
                                <p className="mt-1 text-xs text-fg">
                                  {String(artifact.manifest.package.restore?.requires ?? 'Use the restore script')}; provider credentials require re-authentication.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
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
                  This replaces the current users, dashboards, telemetry, settings, and artwork with <span className="font-mono text-fg">{pendingRestoreArtifact.file_name}</span>.
                  Riviamigo creates a required safety package first, stops its API and ingestion workers, restores the package, and starts cleanly on the restored data.
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
            <label className="mt-4 grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Type RESTORE to continue</span>
              <input
                autoFocus
                value={restoreConfirmation}
                onChange={(event) => setRestoreConfirmation(event.target.value)}
                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 font-mono text-sm text-fg outline-none focus:border-accent"
              />
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setPendingRestoreArtifact(null); setRestoreConfirmation(''); }}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={requestRestore.isPending}
                disabled={restoreConfirmation !== 'RESTORE' || !overview.data.runtime_readiness.restore_automation_available}
                onClick={() => requestRestore.mutate(pendingRestoreArtifact)}
              >
                Create safety backup and restore
              </Button>
            </div>
            {!overview.data.runtime_readiness.restore_automation_available && (
              <p className="mt-3 text-xs text-status-warning">Automated restore is unavailable in this runtime. Use the documented restore script on the host.</p>
            )}
          </div>
        </div>
      )}

      {activeRestore && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-bg-page/90 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-bg-surface p-6 shadow-2xl" role="status" aria-live="polite">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">Restoring Riviamigo</p>
                <p className="mt-1 text-sm text-fg-tertiary">{activeRestore.job.message}</p>
              </div>
              {activeRestore.job.phase !== 'failed' && (
                <span className="text-xs text-fg-tertiary">Estimated {activeRestoreEstimate}</span>
              )}
            </div>
            <div
              role="progressbar"
              aria-label="Restore activity"
              aria-valuetext={activeRestore.job.phase === 'failed' ? 'Restore failed' : 'Restore is running'}
              className="mt-4 h-2.5 overflow-hidden rounded-full bg-bg-elevated"
            >
              <div className={`h-full rounded-full ${activeRestore.job.phase === 'failed' ? 'bg-status-danger' : activeRestore.job.phase === 'completed' ? 'bg-status-success' : 'rm-restore-activity'}`} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-tertiary">
              <span className="capitalize">{activeRestore.job.phase.replaceAll('_', ' ')}</span>
              {activeRestore.job.phase !== 'failed' && (
                <span>Estimate based on package size; safety backup and database load can extend it.</span>
              )}
            </div>
            {restoreStatusUnavailable && activeRestore.job.phase !== 'failed' && (
              <div className="mt-4 rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-status-warning">
                The application is restarting for the restore. The restore may continue while this page cannot reach the API; we’ll keep checking and reload when the server returns. You may be asked to sign in again.
              </div>
            )}
            {activeRestore.job.error_message && (
              <div className="mt-4 rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">
                {activeRestore.job.error_message}
              </div>
            )}
            {activeRestore.job.phase === 'failed' && (
              <div className="mt-4 flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setActiveRestore(null);
                    setActiveRestoreSizeBytes(null);
                    setRestoreStatusUnavailable(false);
                  }}
                >
                  Close
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Restore from backup */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-fg-secondary" />
            <CardTitle>Restore from backup</CardTitle>
          </div>
          <Badge variant="danger">Admin only</Badge>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="-mx-5 rounded-lg border border-border bg-bg-elevated/20 p-5">
            <div>
              <p className="text-sm font-medium text-fg">Choose a recovery package</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-tertiary">
                Select a backup already in the local catalog or import a package from another Riviamigo installation. A safety backup is created before any restore begins.
              </p>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:items-end">
              <label className="grid min-w-0 gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Local backup</span>
                <SelectPicker
                  value={restoreArtifactId}
                  onChange={setRestoreArtifactId}
                  aria-label="Choose a recovery package"
                  placeholder="Choose a backup"
                  disabled={restoreArtifactOptions.length === 0}
                  options={restoreArtifactOptions}
                  className="w-full"
                />
              </label>

              <div className="flex w-full items-end">
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".rma.tar.gz,application/gzip,application/octet-stream"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadArtifact.mutate(file);
                    event.target.value = '';
                  }}
                />
                <Button
                  variant="secondary"
                  size="md"
                  className="w-full"
                  iconLeft={<Upload className="h-3.5 w-3.5" />}
                  loading={uploadArtifact.isPending}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  Import recovery package
                </Button>
              </div>
            </div>

            {uploadArtifact.isPending && (
              <div aria-label="Backup upload progress" className="mt-3 rounded-lg border border-border bg-bg-elevated/30 p-3">
                <div className="flex items-center justify-between gap-3 text-xs text-fg-secondary">
                  <span>{uploadProgress === 100 ? 'Validating recovery package…' : 'Uploading recovery package…'}</span>
                  <span className="tabular-nums">{uploadProgress ?? 0}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg-elevated">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${uploadProgress ?? 0}%` }} />
                </div>
              </div>
            )}

            {restoreArtifact ? (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Selected backup</p>
                  <p className="mt-1 truncate text-sm font-medium text-fg">{restoreArtifact.file_name}</p>
                  <p className="mt-0.5 text-xs text-fg-tertiary">
                    {new Date(restoreArtifact.created_at).toLocaleString()} · {storageLabel(restoreArtifact.storage_type, restoreArtifact.manifest)} package
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!overview.data.runtime_readiness.restore_automation_available}
                  onClick={() => setPendingRestoreArtifact(restoreArtifact)}
                >
                  Restore selected backup
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-fg-tertiary">No recovery packages are available yet.</p>
            )}

            {!overview.data.runtime_readiness.restore_automation_available && (
              <p className="mt-3 text-xs text-status-warning">
                Automated restore is unavailable{restoreAutomationReason ? `: ${restoreAutomationReason}` : ' in this runtime.'}
              </p>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-fg">Request history</p>
                <p className="mt-0.5 text-xs text-fg-tertiary">Previous restore attempts and their current status.</p>
              </div>
            </div>
            {overview.data.restore_requests.length === 0 ? (
              <p className="mt-3 text-sm text-fg-tertiary">No restore requests have been recorded yet.</p>
            ) : (
              <div className="mt-2 divide-y divide-border">
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
