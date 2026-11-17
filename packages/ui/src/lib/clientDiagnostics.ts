/**
 * Browser logging mirrors the server ladder in docs/architecture/logging.md:
 * error, warn, info (lifecycle), debug (decisions), trace (per-message detail).
 * The default threshold is `info`. Raise it in the console with
 * `localStorage.setItem('rm-log-level', 'debug')` and reload, or at runtime with
 * `riviamigoLog.setLevel('trace')`.
 */
export type ClientLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export type ClientLogFieldValue = string | number | boolean | null | undefined;
export type ClientLogFields = Record<string, ClientLogFieldValue>;

export type ClientErrorSeverity = 'warn' | 'error';

const LEVEL_RANK: Record<ClientLogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 };
const LEVEL_STORAGE_KEY = 'rm-log-level';
const DEFAULT_LEVEL: ClientLogLevel = 'info';
// Never logged at any level, mirroring the server's "never log" list.
const SENSITIVE_FIELD = /^(password|passwd|secret|token|access_token|refresh_token|api_key|apikey|cookie|authorization|email|vin|lat|lon|lng|latitude|longitude|address)$/i;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Kept whole so a browser line can be matched to the server log line.
const CORRELATION_FIELDS = new Set(['request_id']);

let levelOverride: ClientLogLevel | undefined;

function isLevel(value: unknown): value is ClientLogLevel {
  return typeof value === 'string' && value in LEVEL_RANK;
}

/** The active threshold: runtime override, then the saved choice, then `info`. */
export function getClientLogLevel(): ClientLogLevel {
  if (levelOverride) return levelOverride;
  try {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(LEVEL_STORAGE_KEY);
    if (isLevel(saved)) return saved;
  } catch {
    // Storage can be blocked; the default applies.
  }
  return DEFAULT_LEVEL;
}

export function setClientLogLevel(level: ClientLogLevel | undefined, persist = false): void {
  levelOverride = level;
  if (!persist) return;
  try {
    if (level) localStorage.setItem(LEVEL_STORAGE_KEY, level);
    else localStorage.removeItem(LEVEL_STORAGE_KEY);
  } catch {
    // Persistence is a convenience only.
  }
}

export function isClientLogEnabled(level: ClientLogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[getClientLogLevel()];
}

function formatFieldValue(key: string, value: Exclude<ClientLogFieldValue, undefined>): string {
  if (typeof value === 'string') {
    const text = CORRELATION_FIELDS.has(key) || !UUID_VALUE.test(value) ? sanitizeText(value) : `${value.slice(0, 8)}…`;
    return /[\s="]/.test(text) ? JSON.stringify(text) : text;
  }
  return String(value);
}

function formatFields(fields: ClientLogFields | undefined): string {
  if (!fields) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || SENSITIVE_FIELD.test(key)) continue;
    parts.push(`${key}=${value === null ? 'null' : formatFieldValue(key, value)}`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** `[riviamigo][LEVEL] area: message key=value`, the browser twin of the server line. */
function formatLine(level: ClientLogLevel, area: string, message: string, fields?: ClientLogFields): string {
  return `[riviamigo][${level.toUpperCase()}] ${area}: ${message}${formatFields(fields)}`;
}

function write(level: ClientLogLevel, line: string, detail?: unknown): void {
  const args = detail === undefined ? [line] : [line, detail];
  switch (level) {
    case 'error': console.error(...args); break;
    case 'warn': console.warn(...args); break;
    case 'info': console.info(...args); break;
    default: console.debug(...args);
  }
}

function emit(level: ClientLogLevel, area: string, message: string, fields?: ClientLogFields): void {
  if (!isClientLogEnabled(level)) return;
  write(level, formatLine(level, area, message, fields));
}

/**
 * Leveled browser logger. `area` names the subsystem (`auth`, `api`, `live`,
 * `route`, `query`, `map`), `message` is a short lowercase event, and values go
 * in `fields` using the server's names (`vehicle_id`, `status`, `latency_ms`,
 * `reason`, `error`). Passwords, tokens, emails, VINs and coordinates are
 * dropped by field name; UUIDs other than `request_id` are shortened.
 */
export const clientLog = {
  trace: (area: string, message: string, fields?: ClientLogFields) => emit('trace', area, message, fields),
  debug: (area: string, message: string, fields?: ClientLogFields) => emit('debug', area, message, fields),
  info: (area: string, message: string, fields?: ClientLogFields) => emit('info', area, message, fields),
  warn: (area: string, message: string, fields?: ClientLogFields) => emit('warn', area, message, fields),
  error: (area: string, message: string, fields?: ClientLogFields) => emit('error', area, message, fields),
};

if (typeof window !== 'undefined') {
  (window as unknown as { riviamigoLog?: unknown }).riviamigoLog = {
    level: getClientLogLevel,
    setLevel: (level: ClientLogLevel | undefined) => setClientLogLevel(level, true),
  };
}

export interface ClientErrorContext {
  event: string;
  area: string;
  operation: string;
  method?: string | undefined;
  path?: string | undefined;
  status?: number | undefined;
  code?: string | undefined;
  provider?: string | undefined;
  style?: string | undefined;
  resourceKind?: string | undefined;
  sourceId?: string | undefined;
  requestId?: string | undefined;
  url?: string | undefined;
  severity?: ClientErrorSeverity;
}

interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

const REPORT_DEDUPE_WINDOW_MS = 5_000;
const MAX_TEXT_LENGTH = 240;
const reportedErrors = new WeakSet<object>();
const recentReports = new Map<string, number>();

/** Returns true for fetch/request cancellations that are expected control flow. */
export function isAbortError(error: unknown): boolean {
  const isDomAbort = typeof DOMException !== 'undefined'
    && error instanceof DOMException
    && error.name === 'AbortError';
  return isDomAbort || (isRecord(error) && error.name === 'AbortError');
}

/**
 * Emit a safe, structured browser diagnostic. This intentionally only writes
 * to the local console; user-facing error state and toasts remain owned by
 * the feature that can explain the failure to the user.
 */
export function reportClientError(
  error: unknown,
  context: ClientErrorContext,
): void {
  if (isAbortError(error)) return;

  const normalized = normalizeError(error);
  if (isRecord(error) && reportedErrors.has(error)) return;

  const record = {
    event: context.event,
    area: context.area,
    operation: context.operation,
    method: context.method,
    path: sanitizePath(context.path),
    status: finiteNumber(context.status),
    code: sanitizeToken(context.code),
    provider: sanitizeToken(context.provider),
    style: sanitizeToken(context.style),
    resourceKind: sanitizeToken(context.resourceKind),
    sourceId: sanitizeToken(context.sourceId),
    requestId: sanitizeToken(context.requestId),
    url: sanitizePath(context.url),
    error: normalized,
  };
  const dedupeKey = JSON.stringify(record);
  const now = Date.now();
  pruneRecentReports(now);
  if (recentReports.has(dedupeKey)) return;

  if (isRecord(error)) reportedErrors.add(error);
  recentReports.set(dedupeKey, now);

  const severity = context.severity ?? defaultSeverity(context.area);
  if (!isClientLogEnabled(severity)) return;
  const summary = `[riviamigo][${severity.toUpperCase()}] ${record.area}: ${record.event} error=${JSON.stringify(`${record.error.name}: ${record.error.message}`)}`;
  write(severity, summary, record);
}

/** Install global browser diagnostics and return a cleanup function for tests. */
export function installGlobalClientErrorHandlers(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handleError = (event: ErrorEvent | Event) => {
    if (event instanceof ErrorEvent || 'error' in event) {
      const errorEvent = event as ErrorEvent;
      reportClientError(errorEvent.error ?? errorEvent.message, {
        event: 'browser.error',
        area: 'browser',
        operation: 'window.error',
        url: errorEvent.filename,
        severity: 'error',
      });
      event.preventDefault();
      return;
    }

    const target = event.target as (Element & { src?: string; href?: string }) | null;
    reportClientError(new Error('Browser resource failed to load'), {
      event: 'browser.resource_load_failed',
      area: 'asset',
      operation: target?.tagName?.toLowerCase() ?? 'unknown-resource',
      url: target?.getAttribute?.('src') ?? target?.getAttribute?.('href') ?? undefined,
      severity: 'error',
    });
    event.preventDefault();
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportClientError(event.reason, {
      event: 'browser.unhandled_rejection',
      area: 'browser',
      operation: 'window.unhandledrejection',
      severity: 'error',
    });
    event.preventDefault();
  };

  const handleCspViolation = (event: SecurityPolicyViolationEvent) => {
    reportClientError(new Error(`Blocked ${event.violatedDirective}`), {
      event: 'browser.csp_violation',
      area: 'browser',
      operation: event.violatedDirective,
      url: event.blockedURI,
      severity: 'error',
    });
    event.preventDefault();
  };

  window.addEventListener('error', handleError, true);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  window.addEventListener('securitypolicyviolation', handleCspViolation);

  return () => {
    window.removeEventListener('error', handleError, true);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    window.removeEventListener('securitypolicyviolation', handleCspViolation);
  };
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return {
      name: sanitizeToken(error.name) ?? 'Error',
      message: sanitizeText(error.message) || 'Unknown error',
      ...(error.stack ? { stack: sanitizeText(error.stack) } : {}),
    };
  }

  if (typeof error === 'string') {
    return { name: 'Error', message: sanitizeText(error) || 'Unknown error' };
  }

  if (isRecord(error)) {
    const message = typeof error.message === 'string' ? error.message : undefined;
    const name = typeof error.name === 'string' ? error.name : undefined;
    if (message || name) {
      return {
        name: sanitizeToken(name) ?? 'Error',
        message: sanitizeText(message) || 'Unknown error',
      };
    }
  }

  return { name: 'UnknownError', message: 'Unknown error' };
}

function defaultSeverity(area: string): ClientErrorSeverity {
  return area === 'api' || area === 'query' || area === 'mutation' ? 'warn' : 'error';
}

function pruneRecentReports(now: number) {
  for (const [key, timestamp] of recentReports) {
    if (now - timestamp >= REPORT_DEDUPE_WINDOW_MS) recentReports.delete(key);
  }
}

/** A URL path safe to log: no query string, ids, or map tile coordinates. */
export function redactPath(value: string | undefined): string | undefined {
  return sanitizePath(value);
}

function sanitizePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let path: string;
  try {
    path = new URL(value, 'http://localhost').pathname;
  } catch {
    path = value.split(/[?#]/, 1)[0] ?? value;
  }
  return path
    .replace(/\/v[0-9]+\/external\/basemap\/openfreemap\/planet\/[^/]+\/[^/]+\/[^/]+\/[^/]+\.pbf$/i, '/v1/external/basemap/openfreemap/planet/<tile>.pbf')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/<id>')
    .replace(/\/[0-9]+\/[0-9]+\/[0-9]+\.(pbf|png)$/i, '/<tile>.$1')
    .slice(0, MAX_TEXT_LENGTH);
}

function sanitizeToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return sanitizeText(value).replace(/^Bearer\s+.+$/i, 'Bearer <redacted>');
}

function sanitizeText(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer <redacted>')
    .replace(/https?:\/\/[^\s)]+/gi, (url) => sanitizePath(url) ?? '<url>')
    .slice(0, MAX_TEXT_LENGTH);
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
