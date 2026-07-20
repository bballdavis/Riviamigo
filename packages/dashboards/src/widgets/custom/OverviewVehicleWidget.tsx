import React, { useEffect, useRef, useState } from 'react';
import { Battery, Car, CheckCircle2, CircleAlert, Cpu, Gauge, Lock, MapPin, Package, PackageOpen, Thermometer, TriangleAlert, Unlock } from 'lucide-react';
import { PiPlugsConnectedFill, PiPlugsFill } from 'react-icons/pi';
import { AuthenticatedVehicleArtwork, resolveVehicleArtwork, useAuth, useCurrentVehicleStatus, useVehicles, useVehicleArtwork } from '@riviamigo/hooks';
import { formatDriveMode } from '@riviamigo/ui/lib/driveMode';
import { formatAltitude, formatMiles, formatMph, formatTemp } from '@riviamigo/ui/lib/utils';
import { formatTireLabel, getTireHealthLegend, getTireHealthTone, tireHealthBorderClass } from '@riviamigo/ui/lib/vehicleTires';
import { Tooltip } from '@riviamigo/ui/primitives';
import type { VehicleImages, VehicleStatus } from '@riviamigo/types';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';
import { isVehiclePluggedIn } from '../../dashboardVisibility';
import { getDoorOverlayUrls, getOpenDoorStates } from './imageUtils';

type AnchorSet = {
  tire: { rl: string; fl: string; rr: string; fr: string };
  doorLocks: { rl: string; fl: string; rr: string; fr: string };
  frunkLock: string;
  rearGateLock: string;
  sideBinLeftCover?: string;
  sideBinRightCover?: string;
};

// The normalized R1T overview asset has a 446px visible cross-axis span versus
// 509px for R1S. Compensate only while the packaged R1T fallback is active.
const R1T_OVERVIEW_FALLBACK_CROSS_AXIS_SCALE = 509 / 446;

const SHARED_OVERVIEW_ANCHORS: AnchorSet = {
  tire: { rl: 'left-[27%] top-[0%]', fl: 'left-[82%] top-[0%]', rr: 'left-[27%] top-[102%]', fr: 'left-[82%] top-[102%]' },
  doorLocks: { rl: 'left-[43%] top-[-0%]', fl: 'left-[60%] top-[-0%]', rr: 'left-[43%] top-[102%]', fr: 'left-[60%] top-[102%]' },
  rearGateLock: 'left-[4%] top-1/2',
  frunkLock: 'left-[102%] top-1/2',
};

const OVERVIEW_ANCHORS: Record<string, AnchorSet> = {
  default: SHARED_OVERVIEW_ANCHORS,
  R1T: {
    ...SHARED_OVERVIEW_ANCHORS,
    sideBinLeftCover: 'left-[36%] top-[24%]',
    sideBinRightCover: 'left-[36%] top-[76%]',
  },
  R1S: SHARED_OVERVIEW_ANCHORS,
  R2S: SHARED_OVERVIEW_ANCHORS,
};

function OverviewVehicleWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { defaultVehicleId } = useAuth();
  const vehicleId = ctx.vehicleId ?? defaultVehicleId;
  const { data: status } = useCurrentVehicleStatus(vehicleId);
  const { data: vehicles } = useVehicles();
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === vehicleId);

  return (
    <CurrentVehicleStatePanel
      status={status}
      images={activeVehicle?.images}
      vehicleName={activeVehicle?.display_name}
      vehicleModel={activeVehicle?.model}
      isDemoVehicle={activeVehicle?.is_demo ?? activeVehicle?.rivian_vehicle_id?.startsWith('demo-') ?? false}
      targetTirePressurePsi={activeVehicle?.target_tire_pressure_psi}
    />
  );
}

function CurrentVehicleStatePanel({
  status,
  images,
  vehicleName,
  vehicleModel,
  isDemoVehicle,
  targetTirePressurePsi,
}: {
  status: VehicleStatus | null | undefined;
  images?: VehicleImages | null | undefined;
  vehicleName?: string | undefined;
  vehicleModel?: string | undefined;
  isDemoVehicle: boolean;
  targetTirePressurePsi?: number | null | undefined;
}) {
  const anchors = OVERVIEW_ANCHORS[vehicleModel ?? ''] ?? SHARED_OVERVIEW_ANCHORS;
  const batteryLevel = clamp(status?.battery_level ?? 0, 0, 100);
  const resolvedOverhead = resolveVehicleArtwork(images, vehicleModel, 'overview');
  const baseOverheadLight = resolvedOverhead.light;
  const baseOverheadDark = resolvedOverhead.dark;
  const apiOverheadFallback = baseOverheadLight ?? baseOverheadDark;
  const localOverheadFallback = resolvedOverhead.fallback;
  const overheadArtworkAvailable = Boolean(apiOverheadFallback ?? localOverheadFallback);
  const openDoorStates = getOpenDoorStates(status);
  const overlaysLight = getDoorOverlayUrls(images?.all, openDoorStates, 'light');
  const overlaysDark = getDoorOverlayUrls(images?.all, openDoorStates, 'dark');
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const [imageStageHeight, setImageStageHeight] = useState(0);
  const [imageStageWidth, setImageStageWidth] = useState(0);
  const locksKnown = [
    status?.door_front_left_locked,
    status?.door_front_right_locked,
    status?.door_rear_left_locked,
    status?.door_rear_right_locked,
  ].some((value) => value !== null && value !== undefined);
  const tires = {
    fl: makeTireDisplay(status?.tire_fl_psi, status?.tire_fl_status, targetTirePressurePsi),
    fr: makeTireDisplay(status?.tire_fr_psi, status?.tire_fr_status, targetTirePressurePsi),
    rl: makeTireDisplay(status?.tire_rl_psi, status?.tire_rl_status, targetTirePressurePsi),
    rr: makeTireDisplay(status?.tire_rr_psi, status?.tire_rr_status, targetTirePressurePsi),
  };
  const stats = [
    { label: 'Driver mode', value: renderDriverMode(status?.drive_mode, status?.gear_status), icon: <Car className="h-3.5 w-3.5" /> },
    { label: 'Altitude', value: formatAltitude(status?.altitude_m), icon: <MapPin className="h-3.5 w-3.5" /> },
    { label: 'Cabin', value: formatTemp(status?.cabin_temp_c), icon: <Thermometer className="h-3.5 w-3.5" /> },
    { label: 'Speed', value: formatMph(status?.speed_mph), icon: <Gauge className="h-3.5 w-3.5" /> },
    { label: 'Software', value: formatSoftware(status), icon: <Cpu className="h-3.5 w-3.5" /> },
  ];
  const freshnessLabel = status?.telemetry_stale
    ? 'Telemetry stale'
    : status?.last_updated
      ? `Updated ${new Date(status.last_updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Awaiting telemetry';
  const rearGateLock = vehicleModel === 'R1T'
    ? status?.closure_tailgate_locked
    : status?.closure_liftgate_locked ?? status?.closure_tailgate_locked;
  const rearGateLockTitle = vehicleModel === 'R1T' ? 'Tailgate lock' : 'Rear gate lock';
  const demoArtworkNudgeRight = isDemoVehicle
    && (vehicleModel === 'R1S' || vehicleModel === 'R1T' || vehicleModel === 'R2S');

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

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border p-4 shadow-sm"
      style={{ background: 'radial-gradient(circle at 20% 20%, color-mix(in oklab, var(--rm-accent) 16%, transparent) 32%, transparent), linear-gradient(135deg, var(--rm-bg-surface), var(--rm-bg-elevated))' }}
    >
      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-tertiary">Vehicle overview</p>
        <span className="rounded-lg border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-tertiary">
          {freshnessLabel}
        </span>
      </div>
      <div className="grid flex-1 min-h-0 content-stretch gap-4 md:grid-cols-2 xl:grid-cols-[16rem_minmax(22rem,1fr)_18rem]">
        <div className="grid min-h-60 grid-cols-[3.75rem_minmax(0,1fr)] gap-4 rounded-2xl border border-accent/25 bg-accent/10 p-4">
          <div className="relative h-full min-h-48 overflow-hidden rounded-2xl border border-accent/40 bg-bg-surface">
            <div data-testid="overview-soc-rail" className="absolute inset-1 flex items-end overflow-hidden rounded-xl p-1">
              <div
                data-testid="overview-soc-fill"
                className="w-full rounded-lg transition-all"
                style={{ height: `${batteryLevel}%`, background: 'linear-gradient(to top, var(--rm-accent), var(--rm-status-positive))' }}
              />
            </div>
            <Battery className="absolute left-1/2 top-3 h-4 w-4 -translate-x-1/2 text-fg/80" />
          </div>
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <div>
              <span className="text-xs uppercase tracking-[0.16em] text-fg-tertiary">SoC</span>
              <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-fg">{formatPercent(status?.battery_level)}</p>
            </div>
            <div className="grid gap-2 text-sm">
              <SocDatum label="Range" value={formatMiles(status?.range_miles)} />
              <SocDatum label="Limit" value={formatPercent(status?.battery_limit)} />
              <SocDatum label="Charging" value={<ChargingGlyph status={status} />} />
              {isCharging(status) ? (
                <SocDatum label="To Limit" value={formatTimeToFull(status?.time_to_end_of_charge_min)} />
              ) : null}
            </div>
          </div>
        </div>
        <div ref={imageStageRef} className="relative min-h-60 overflow-hidden rounded-2xl border border-border bg-bg-surface/70 p-1">
          <div className="absolute right-3 top-3 z-30 inline-flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg-tertiary shadow-sm backdrop-blur">
            {status?.doors_locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3 text-accent" />}
            {locksKnown ? (status?.doors_locked ? 'Locked' : 'Unlocked') : 'Locks pending'}
          </div>
          <div className="absolute inset-1 z-10 flex items-center justify-center">
            {overheadArtworkAvailable ? (
              <VehicleArtFrame source={apiOverheadFallback} fallbackSource={localOverheadFallback} heightPx={imageStageHeight} widthPx={imageStageWidth}>
                <VehicleOverheadLayers base={baseOverheadLight ?? apiOverheadFallback} fallbackBase={localOverheadFallback} overlays={overlaysLight} darkClassName="dark:hidden" vehicleName={vehicleName} isR1tFallback={vehicleModel === 'R1T'} artworkNudgeRight={demoArtworkNudgeRight} />
                <VehicleOverheadLayers base={baseOverheadDark ?? apiOverheadFallback} fallbackBase={localOverheadFallback} overlays={overlaysDark} darkClassName="hidden dark:block" isR1tFallback={vehicleModel === 'R1T'} artworkNudgeRight={demoArtworkNudgeRight} />
                <VehicleLabel className={anchors.tire.rl} value={tires.rl.value} tone={tires.rl.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <VehicleLabel className={anchors.tire.fl} value={tires.fl.value} tone={tires.fl.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <VehicleLabel className={anchors.tire.rr} value={tires.rr.value} tone={tires.rr.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <VehicleLabel className={anchors.tire.fr} value={tires.fr.value} tone={tires.fr.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <LockLabel className={anchors.doorLocks.rl} locked={status?.door_rear_left_locked} title="Rear left door lock" />
                <LockLabel className={anchors.doorLocks.fl} locked={status?.door_front_left_locked} title="Front left door lock" />
                <LockLabel className={anchors.doorLocks.rr} locked={status?.door_rear_right_locked} title="Rear right door lock" />
                <LockLabel className={anchors.doorLocks.fr} locked={status?.door_front_right_locked} title="Front right door lock" />
                <LockLabel className={anchors.rearGateLock} locked={rearGateLock} title={rearGateLockTitle} />
                <LockLabel className={anchors.frunkLock} locked={status?.closure_frunk_locked} title="Frunk lock" />
                {vehicleModel === 'R1T' && anchors.sideBinLeftCover && (
                  <ClosureLabel className={anchors.sideBinLeftCover} closed={status?.side_bin_left_closed} title="Left side bin cover" />
                )}
                {vehicleModel === 'R1T' && anchors.sideBinRightCover && (
                  <ClosureLabel className={anchors.sideBinRightCover} closed={status?.side_bin_right_closed} title="Right side bin cover" />
                )}
              </VehicleArtFrame>
            ) : (
              <div className="flex h-28 w-64 items-center justify-center rounded-[2rem] border border-dashed border-border bg-bg-elevated text-fg-tertiary">
                <Car className="h-10 w-10" />
              </div>
            )}
          </div>
        </div>
        <div className="md:col-span-2 xl:col-span-1 grid auto-rows-fr gap-2 md:grid-cols-2 xl:grid-cols-1">
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/70 px-3 py-2 text-sm">
              <span className="inline-flex min-w-0 items-center gap-2 truncate text-fg-tertiary">
                {stat.icon}
                <span className="truncate">{stat.label}</span>
              </span>
              <span className="shrink-0 font-mono font-medium tabular-nums text-fg">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SocDatum({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-lg border border-accent/15 bg-bg-surface/55 px-3 py-2 leading-none">
      <span className="min-w-0 truncate text-sm text-fg-tertiary">{label}</span>
      <span className="shrink-0 font-mono text-sm font-medium tabular-nums text-fg">{value}</span>
    </div>
  );
}

function ChargingGlyph({ status }: { status: VehicleStatus | null | undefined }) {
  const charging = isCharging(status);
  const pluggedIn = isVehiclePluggedIn(status);
  const state = charging ? 'charging' : pluggedIn ? 'connected' : 'disconnected';
  const label = charging ? 'Charging' : pluggedIn ? 'Connected, not charging' : 'Not connected';
  return (
    <span
      data-testid="overview-charging-glyph"
      data-charging-state={state}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center ${charging ? 'text-accent' : 'text-fg-tertiary'}`}
    >
      {pluggedIn ? <PiPlugsConnectedFill className="h-4 w-4" /> : <PiPlugsFill className="h-4 w-4" />}
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
      <span
        data-testid="overview-tire-label"
        className={`inline-flex whitespace-nowrap rounded-lg border bg-bg-elevated/90 py-1 font-mono leading-none text-fg shadow-sm backdrop-blur ${tireHealthBorderClass(tone)}`}
        style={{
          fontSize: 'clamp(0.5625rem, 2.125cqw, 0.6875rem)',
          paddingInline: 'clamp(0.25rem, 1.54cqw, 0.5rem)',
        }}
      >
        {value}
      </span>
    </Tooltip>
  );
}

function LockLabel({ className, locked, title }: { className: string; locked: boolean | null | undefined; title?: string }) {
  const known = locked !== null && locked !== undefined;
  const unlocked = known && locked === false;
  const Icon = unlocked ? Unlock : Lock;
  return (
    <span
      title={title}
      className={`absolute z-30 inline-flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm backdrop-blur ${unlocked ? 'border-accent/60 bg-bg-elevated/90 text-accent' : known ? 'border-status-positive/60 bg-bg-elevated/90 text-status-positive' : 'border-border bg-bg-elevated/60 text-fg-tertiary'} ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function ClosureLabel({ className, closed, title }: { className: string; closed: boolean | null | undefined; title: string }) {
  const known = closed !== null && closed !== undefined;
  const open = known && closed === false;
  const Icon = open ? PackageOpen : Package;
  const stateLabel = known ? (open ? 'open' : 'closed') : 'unavailable';
  return (
    <span
      title={`${title}: ${stateLabel}`}
      className={`absolute z-30 inline-flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm backdrop-blur ${open ? 'border-accent/60 bg-bg-elevated/90 text-accent' : known ? 'border-status-positive/60 bg-bg-elevated/90 text-status-positive' : 'border-border bg-bg-elevated/60 text-fg-tertiary'} ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function VehicleArtFrame({
  source,
  fallbackSource,
  heightPx,
  widthPx,
  children,
}: {
  source: string | null | undefined;
  fallbackSource?: string | null | undefined;
  heightPx: number;
  widthPx: number;
  children: React.ReactNode;
}) {
  const artwork = useVehicleArtwork(source);
  const fallbackArtwork = useVehicleArtwork(fallbackSource);
  const frameArtworkSrc = artwork.src ?? fallbackArtwork.src;
  const [rotatedAspectRatio, setRotatedAspectRatio] = useState(2.25);
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setRotatedAspectRatio(image.naturalHeight / image.naturalWidth);
      }
    };
    if (frameArtworkSrc) image.src = frameArtworkSrc;
  }, [frameArtworkSrc]);
  const maxHeight = heightPx > 0 ? Math.max(120, (heightPx - 34) / 1.12) : 216;
  const maxWidth = widthPx > 0 ? Math.max(260, (widthPx - 34) / 1.04) : 520;
  const frameHeight = Math.round(Math.min(maxHeight, maxWidth / rotatedAspectRatio));
  const frameWidth = Math.round(frameHeight * rotatedAspectRatio);
  return (
    <div
      data-testid="overview-vehicle-art-frame"
      className="relative"
      style={{
        containerType: 'inline-size',
        height: frameHeight,
        width: frameWidth,
        transform: 'translateX(-5%)',
        '--vehicle-frame-height': `${frameHeight}px`,
        '--vehicle-frame-width': `${frameWidth}px`,
      } as React.CSSProperties}
    >
      {frameArtworkSrc ? children : null}
    </div>
  );
}

function VehicleOverheadLayers({
  base,
  fallbackBase,
  overlays,
  darkClassName,
  vehicleName,
  isR1tFallback,
  artworkNudgeRight,
}: {
  base: string | null | undefined;
  fallbackBase?: string | null | undefined;
  overlays: string[];
  darkClassName: string;
  vehicleName?: string | undefined;
  isR1tFallback: boolean;
  artworkNudgeRight: boolean;
}) {
  const imageStyle = {
    height: 'var(--vehicle-frame-width)',
    width: 'var(--vehicle-frame-height)',
    left: '50%',
    transform: 'translate(-50%, -50%) rotate(90deg)',
  } as React.CSSProperties;
  const fallbackProps = {
    style: {
      ...imageStyle,
      // The shared rear/front lock anchors sit at 4% and 102%. Center only
      // the packaged demo fallback at their midpoint, leaving Rivian artwork
      // and all annotations on their established coordinates.
      left: artworkNudgeRight ? '53%' : '50%',
      transform: isR1tFallback
        ? `translate(-50%, -50%) rotate(90deg) scaleX(${R1T_OVERVIEW_FALLBACK_CROSS_AXIS_SCALE})`
        : imageStyle.transform,
    },
  };
  const [usingFallback, setUsingFallback] = useState(false);
  return (
    <div className={`absolute inset-0 ${darkClassName}`}>
      <AuthenticatedVehicleArtwork
        source={base}
        fallbackSource={fallbackBase}
        alt={vehicleName ?? 'Rivian vehicle'}
        className="absolute left-1/2 top-1/2 max-w-none object-contain object-center"
        style={imageStyle}
        fallbackProps={fallbackProps}
        onFallbackChange={setUsingFallback}
      />
      {!usingFallback
        ? overlays.map((overlayUrl) => (
            <AuthenticatedVehicleArtwork
              key={overlayUrl}
              source={overlayUrl}
              alt=""
              className="absolute left-1/2 top-1/2 max-w-none object-contain object-center"
              style={imageStyle}
            />
          ))
        : null}
    </div>
  );
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value)}%`;
}

function formatTimeToFull(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined || minutes <= 0) return '-';
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function isCharging(status: VehicleStatus | null | undefined) {
  const chargerState = status?.charger_state?.toLowerCase();
  if (chargerState === 'charging' || status?.charger_status === 'chrgr_sts_connected_charging') return true;
  return false;
}

function renderDriverMode(driveMode: string | null | undefined, gearStatus: string | null | undefined) {
  const rawValue = driveMode ?? gearStatus;
  if (!rawValue) return '-';

  return formatDriveMode(rawValue);
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

registerWidget({
  componentType: 'custom',
  definitionId: 'overview.vehicle',
  title: 'Vehicle Overview',
  defaultSize: { w: 12, h: 7 },
  minSize: { w: 8, h: 6 },
  defaultOptions: {},
  dataRequirements: () => ({ status: true }),
  component: OverviewVehicleWidget,
});
