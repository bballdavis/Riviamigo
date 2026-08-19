import { formatPressure } from './utils';

export const DEFAULT_TARGET_TIRE_PRESSURE_PSI = 48;

type TireHealthTone = 'neutral' | 'success' | 'warning' | 'danger';
export type TireWheel = {
  position: 'fl' | 'fr' | 'rl' | 'rr';
  label: string;
  psi: number | null;
  status: string | null;
  valid: boolean | null;
};
export type TireHealthLegendEntry = {
  tone: Exclude<TireHealthTone, 'neutral'>;
  label: string;
  rangeLabel: string;
  detail: string;
};

type TireValues = Partial<Record<
  | 'tire_fl_psi'
  | 'tire_fr_psi'
  | 'tire_rl_psi'
  | 'tire_rr_psi'
  | 'tire_fl_status'
  | 'tire_fr_status'
  | 'tire_rl_status'
  | 'tire_rr_status'
  | 'tire_fl_valid'
  | 'tire_fr_valid'
  | 'tire_rl_valid'
  | 'tire_rr_valid',
  number | string | boolean | null | undefined
>>;

const TIRE_WHEEL_DEFINITIONS = [
  ['fl', 'Front Left'],
  ['fr', 'Front Right'],
  ['rl', 'Rear Left'],
  ['rr', 'Rear Right'],
] as const;

export function normalizeTireWheels(
  status: TireValues | null | undefined,
  tires: TireValues | null | undefined
): TireWheel[] {
  return TIRE_WHEEL_DEFINITIONS.map(([position, label]) => ({
    position,
    label,
    psi: (status?.[`tire_${position}_psi`] ?? tires?.[`tire_${position}_psi`] ?? null) as number | null,
    status: (status?.[`tire_${position}_status`] ?? tires?.[`tire_${position}_status`] ?? null) as string | null,
    valid: (status?.[`tire_${position}_valid`] ?? null) as boolean | null,
  }));
}

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
  if (psi === null || psi === undefined) {
    if (/(low|high|warn|critical|fault)/i.test(normalizedStatus)) return 'warning';
    return 'neutral';
  }

  const resolvedTarget = Math.round(targetPsi ?? DEFAULT_TARGET_TIRE_PRESSURE_PSI);
  const displayPsi = Math.round(psi);
  const delta = resolvedTarget - displayPsi;
  if (delta <= 2) return 'success';
  if (delta <= 5) return 'warning';
  return 'danger';
}

export function summarizeTireHealth(
  wheels: TireWheel[],
  targetPsi?: number | null | undefined
) {
  const tones = wheels.map((wheel) =>
    getTireHealthTone({ psi: wheel.psi, status: wheel.status, targetPsi })
  );
  return {
    tones,
    hasInvalidSensor: wheels.some((wheel) => wheel.valid === false),
    readings: wheels.filter((wheel) => typeof wheel.psi === 'number').map((wheel) => wheel.psi as number),
    tone: tones.includes('danger')
      ? ('danger' as const)
      : tones.includes('warning')
        ? ('warning' as const)
        : tones.includes('success')
          ? ('success' as const)
          : ('neutral' as const),
  };
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
