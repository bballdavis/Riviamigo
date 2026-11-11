import type {
  BackupFrequency,
  BackupOverview,
  BackupTargetType,
  UpdateBackupSettingsBody,
} from '@riviamigo/types';

/** Staged backup schedule and storage fields, as edited in the Settings page. */
export interface BackupDraft {
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

export function buildDraft(overview: BackupOverview): BackupDraft {
  const s = overview.settings;
  return {
    enabled: s.enabled,
    frequency: s.frequency,
    run_at: s.run_at,
    timezone: s.timezone || 'UTC',
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

export function buildPayload(
  draft: BackupDraft,
  secretKey: string,
  clearSecretKey: boolean
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
    region: draft.s3_enabled ? draft.region.trim() || null : null,
    bucket: draft.s3_enabled ? draft.bucket.trim() : '',
    prefix: draft.s3_enabled ? draft.prefix.trim() : '',
    access_key: draft.s3_enabled ? draft.access_key.trim() || null : null,
    ...(secretKey.trim() ? { secret_key: secretKey.trim() } : {}),
    ...(clearSecretKey ? { clear_secret_key: true } : {}),
  };
}

/** Save-time checks for the staged schedule and storage fields. */
export function backupValidationError(draft: BackupDraft, hasSavedSecret: boolean, secretKey: string) {
  if (draft.run_at.trim().length !== 5) return 'Run time must be a time such as 03:00.';
  if (!draft.timezone.trim()) return 'Time zone is required.';
  if (!(Number.parseInt(draft.retention_count, 10) >= 1)) return 'Retention must be a whole number greater than zero.';
  if (!draft.local_enabled && !draft.s3_enabled) return 'Enable local backup, S3 backup, or both.';
  if (!draft.s3_enabled) return null;
  if (!draft.bucket.trim()) return 'S3 bucket is required.';
  if (!draft.access_key.trim()) return 'S3 access key is required.';
  return hasSavedSecret || secretKey.trim() ? null : 'S3 secret key is required.';
}
