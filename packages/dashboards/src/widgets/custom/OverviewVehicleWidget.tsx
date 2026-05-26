import React, { useEffect, useRef, useState } from 'react';
import { Battery, Car, Cpu, Gauge, Lock, MapPin, Thermometer, Unlock } from 'lucide-react';
import { PiPlugsConnectedFill, PiPlugsFill } from 'react-icons/pi';
import { useAuth, useCurrentVehicleStatus, useVehicles } from '@riviamigo/hooks';
import { formatDriveMode } from '@riviamigo/ui/lib/driveMode';
import { formatAltitude, formatKwh, formatMiles, formatMph, formatPressure, formatTemp } from '@riviamigo/ui/lib/utils';
import type { VehicleImages, VehicleStatus } from '@riviamigo/types';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';
import { findFirstOverheadImage, getDoorOverlayUrls, getOpenDoorStates } from './imageUtils';

function OverviewVehicleWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { defaultVehicleId } = useAuth();
  const vehicleId = ctx.vehicleId ?? defaultVehicleId;
  const { data: status } = useCurrentVehicleStatus(vehicleId);
  const { data: vehicles } = useVehicles();
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === vehicleId);

  return <CurrentVehicleStatePanel status={status} images={activeVehicle?.images} vehicleName={activeVehicle?.display_name} />;
}

function CurrentVehicleStatePanel({
  status,
  images,
  vehicleName,
}: {
  status: VehicleStatus | null | undefined;
  images?: VehicleImages | null | undefined;
  vehicleName?: string | undefined;
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
  const locksKnown = [
    status?.door_front_left_locked,
    status?.door_front_right_locked,
    status?.door_rear_left_locked,
    status?.door_rear_right_locked,
  ].some((value) => value !== null && value !== undefined);
  const tires = {
    fl: formatTire(status?.tire_fl_psi, status?.tire_fl_status),
    fr: formatTire(status?.tire_fr_psi, status?.tire_fr_status),
    rl: formatTire(status?.tire_rl_psi, status?.tire_rl_status),
    rr: formatTire(status?.tire_rr_psi, status?.tire_rr_status),
  };
  const stats = [
    { label: 'Driver mode', value: renderDriverMode(status?.drive_mode, status?.gear_status), icon: <Car className="h-3.5 w-3.5" /> },
    { label: 'Altitude', value: formatAltitude(status?.altitude_m), icon: <MapPin className="h-3.5 w-3.5" /> },
    { label: 'Cabin', value: formatTemp(status?.cabin_temp_c), icon: <Thermometer className="h-3.5 w-3.5" /> },
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

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border p-4 shadow-sm"
      style={{ background: 'radial-gradient(circle at 20% 20%, color-mix(in oklab, var(--rm-accent) 16%, transparent) 32%, transparent), linear-gradient(135deg, var(--rm-bg-surface), var(--rm-bg-elevated))' }}
    >
      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-tertiary">Vehicle overview</p>
        <span className="rounded-lg border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-tertiary">
          {status?.last_updated ? `Updated ${new Date(status.last_updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Awaiting telemetry'}
        </span>
      </div>
      <div className="grid flex-1 min-h-0 content-stretch gap-4 md:grid-cols-2 xl:grid-cols-[16rem_minmax(22rem,1fr)_18rem]">
        <div className="grid min-h-60 grid-cols-[3.75rem_minmax(0,1fr)] gap-4 rounded-2xl border border-accent/25 bg-accent/10 p-4">
          <div className="relative h-full min-h-48 overflow-hidden rounded-2xl border border-accent/40 bg-bg-surface">
            <div className="absolute inset-x-1 bottom-1 rounded-xl transition-all" style={{ height: `${batteryLevel}%`, background: 'linear-gradient(to top, var(--rm-accent), var(--rm-status-positive))' }} />
            <Battery className="absolute left-1/2 top-3 h-4 w-4 -translate-x-1/2 text-fg/80" />
          </div>
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <div>
              <span className="text-xs uppercase tracking-[0.16em] text-fg-tertiary">SoC</span>
              <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-fg">{formatPercent(status?.battery_level)}</p>
            </div>
            <div className="grid gap-2 text-xs">
              <SocDatum label="Range" value={formatMiles(status?.range_miles)} />
              <SocDatum label="Limit" value={formatPercent(status?.battery_limit)} />
              <SocDatum label="Charging" value={<ChargingGlyph chargerState={status?.charger_state} chargerStatus={status?.charger_status} />} />
              <SocDatum label="Time to Full" value={formatTimeToFull(status?.time_to_end_of_charge_min)} />
            </div>
          </div>
        </div>
        <div ref={imageStageRef} className="relative min-h-60 overflow-hidden rounded-2xl border border-border bg-bg-surface/70 p-1">
          <div className="absolute right-3 top-3 z-30 inline-flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg-tertiary shadow-sm backdrop-blur">
            {status?.doors_locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3 text-accent" />}
            {locksKnown ? (status?.doors_locked ? 'Locked' : 'Unlocked') : 'Locks pending'}
          </div>
          <div className="absolute inset-1 z-10 flex items-center justify-center">
            {baseOverheadFallback ? (
              <VehicleArtFrame source={baseOverheadFallback} heightPx={imageStageHeight} widthPx={imageStageWidth}>
                <VehicleOverheadLayers base={baseOverheadLight ?? baseOverheadFallback} overlays={overlaysLight} darkClassName="dark:hidden" vehicleName={vehicleName} />
                <VehicleOverheadLayers base={baseOverheadDark ?? baseOverheadFallback} overlays={overlaysDark} darkClassName="hidden dark:block" />
                <VehicleLabel className="left-[27%] top-[0%]" value={tires.rl} />
                <VehicleLabel className="left-[82%] top-[0%]" value={tires.fl} />
                <VehicleLabel className="left-[27%] top-[102%]" value={tires.rr} />
                <VehicleLabel className="left-[82%] top-[102%]" value={tires.fr} />
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
        <div className="md:col-span-2 xl:col-span-1 grid auto-rows-fr gap-2 md:grid-cols-2 xl:grid-cols-1">
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

function SocDatum({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-accent/15 bg-bg-surface/55 px-2.5 py-1.5">
      <span className="text-fg-tertiary">{label}</span>
      <span className="min-w-0 truncate font-mono font-medium tabular-nums text-fg">{value}</span>
    </div>
  );
}

function ChargingGlyph({ chargerState, chargerStatus }: { chargerState: string | null | undefined; chargerStatus: string | null | undefined }) {
  const charging = chargerState && !['unknown', 'disconnected'].includes(chargerState.toLowerCase()) && chargerStatus !== 'chrgr_sts_not_connected';
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

function VehicleLabel({ className, value }: { className: string; value: string }) {
  return <span className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-elevated/90 px-2 py-1 font-mono text-[11px] text-fg shadow-sm backdrop-blur ${className}`}>{value}</span>;
}

function LockLabel({ className, locked, title }: { className: string; locked: boolean | null | undefined; title?: string }) {
  const known = locked !== null && locked !== undefined;
  const unlocked = known && locked === false;
  const Icon = unlocked ? Unlock : Lock;
  return (
    <span
      title={title}
      className={`absolute z-30 inline-flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm backdrop-blur ${unlocked ? 'border-accent/60 bg-bg-elevated/90 text-accent' : known ? 'border-border bg-bg-elevated/90 text-fg' : 'border-border bg-bg-elevated/60 text-fg-tertiary'} ${className}`}
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
  const maxHeight = heightPx > 0 ? Math.max(120, (heightPx - 34) / 1.12) : 216;
  const maxWidth = widthPx > 0 ? Math.max(260, (widthPx - 34) / 1.04) : 520;
  const frameHeight = Math.round(Math.min(maxHeight, maxWidth / rotatedAspectRatio));
  const frameWidth = Math.round(frameHeight * rotatedAspectRatio);
  return (
    <div
      className="relative"
      style={{
        height: frameHeight,
        width: frameWidth,
        transform: 'translateX(-5%)',
        '--vehicle-frame-height': `${frameHeight}px`,
        '--vehicle-frame-width': `${frameWidth}px`,
      } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

function VehicleOverheadLayers({ base, overlays, darkClassName, vehicleName }: { base: string; overlays: string[]; darkClassName: string; vehicleName?: string | undefined }) {
  const imageStyle = {
    height: 'var(--vehicle-frame-width)',
    width: 'var(--vehicle-frame-height)',
    transform: 'translate(-50%, -50%) rotate(90deg)',
  } as React.CSSProperties;
  return (
    <div className={`absolute inset-0 ${darkClassName}`}>
      <img src={base} alt={vehicleName ?? 'Rivian vehicle'} className="absolute left-1/2 top-1/2 max-w-none object-contain object-center" style={imageStyle} />
      {overlays.map((overlayUrl) => <img key={overlayUrl} src={overlayUrl} alt="" className="absolute left-1/2 top-1/2 max-w-none object-contain object-center" style={imageStyle} />)}
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

function formatTire(psi: number | null | undefined, status?: string | null) {
  if (psi !== null && psi !== undefined) return formatPressure(psi);
  return status ? prettify(status) : '-';
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

registerWidget({
  componentType: 'custom',
  definitionId: 'overview.vehicle',
  title: 'Vehicle Overview',
  defaultSize: { w: 12, h: 7 },
  minSize: { w: 8, h: 6 },
  defaultOptions: {},
  component: OverviewVehicleWidget,
});
