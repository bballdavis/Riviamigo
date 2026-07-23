const DEFAULT_APP_TIMEZONE = 'UTC';
const APP_TIMEZONE_STORAGE_KEY = 'rm-app-timezone';
export const APP_TIMEZONE_CHANGE_EVENT = 'rm-app-timezone-change';

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

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function getAppTimezone(): string {
  if (typeof window === 'undefined') return DEFAULT_APP_TIMEZONE;
  try {
    const value = window.localStorage.getItem(APP_TIMEZONE_STORAGE_KEY);
    return value && isValidTimezone(value) ? value : DEFAULT_APP_TIMEZONE;
  } catch {
    return DEFAULT_APP_TIMEZONE;
  }
}

export function setAppTimezone(timezone: string): void {
  if (typeof window === 'undefined' || !isValidTimezone(timezone)) return;
  try {
    window.localStorage.setItem(APP_TIMEZONE_STORAGE_KEY, timezone);
    window.dispatchEvent(new Event(APP_TIMEZONE_CHANGE_EVENT));
  } catch {
    // Storage may be unavailable; callers still retain the server value.
  }
}

export function listAppTimezones(currentTimezone?: string): string[] {
  const supportedValuesOf = Intl.supportedValuesOf as ((key: string) => string[]) | undefined;
  const values = supportedValuesOf?.('timeZone') ?? FALLBACK_TIMEZONES;
  return Array.from(new Set([DEFAULT_APP_TIMEZONE, ...(currentTimezone ? [currentTimezone] : []), ...values]));
}

export function formatTimezoneOffset(timezone: string): string {
  try {
    const offset = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!offset || offset === 'GMT') return 'UTC+00:00';
    return `UTC${offset.replace(/^GMT/, '')}`;
  } catch {
    return 'UTC offset unavailable';
  }
}

export function appTimezoneOptions(currentTimezone?: string) {
  return listAppTimezones(currentTimezone).map((timezone) => ({
    value: timezone,
    label: `${timezone} (${formatTimezoneOffset(timezone)})`,
  }));
}

function asDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export interface AppDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getAppDateParts(value: Date | string | number): AppDateParts | null {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: getAppTimezone(),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  if (!values.year || !values.month || !values.day || values.hour === undefined) return null;
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  const year = values.year ?? 0;
  const month = values.month ?? 1;
  const day = values.day ?? 1;
  const hour = values.hour ?? 0;
  const minute = values.minute ?? 0;
  const second = values.second ?? 0;
  const asUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
  );
  return asUtc - date.getTime();
}

export function appDatePartsToDate(parts: AppDateParts): Date {
  const timezone = getAppTimezone();
  const wallTimestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let timestamp = wallTimestamp - getTimezoneOffsetMs(new Date(wallTimestamp), timezone);
  timestamp = wallTimestamp - getTimezoneOffsetMs(new Date(timestamp), timezone);
  return new Date(timestamp);
}

export function startOfAppDay(value: Date | string | number): Date {
  const parts = getAppDateParts(value);
  return parts ? appDatePartsToDate({ ...parts, hour: 0, minute: 0, second: 0 }) : new Date(NaN);
}

export function endOfAppDay(value: Date | string | number): Date {
  const start = startOfAppDay(value);
  if (Number.isNaN(start.getTime())) return start;
  const parts = getAppDateParts(start);
  if (!parts) return new Date(NaN);
  return new Date(appDatePartsToDate({ ...parts, day: parts.day + 1, hour: 0, minute: 0, second: 0 }).getTime() - 1);
}

export function shiftAppCalendarDays(value: Date | string | number, days: number): Date {
  const parts = getAppDateParts(value);
  if (!parts) return new Date(NaN);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return appDatePartsToDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  });
}

export function formatAppDateTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...options,
    timeZone: getAppTimezone(),
  }).format(date);
}

export function formatAppDate(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
    timeZone: getAppTimezone(),
  }).format(date);
}

export function formatAppTime(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...options,
    timeZone: getAppTimezone(),
  }).format(date);
}

export function formatAppCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 'Invalid date';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}
