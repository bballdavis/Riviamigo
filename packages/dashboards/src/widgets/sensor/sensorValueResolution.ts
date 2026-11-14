import {
  formatCurrency,
  formatDuration,
  formatEfficiency,
  formatKwh,
  formatMiles,
  formatMph,
  formatPressure,
  formatTemp,
} from '@riviamigo/ui/lib/utils';
import { resolveSafeExpression } from '../../charts/expressions';
import type { SensorDataSource } from './sensorDefinitions';

/**
 * Pure value resolution shared by the sensor chip and the vehicle overview
 * rows, so a sensor reads and formats identically wherever it is placed.
 */

/** The slice of a sensor's configuration that decides which number it shows. */
export interface SensorValueSpec {
  valuePath: string;
  fallbackValuePath: string;
  valueFormula: string;
}

export function buildSourceValues(
  dataSource: SensorDataSource,
  health: unknown,
  chargingSummary: unknown,
  efficiencySummary: unknown,
  status: unknown,
) {
  const charging = objectValues(chargingSummary);
  const primary =
    dataSource === 'batteryHealth'
      ? health
      : dataSource === 'chargingSummary'
        ? chargingSummary
        : dataSource === 'efficiencySummary'
          ? efficiencySummary
          : dataSource === 'vehicleStatus'
            ? status
            : {};

  return {
    ...objectValues(primary),
    ...(dataSource === 'chargingSummary'
      ? {
          away_kwh_including_unknown:
            (typeof charging.away_kwh === 'number' && Number.isFinite(charging.away_kwh)
              ? charging.away_kwh
              : 0) +
            (typeof charging.unknown_location_kwh === 'number' &&
            Number.isFinite(charging.unknown_location_kwh)
              ? charging.unknown_location_kwh
              : 0),
        }
      : {}),
    health,
    battery: health,
    charging: chargingSummary,
    efficiency: efficiencySummary,
    status,
  } as Record<string, unknown>;
}

export function objectValues(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function resolveConfiguredValue(spec: SensorValueSpec, values: Record<string, unknown>) {
  if (spec.valueFormula) return resolveFormula(spec.valueFormula, values);
  const value = resolveNumberPath(values, spec.valuePath);
  if (value != null) return value;
  return resolveNumberPath(values, spec.fallbackValuePath);
}

export function resolveTemplate(template: string, values: Record<string, unknown>) {
  if (!template) return '';
  let missingValue = false;
  const resolved = template.replace(
    /\[([^\]:]+)(?::([^\]]+))?\]/g,
    (_match, rawPath: string, rawFormat: string | undefined) => {
      const value = resolveNumberPath(values, rawPath.trim());
      if (value == null) {
        missingValue = true;
        return '';
      }
      return formatTemplateValue(value, rawFormat);
    },
  );
  return missingValue ? '' : resolved;
}

function formatTemplateValue(value: number, format: string | undefined) {
  if (!format) return formatMetricValue(value, undefined);
  if (format === 'int' || format === 'integer') return value.toFixed(0);
  return formatMetricValue(value, format);
}

export function resolveNumberPath(values: Record<string, unknown>, path: string) {
  if (!path) return null;
  const value = resolvePath(values, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolvePath(values: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(values, path)) return values[path];
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, values);
}

export function resolveFormula(formula: string, values: Record<string, unknown>) {
  return resolveSafeExpression(formula, values);
}

export function formatMetricValue(value: number | null | undefined, unit: string | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '-';
  if (unit === 'mi') return formatMiles(value);
  if (unit === 'kWh') return formatKwh(value);
  if (unit === 'USD') return formatCurrency(value);
  if (unit === 'Wh/mi') return formatEfficiency(value);
  if (unit === 'min') return formatDuration(value);
  if (unit === '%') return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  if (unit === 'psi') return formatPressure(value);
  if (unit === 'mph') return formatMph(value);
  if (unit === 'kW') return `${value.toFixed(1)} kW`;
  if (unit === 'C') return formatTemp(value);
  if (!unit && Number.isInteger(value)) return value.toFixed(0);
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}
