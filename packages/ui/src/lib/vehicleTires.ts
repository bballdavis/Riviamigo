import { formatPressure } from './utils';

export const DEFAULT_TARGET_TIRE_PRESSURE_PSI = 48;

type TireHealthTone = 'neutral' | 'success' | 'warning' | 'danger';
export type TireHealthLegendEntry = {
  tone: Exclude<TireHealthTone, 'neutral'>;
  label: string;
  rangeLabel: string;
  detail: string;
};

export function formatTireLabel(psi: number | null | undefined, status?: string | null | undefined) {
  if (psi !== null && psi !== undefined) return formatPressure(psi);
  return status ? prettifyTireStatus(status) : '-';
}

export function getTireHealthTone({
  psi,
  status,
  targetPsi,
}: {
  psi: number | null | undefined;
  status?: string | null | undefined;
  targetPsi?: number | null | undefined;
}): TireHealthTone {
  const normalizedStatus = status?.trim().toLowerCase() ?? '';
  if (normalizedStatus.includes('invalid_sensor')) return 'neutral';
  if (psi === null || psi === undefined) return 'neutral';

  const resolvedTarget = Math.round(targetPsi ?? DEFAULT_TARGET_TIRE_PRESSURE_PSI);
  const displayPsi = Math.round(psi);
  const delta = resolvedTarget - displayPsi;
  if (delta <= 2) return 'success';
  if (delta <= 5) return 'warning';
  return 'danger';
}

export function tireHealthBorderClass(tone: TireHealthTone) {
  if (tone === 'success') return 'border-status-positive/70';
  if (tone === 'warning') return 'border-status-warning/70';
  if (tone === 'danger') return 'border-status-danger/70';
  return 'border-border';
}

export function getTireHealthLegend(targetPsi?: number | null | undefined): TireHealthLegendEntry[] {
  const resolvedTarget = Math.round(targetPsi ?? DEFAULT_TARGET_TIRE_PRESSURE_PSI);
  return [
    {
      tone: 'success',
      label: 'Green',
      rangeLabel: `${Math.ceil(resolvedTarget - 2)}+ psi`,
      detail: 'Within 2 PSI of target or above it',
    },
    {
      tone: 'warning',
      label: 'Yellow',
      rangeLabel: `${Math.ceil(resolvedTarget - 5)}-${Math.ceil(resolvedTarget - 3)} psi`,
      detail: '3-5 PSI below target',
    },
    {
      tone: 'danger',
      label: 'Red',
      rangeLabel: `<=${Math.ceil(resolvedTarget - 6)} psi`,
      detail: '6+ PSI below target',
    },
  ];
}

function prettifyTireStatus(value: string | null | undefined) {
  if (!value) return '-';
  return value.replace(/^chrgr_sts_/, '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
