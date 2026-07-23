import React, { useEffect, useRef, useState } from 'react';
import type { VehicleImages, VehicleStatus } from '@riviamigo/types';
import { formatDriveMode } from '@riviamigo/ui/lib/driveMode';
import { formatMiles as formatDistance, formatMph, formatTemp as formatTemperature, formatAltitude } from '@riviamigo/ui/lib/utils';
import { formatTireLabel, getTireHealthLegend, getTireHealthTone, tireHealthBorderClass } from '@riviamigo/ui/lib/vehicleTires';
import { Tooltip } from '@riviamigo/ui/primitives';
import { Battery, Car, CheckCircle2, CircleAlert, Cpu, Gauge, MapPin, Thermometer, TriangleAlert } from 'lucide-react';
import { BsLockFill, BsUnlockFill } from 'react-icons/bs';
import { PiPlugsConnectedFill, PiPlugsFill } from 'react-icons/pi';
import { DashboardPageShell } from './DashboardPageShell';
import { formatAppTime } from '@riviamigo/ui/lib/dateTime';

export { canManageSystemDashboards, createDefaultDashboardEditActions } from './DashboardPageShell';
export type { DashboardEditMutations, DashboardPageShellRenderState } from './DashboardPageShell';

export interface DashboardPageProps {
  /** Sidebar nav key (e.g. "dashboard", "battery"). */
  navKey: string;
  /** Dashboard slug to resolve. */
  slug: string;
  /** Override the page title shown in PageLayout. */
  title?: string | undefined;
  /** Show the page-level efficiency unit toggle next to the date range picker. */
  showEfficiencyDisplayToggle?: boolean | undefined;
}

export function DashboardPage({ navKey, slug, title, showEfficiencyDisplayToggle = false }: DashboardPageProps) {
  return (
    <DashboardPageShell
      navKey={navKey}
      slug={slug}
      title={title}
      showEfficiencyDisplayToggle={showEfficiencyDisplayToggle}
    />
  );
}

export function CurrentVehicleStatePanel({
  status,
  images,
  vehicleName,
  targetTirePressurePsi,
}: {
  status: VehicleStatus | null | undefined;
  images?: VehicleImages | null | undefined;
  vehicleName?: string | undefined;
  targetTirePressurePsi?: number | null | undefined;
}) {
  const batteryLevel = clamp(status?.battery_level ?? 0, 0, 100);
  const baseOverheadLight = images?.overhead?.light ?? findFirstOverheadImage(images?.all, 'light');
  const baseOverheadDark = images?.overhead?.dark ?? findFirstOverheadImage(images?.all, 'dark');
  const baseOverheadFallback = baseOverheadLight ?? baseOverheadDark ?? findFirstOverheadImage(images?.all);
  const openDoorStates = getOpenDoorStates(status);
  const overlaysLight = getDoorOverlayUrls(images?.all, openDoorStates, 'light');
  const overlaysDark = getDoorOverlayUrls(images?.all, openDoorStates, 'dark');
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const [imageStageHeight, setImageStageHeight] = useState(0);
  const [imageStageWidth, setImageStageWidth] = useState(0);
  const locksKnown = [status?.door_front_left_locked, status?.door_front_right_locked, status?.door_rear_left_locked, status?.door_rear_right_locked]
    .some((value) => value !== null && value !== undefined);
  const tires = {
    fl: makeTireDisplay(status?.tire_fl_psi, status?.tire_fl_status, targetTirePressurePsi),
    fr: makeTireDisplay(status?.tire_fr_psi, status?.tire_fr_status, targetTirePressurePsi),
    rl: makeTireDisplay(status?.tire_rl_psi, status?.tire_rl_status, targetTirePressurePsi),
    rr: makeTireDisplay(status?.tire_rr_psi, status?.tire_rr_status, targetTirePressurePsi),
  };
  const stats = [
    { label: 'Driver mode', value: renderDriverMode(status?.drive_mode, status?.gear_status), icon: <Car className="h-3.5 w-3.5" /> },
    { label: 'Altitude', value: formatAltitude(status?.altitude_m), icon: <MapPin className="h-3.5 w-3.5" /> },
    { label: 'Cabin', value: formatTemperature(status?.cabin_temp_c), icon: <Thermometer className="h-3.5 w-3.5" /> },
    { label: 'Speed', value: formatMph(status?.speed_mph), icon: <Gauge className="h-3.5 w-3.5" /> },
    { label: 'Software', value: formatSoftware(status), icon: <Cpu className="h-3.5 w-3.5" /> },
  ];

  useEffect(() => {
    const element = imageStageRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const update = () => {
      const bounds = element.getBoundingClientRect();
      setImageStageHeight(bounds.height);
      setImageStageWidth(bounds.width);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const freshnessLabel = status?.telemetry_stale
    ? 'Telemetry stale'
    : status?.last_updated
      ? `Updated ${formatAppTime(status.last_updated)}`
      : 'Awaiting telemetry';

  return (
    <section
      className="mb-4 overflow-hidden rounded-2xl border border-border p-4 shadow-sm"
      style={{ background: 'radial-gradient(circle at 20% 20%, color-mix(in oklab, var(--rm-accent) 16%, transparent) 32%, transparent), linear-gradient(135deg, var(--rm-bg-surface), var(--rm-bg-elevated))' }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-tertiary">Vehicle overview</p>
        </div>
        <span className="rounded-full border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-tertiary">
          {freshnessLabel}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[16rem_minmax(22rem,1fr)_18rem]">
        <div className="grid min-h-60 grid-cols-[3.75rem_minmax(0,1fr)] gap-4 rounded-2xl border border-accent/25 bg-accent/10 p-4">
          <div className="relative h-full min-h-48 overflow-hidden rounded-2xl border border-accent/40 bg-bg-surface">
            <div
              className="absolute inset-x-1 bottom-1 rounded-xl transition-all"
              style={{
                height: `${batteryLevel}%`,
                background: `linear-gradient(to top, var(--rm-accent) 0%, color-mix(in oklab, var(--rm-accent) ${100 - batteryLevel}%, var(--rm-status-positive) ${batteryLevel}%) 100%)`,
              }}
            />
            <Battery className="absolute left-1/2 top-3 h-4 w-4 -translate-x-1/2 text-fg/80" />
          </div>
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <div>
              <span className="text-xs uppercase tracking-[0.16em] text-fg-tertiary">SoC</span>
              <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-fg">{formatPercent(status?.battery_level)}</p>
            </div>
            <div className="grid gap-2 text-xs">
              <SocDatum label="Range" value={formatDistance(status?.range_miles)} />
              <SocDatum label="Limit" value={formatPercent(status?.battery_limit)} />
              <SocDatum
                label="Charging"
                value={
                  <ChargingGlyph
                    chargerState={status?.charger_state}
                    chargerStatus={status?.charger_status}
                  />
                }
              />
              <SocDatum label="Capacity" value={formatKwh(status?.battery_capacity_kwh)} />
            </div>
          </div>
        </div>

        <div ref={imageStageRef} className="relative min-h-60 overflow-hidden rounded-2xl border border-border bg-bg-surface/70 p-1">
          <div className="absolute right-3 top-3 z-30 inline-flex items-center gap-1 rounded-full border border-border bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg-tertiary shadow-sm backdrop-blur">
            {status?.doors_locked ? <BsLockFill className="h-3 w-3 text-status-positive" /> : <BsUnlockFill className="h-3 w-3 text-accent" />}
            {locksKnown ? (status?.doors_locked ? 'Locked' : 'Unlocked') : 'Locks pending'}
          </div>

          <div className="absolute inset-1 z-10 flex items-center justify-center">
            {baseOverheadFallback ? (
              <VehicleArtFrame
                source={baseOverheadFallback}
                heightPx={imageStageHeight}
                widthPx={imageStageWidth}
              >
                <VehicleOverheadLayers
                  base={baseOverheadLight ?? baseOverheadFallback}
                  overlays={overlaysLight}
                  darkClassName="dark:hidden"
                  vehicleName={vehicleName}
                />
                <VehicleOverheadLayers
                  base={baseOverheadDark ?? baseOverheadFallback}
                  overlays={overlaysDark}
                  darkClassName="hidden dark:block"
                />
                <VehicleLabel className="left-[27%] top-[0%]" value={tires.rl.value} tone={tires.rl.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <VehicleLabel className="left-[82%] top-[0%]" value={tires.fl.value} tone={tires.fl.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <VehicleLabel className="left-[27%] top-[102%]" value={tires.rr.value} tone={tires.rr.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <VehicleLabel className="left-[82%] top-[102%]" value={tires.fr.value} tone={tires.fr.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <LockLabel className="left-[43%] top-[-0%]" locked={status?.door_rear_left_locked} />
                <LockLabel className="left-[60%] top-[-0%]" locked={status?.door_front_left_locked} />
                <LockLabel className="left-[43%] top-[102%]" locked={status?.door_rear_right_locked} />
                <LockLabel className="left-[60%] top-[102%]" locked={status?.door_front_right_locked} />
                <LockLabel className="left-[4%] top-1/2" locked={status?.closure_liftgate_locked ?? status?.closure_tailgate_locked} title="Rear gate lock" />
                <LockLabel className="left-[102%] top-1/2" locked={status?.closure_frunk_locked} title="Frunk lock" />
              </VehicleArtFrame>
            ) : (
              <div className="flex h-28 w-64 items-center justify-center rounded-[2rem] border border-dashed border-border bg-bg-elevated text-fg-tertiary">
                <Car className="h-10 w-10" />
              </div>
            )}
          </div>
        </div>

        <div className="md:col-span-2 xl:col-span-1 grid gap-2 md:grid-cols-2 xl:grid-cols-1">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/70 px-3 py-2 text-xs">
              <span className="inline-flex items-center gap-2 text-fg-tertiary">{stat.icon}{stat.label}</span>
              <span className="font-mono font-medium tabular-nums text-fg">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SocDatum({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-accent/15 bg-bg-surface/55 px-2.5 py-1.5">
      {label ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-fg-tertiary">
          {icon}
          {label}
        </span>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-fg-tertiary">
          {icon}
        </span>
      )}
      <span className="min-w-0 truncate font-mono font-medium tabular-nums text-fg">{value}</span>
    </div>
  );
}

function ChargingGlyph({ chargerState, chargerStatus }: { chargerState: string | null | undefined; chargerStatus: string | null | undefined }) {
  const charging = chargerState && !['unknown', 'disconnected'].includes(chargerState.toLowerCase())
    && chargerStatus !== 'chrgr_sts_not_connected';

  return (
    <span
      aria-label={charging ? 'Charging' : 'Not charging'}
      title={charging ? 'Charging' : 'Not charging'}
      className={`inline-flex items-center justify-end ${charging ? 'text-accent' : 'text-fg-tertiary'}`}
    >
      {charging ? <PiPlugsConnectedFill className="h-5 w-5" /> : <PiPlugsFill className="h-5 w-5" />}
    </span>
  );
}

function VehicleLabel({
  className,
  value,
  tone,
  targetTirePressurePsi,
}: {
  className: string;
  value: string;
  tone: ReturnType<typeof getTireHealthTone>;
  targetTirePressurePsi?: number | null | undefined;
}) {
  return (
    <Tooltip
      className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 ${className}`}
      content={<TireHealthTooltipContent targetTirePressurePsi={targetTirePressurePsi} />}
      contentClassName="w-64 rounded-xl border-border/80 bg-bg-elevated/95 px-3 py-3 text-xs shadow-2xl backdrop-blur"
    >
      <span className={`rounded-lg border bg-bg-elevated/90 px-2 py-1 font-mono text-[11px] text-fg shadow-sm backdrop-blur ${tireHealthBorderClass(tone)}`}>{value}</span>
    </Tooltip>
  );
}

function LockLabel({ className, locked, title }: { className: string; locked: boolean | null | undefined; title?: string }) {
  const known = locked !== null && locked !== undefined;
  const unlocked = known && locked === false;
  const Icon = unlocked ? BsUnlockFill : BsLockFill;
  return (
    <span
      title={title}
      className={`absolute z-30 inline-flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm backdrop-blur ${unlocked ? 'border-accent/60 bg-bg-elevated/90 text-accent' : known ? 'border-status-positive/60 bg-bg-elevated/90 text-status-positive' : 'border-border bg-bg-elevated/60 text-fg-tertiary'} ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function VehicleArtFrame({
  source,
  heightPx,
  widthPx,
  children,
}: {
  source: string;
  heightPx: number;
  widthPx: number;
  children: React.ReactNode;
}) {
  const [rotatedAspectRatio, setRotatedAspectRatio] = useState(2.25);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setRotatedAspectRatio(image.naturalHeight / image.naturalWidth);
      }
    };
    image.src = source;
  }, [source]);

  const sensorVerticalScale = 1.12;
  const sensorHorizontalScale = 1.04;
  const sensorGutterPx = 34;
  const maxHeight = heightPx > 0 ? Math.max(120, (heightPx - sensorGutterPx) / sensorVerticalScale) : 216;
  const maxWidth = widthPx > 0 ? Math.max(260, (widthPx - sensorGutterPx) / sensorHorizontalScale) : 520;
  const frameHeight = Math.round(Math.min(maxHeight, maxWidth / rotatedAspectRatio));
  const frameWidth = Math.round(frameHeight * rotatedAspectRatio);
  const frameStyle = {
    height: `${frameHeight}px`,
    width: `${frameWidth}px`,
    transform: 'translateX(-5%)',
    '--vehicle-frame-height': `${frameHeight}px`,
    '--vehicle-frame-width': `${frameWidth}px`,
  } as React.CSSProperties;

  return (
    <div className="relative" style={frameStyle}>
      {children}
    </div>
  );
}

function VehicleOverheadLayers({
  base,
  overlays,
  darkClassName,
  vehicleName,
}: {
  base: string;
  overlays: string[];
  darkClassName: string;
  vehicleName?: string | undefined;
}) {
  const imageStyle = {
    height: 'var(--vehicle-frame-width)',
    width: 'var(--vehicle-frame-height)',
    transform: 'translate(-50%, -50%) rotate(90deg)',
  } as React.CSSProperties;

  return (
    <div className={`absolute inset-0 ${darkClassName}`}>
      <img
        src={base}
        alt={vehicleName ?? 'Rivian vehicle'}
        className="absolute left-1/2 top-1/2 max-w-none object-contain object-center"
        style={imageStyle}
      />
      {overlays.map((overlayUrl) => (
        <img
          key={overlayUrl}
          src={overlayUrl}
          alt=""
          className="absolute left-1/2 top-1/2 max-w-none object-contain object-center"
          style={imageStyle}
        />
      ))}
    </div>
  );
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value)}%`;
}

function formatKwh(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value)} kWh`;
}

function formatDrive(driveMode: string | null | undefined, gearStatus: string | null | undefined) {
  if (driveMode) return driveMode;
  return gearStatus ? prettify(gearStatus) : '-';
}

function renderDriverMode(driveMode: string | null | undefined, gearStatus: string | null | undefined) {
  if (driveMode) {
    return formatDriveMode(driveMode);
  }
  return formatDrive(driveMode, gearStatus);
}

function formatSoftware(status: VehicleStatus | null | undefined) {
  const otaStatus = status?.ota_status ?? status?.software_update_status ?? status?.ota_current_status;
  const available = status?.ota_available_version;
  const current = status?.ota_current_version;
  if (!otaStatus && !available && !current) return '-';
  if (!available || available === '0.0.0' || available === current) return 'Up to date';
  if (otaStatus && !['idle', 'unknown'].includes(otaStatus.toLowerCase())) return prettify(otaStatus);
  return `Available ${available}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function prettify(value: string | null | undefined) {
  if (!value) return '-';
  return value.replace(/^chrgr_sts_/, '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function makeTireDisplay(psi: number | null | undefined, status: string | null | undefined, targetTirePressurePsi?: number | null) {
  return {
    value: formatTireLabel(psi, status),
    tone: getTireHealthTone({ psi, status, targetPsi: targetTirePressurePsi }),
  };
}

function TireHealthTooltipContent({ targetTirePressurePsi }: { targetTirePressurePsi?: number | null | undefined }) {
  const entries = getTireHealthLegend(targetTirePressurePsi);
  return (
    <div className="grid gap-2">
      <div className="grid gap-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-tertiary">Tire Pressure Health</p>
        <p className="text-sm font-medium text-fg">Target: {targetTirePressurePsi ?? 48} psi</p>
      </div>
      {entries.map((entry) => (
        <div key={entry.tone} className="flex items-start gap-2 rounded-lg border border-border/70 bg-bg-surface/65 px-2.5 py-2">
          <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
            entry.tone === 'success'
              ? 'bg-status-positive/12 text-status-positive'
              : entry.tone === 'warning'
                ? 'bg-status-warning/12 text-status-warning'
                : 'bg-status-danger/12 text-status-danger'
          }`}>
            {entry.tone === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : entry.tone === 'warning' ? <TriangleAlert className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-fg">{entry.label}</span>
              <span className="font-mono text-[11px] text-fg-tertiary">{entry.rangeLabel}</span>
            </div>
            <p className="text-[11px] text-fg-secondary">{entry.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

type DoorKey = 'front_left' | 'front_right' | 'rear_left' | 'rear_right' | 'frunk' | 'rear_gate';

function getOpenDoorStates(status: VehicleStatus | null | undefined): DoorKey[] {
  const states: Array<{ key: DoorKey; open: boolean }> = [
    { key: 'front_left', open: status?.door_front_left_closed === false },
    { key: 'front_right', open: status?.door_front_right_closed === false },
    { key: 'rear_left', open: status?.door_rear_left_closed === false },
    { key: 'rear_right', open: status?.door_rear_right_closed === false },
    { key: 'frunk', open: status?.closure_frunk_closed === false },
    { key: 'rear_gate', open: status?.closure_liftgate_closed === false || status?.closure_tailgate_closed === false },
  ];
  return states.filter((state) => state.open).map((state) => state.key);
}

function getDoorOverlayUrls(
  images: VehicleImages['all'] | undefined,
  openDoors: DoorKey[],
  designPreference: 'light' | 'dark',
): string[] {
  if (!images || openDoors.length === 0) return [];

  const overheadImages = images.filter((image) => normalizePlacement(image.placement) === 'overhead');
  const urls = openDoors
    .map((door) => findBestDoorOverlay(overheadImages, door, designPreference))
    .filter((url): url is string => Boolean(url));

  return Array.from(new Set(urls));
}

function findBestDoorOverlay(
  images: VehicleImages['all'],
  door: DoorKey,
  designPreference: 'light' | 'dark',
): string | undefined {
  const tokenSets = doorImageTokenSets(door);
  for (const tokens of tokenSets) {
    const preferred = images.find((image) => designMatches(image.design, designPreference) && tokens.every((token) => imageText(image).includes(token)));
    if (preferred?.url) return preferred.url;
  }

  for (const tokens of tokenSets) {
    const fallback = images.find((image) => tokens.every((token) => imageText(image).includes(token)));
    if (fallback?.url) return fallback.url;
  }

  return undefined;
}

function doorImageTokenSets(door: DoorKey): string[][] {
  switch (door) {
    case 'front_left':
      return [['front', 'left', 'open']];
    case 'front_right':
      return [['front', 'right', 'open']];
    case 'rear_left':
      return [['rear', 'left', 'open']];
    case 'rear_right':
      return [['rear', 'right', 'open']];
    case 'frunk':
      return [['frunk', 'open']];
    case 'rear_gate':
      return [['tailgate', 'open'], ['liftgate', 'open'], ['hatch', 'open']];
    default:
      return [['open']];
  }
}

function findFirstOverheadImage(images: VehicleImages['all'] | undefined, design?: 'light' | 'dark'): string | undefined {
  if (!images) return undefined;
  if (design) {
    const preferred = images.find((image) => normalizePlacement(image.placement) === 'overhead' && designMatches(image.design, design));
    if (preferred?.url) return preferred.url;
  }
  const fallback = images.find((image) => normalizePlacement(image.placement) === 'overhead');
  return fallback?.url;
}

function normalizePlacement(value: string | null | undefined): 'side' | 'overhead' | 'front' | 'rear' | 'unknown' {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.includes('side')) return 'side';
  if (normalized.includes('overhead') || normalized.includes('top') || normalized.includes('bird')) return 'overhead';
  if (normalized.includes('front')) return 'front';
  if (normalized.includes('rear') || normalized.includes('back')) return 'rear';
  return 'unknown';
}

function designMatches(value: string | null | undefined, expected: 'light' | 'dark'): boolean {
  const normalized = (value ?? '').toLowerCase();
  return normalized.includes(expected);
}

function imageText(image: VehicleImages['all'][number]): string {
  return `${image.placement ?? ''} ${image.design ?? ''} ${JSON.stringify(image.metadata ?? {})}`.toLowerCase();
}
