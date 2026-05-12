import React, { useEffect, useRef, useState } from 'react';
import { Battery, BatteryCharging, Car, Cpu, Gauge, Lock, MapPin, Thermometer, Unlock, Zap } from 'lucide-react';
import { PiPlugsConnectedFill, PiPlugsFill } from 'react-icons/pi';
import { useAuth, useChargingSummary, useCurrentVehicleStatus, useVehicles } from '@riviamigo/hooks';
import { Badge, Tooltip } from '@riviamigo/ui/primitives';
import { formatDriveMode, getDriveModeBadgeClass } from '@riviamigo/ui/lib/driveMode';
import {
  formatAltitude,
  formatKwh,
  formatMiles,
  formatMph,
  formatNumber,
  formatPercent as formatDashboardPercent,
  formatPressure,
  formatTemp,
} from '@riviamigo/ui/lib/utils';
import type { VehicleImages, VehicleStatus } from '@riviamigo/types';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';

function OverviewVehicleWidget({ ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { defaultVehicleId } = useAuth();
  const vehicleId = ctx.vehicleId ?? defaultVehicleId;
  const { data: status } = useCurrentVehicleStatus(vehicleId);
  const { data: vehicles } = useVehicles();
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === vehicleId);

  return <CurrentVehicleStatePanel status={status} images={activeVehicle?.images} />;
}

interface ChargingSummarySnapshot {
  session_count: number;
  total_energy_kwh: number | null;
  total_cost_usd: number | null;
  home_kwh: number | null;
  away_kwh: number | null;
  ac_kwh: number | null;
  dc_kwh: number | null;
  charging_cycles: number | null;
  charging_efficiency_pct: number | null;
  max_charge_rate_kw: number | null;
  max_charge_limit_pct: number | null;
}

interface ChargingConnectedWidgetOptions {
  forceShow?: boolean;
}

function ChargingConnectedVehicleWidget({
  instance,
  ctx,
}: {
  instance: WidgetInstance;
  ctx: WidgetCtx;
}) {
  const { defaultVehicleId } = useAuth();
  const vehicleId = ctx.vehicleId ?? defaultVehicleId;
  const { data: status } = useCurrentVehicleStatus(vehicleId);
  const { data: vehicles } = useVehicles();
  const { data: summary } = useChargingSummary(ctx.vehicleId, ctx.from, ctx.to);
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === vehicleId);
  const options = (instance.options ?? {}) as ChargingConnectedWidgetOptions;
  const pluggedIn = isPluggedIn(status);
  const charging = isActivelyCharging(status);
  const forceShow = options.forceShow === true;
  const visible = pluggedIn || forceShow;
  const snapshot = summary as ChargingSummarySnapshot | undefined;
  const sideLight = activeVehicle?.images?.side?.light ?? findFirstSideImage(activeVehicle?.images?.all, 'light');
  const sideDark = activeVehicle?.images?.side?.dark ?? findFirstSideImage(activeVehicle?.images?.all, 'dark');
  const sideFallback = sideLight ?? sideDark ?? findFirstSideImage(activeVehicle?.images?.all);
  const chargingOverlayLight = findBestChargingSideOverlay(activeVehicle?.images?.all, 'light');
  const chargingOverlayDark = findBestChargingSideOverlay(activeVehicle?.images?.all, 'dark');
  const title = instance.title ?? 'Charging Connection';
  const rows = [
    {
      label: 'Charge Efficiency',
      value: snapshot ? formatMaybePercent(snapshot.charging_efficiency_pct, 1) : '-',
    },
    {
      label: 'Avg / Session',
      value:
        snapshot && snapshot.session_count > 0 && snapshot.total_energy_kwh != null
          ? formatKwh(snapshot.total_energy_kwh / snapshot.session_count)
          : '-',
    },
    {
      label: 'Max Charge Rate',
      value: snapshot?.max_charge_rate_kw == null ? '-' : `${formatNumber(snapshot.max_charge_rate_kw, 1)} kW`,
    },
    {
      label: 'Max Charge Limit',
      value: formatMaybePercent(snapshot?.max_charge_limit_pct ?? status?.battery_limit ?? null, 0),
    },
  ];

  if (!visible) {
    return (
      <section
        data-testid="charging-connection-chip"
        className="flex h-full min-h-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-[linear-gradient(135deg,var(--rm-bg-surface),var(--rm-bg-elevated))] p-6 shadow-lg shadow-black/10"
      >
        <div className="grid max-w-sm gap-3 text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-bg-elevated text-fg-tertiary">
            <PiPlugsFill className="h-6 w-6" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-tertiary">{title}</p>
            <p className="mt-1 text-base font-semibold text-fg">Not connected</p>
            <p className="mt-1 text-sm text-fg-tertiary">Awaiting plugged-in vehicle telemetry.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      data-testid="charging-connection-chip"
      className="relative flex h-full min-h-0 overflow-hidden rounded-2xl border border-border bg-[linear-gradient(135deg,var(--rm-bg-surface),var(--rm-bg-elevated))] shadow-lg shadow-black/10"
    >
      <div className="grid h-full min-h-0 w-full grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)]">
        <div className="flex min-h-0 flex-col gap-3 border-r border-border/80 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-tertiary">{title}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${charging ? 'border-accent/60 bg-accent/15 text-accent' : 'border-border bg-bg-elevated text-fg'}`}>
                  {charging ? <BatteryCharging className="h-4 w-4" /> : <PiPlugsFill className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg">
                    {charging ? 'Connected & charging' : 'Connected, not charging'}
                  </p>
                  <p className="truncate text-xs text-fg-tertiary">
                    {forceShow && !pluggedIn ? 'Forced preview' : prettifyChargingStatus(status?.charger_status, status?.charger_state)}
                  </p>
                </div>
              </div>
            </div>
            <span className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${charging ? 'border-accent/60 bg-accent/15 text-accent' : 'border-border bg-bg-elevated text-fg-secondary'}`}>
              {charging ? 'Live' : 'Ready'}
            </span>
          </div>

          <div className="grid gap-2">
            {rows.map((row) => (
              <ChargingSummaryRow key={row.label} label={row.label} value={row.value} />
            ))}
          </div>

          <div className="mt-auto grid grid-cols-3 gap-2">
            <ChargingMiniDatum label="Battery" value={formatPercent(status?.battery_level)} />
            <ChargingMiniDatum label="Limit" value={formatPercent(status?.battery_limit)} />
            <ChargingMiniDatum label="Full In" value={formatTimeToFull(status?.time_to_end_of_charge_min)} />
          </div>
        </div>

        <div className="relative min-h-0 overflow-hidden bg-bg-surface/50">
          <div className="absolute inset-y-0 right-0 left-4 flex items-center justify-end">
            {sideFallback ? (
              <>
                <VehicleSideLayers
                  base={sideLight ?? sideFallback}
                  overlay={charging ? chargingOverlayLight : undefined}
                  darkClassName="dark:hidden"
                />
                <VehicleSideLayers
                  base={sideDark ?? sideFallback}
                  overlay={charging ? chargingOverlayDark : undefined}
                  darkClassName="hidden dark:block"
                />
              </>
            ) : (
              <div className="mr-4 flex h-28 w-52 items-center justify-center rounded-2xl border border-dashed border-border bg-bg-elevated text-fg-tertiary">
                <Car className="h-10 w-10" />
              </div>
            )}
          </div>

          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
            <div className="rounded-xl border border-border bg-bg-elevated/90 px-3 py-2 shadow-sm backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.16em] text-fg-tertiary">Charge State</p>
              <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-fg">
                {formatPercent(status?.battery_level)}
              </p>
            </div>
            <div className={`rounded-xl border px-3 py-2 shadow-sm backdrop-blur ${charging ? 'border-accent/60 bg-accent/15 text-accent' : 'border-border bg-bg-elevated/90 text-fg-secondary'}`}>
              <div className="flex items-center gap-2">
                <Zap className={`h-4 w-4 ${charging ? 'text-accent' : 'text-fg-tertiary'}`} />
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em]">Charging</p>
                  <p className="font-mono text-sm font-semibold tabular-nums">
                    {charging ? formatTimeToFull(status?.time_to_end_of_charge_min) : 'Standby'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {charging ? <ChargingLight /> : null}
        </div>
      </div>
    </section>
  );
}

function CurrentVehicleStatePanel({
  status,
  images,
}: {
  status: VehicleStatus | null | undefined;
  images?: VehicleImages | null | undefined;
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
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-[radial-gradient(circle_at_20%_20%,rgba(253,131,4,0.16),transparent_32%),linear-gradient(135deg,var(--rm-bg-surface),var(--rm-bg-elevated))] p-4 shadow-lg shadow-black/10">
      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-tertiary">Vehicle overview</p>
        <span className="rounded-lg border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-tertiary">
          {status?.last_updated ? `Updated ${new Date(status.last_updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Awaiting telemetry'}
        </span>
      </div>
      <div className="grid flex-1 min-h-0 content-stretch gap-4 xl:grid-cols-[16rem_minmax(22rem,1fr)_18rem]">
        <div className="grid h-full min-h-60 grid-cols-[3.75rem_minmax(0,1fr)] gap-4 rounded-2xl border border-accent/25 bg-accent/10 p-4">
          <div className="relative h-full min-h-48 overflow-hidden rounded-2xl border border-accent/40 bg-bg-surface">
            <div className="absolute inset-x-1 bottom-1 rounded-xl transition-all" style={{ height: `${batteryLevel}%`, background: 'linear-gradient(to top, var(--rm-accent), #10B981)' }} />
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
        <div ref={imageStageRef} className="relative h-full min-h-60 overflow-hidden rounded-2xl border border-border bg-bg-surface/70 p-1">
          <div className="absolute right-3 top-3 z-30 inline-flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg-tertiary shadow-sm backdrop-blur">
            {status?.doors_locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3 text-accent" />}
            {locksKnown ? (status?.doors_locked ? 'Locked' : 'Unlocked') : 'Locks pending'}
          </div>
          <div className="absolute inset-1 z-10 flex items-center justify-center">
            {baseOverheadFallback ? (
              <VehicleArtFrame source={baseOverheadFallback} heightPx={imageStageHeight} widthPx={imageStageWidth}>
                <VehicleOverheadLayers base={baseOverheadLight ?? baseOverheadFallback} overlays={overlaysLight} darkClassName="dark:hidden" />
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
        <div className="grid h-full auto-rows-fr gap-2">
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

function ChargingSummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/70 px-3 py-2 text-xs">
      <span className="truncate text-fg-tertiary">{label}</span>
      <span className="shrink-0 font-mono font-medium tabular-nums text-fg">{value}</span>
    </div>
  );
}

function ChargingMiniDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-elevated/70 px-2.5 py-2">
      <p className="truncate text-[11px] uppercase tracking-[0.14em] text-fg-tertiary">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums text-fg">{value}</p>
    </div>
  );
}

function VehicleSideLayers({ base, overlay, darkClassName }: { base: string; overlay?: string | undefined; darkClassName: string }) {
  return (
    <div className={`absolute inset-0 ${darkClassName}`}>
      <img src={base} alt="" className="absolute bottom-0 right-0 h-full w-auto max-w-none object-contain object-right" />
      {overlay ? <img src={overlay} alt="" className="absolute bottom-0 right-0 h-full w-auto max-w-none object-contain object-right" /> : null}
    </div>
  );
}

function ChargingLight() {
  return (
    <div className="pointer-events-none absolute right-[12%] top-[28%]">
      <span className="absolute inset-0 h-8 w-8 rounded-full bg-accent/35 blur-md" />
      <span className="relative inline-flex h-4 w-4 rounded-full border border-accent/80 bg-accent shadow-[0_0_24px_rgba(253,131,4,0.65)]" />
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

function VehicleOverheadLayers({ base, overlays, darkClassName }: { base: string; overlays: string[]; darkClassName: string }) {
  const imageStyle = {
    height: 'var(--vehicle-frame-width)',
    width: 'var(--vehicle-frame-height)',
    transform: 'translate(-50%, -50%) rotate(90deg)',
  } as React.CSSProperties;
  return (
    <div className={`absolute inset-0 ${darkClassName}`}>
      <img src={base} alt="" className="absolute left-1/2 top-1/2 max-w-none object-contain object-center" style={imageStyle} />
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

function formatMaybePercent(value: number | null | undefined, digits: number) {
  return value == null ? '-' : formatDashboardPercent(value, digits);
}

function isPluggedIn(status: VehicleStatus | null | undefined) {
  const state = status?.charger_state?.toLowerCase();
  if (state && !['unknown', 'disconnected'].includes(state)) return true;
  return Boolean(status?.charger_status && status.charger_status !== 'chrgr_sts_not_connected');
}

function isActivelyCharging(status: VehicleStatus | null | undefined) {
  const state = status?.charger_state?.toLowerCase();
  return state === 'charging' || status?.charger_status === 'chrgr_sts_connected_charging';
}

function prettifyChargingStatus(chargerStatus: string | null | undefined, chargerState: string | null | undefined) {
  if (chargerStatus) return prettify(chargerStatus);
  if (chargerState) return prettify(chargerState);
  return 'Telemetry pending';
}

function formatTire(psi: number | null | undefined, status?: string | null) {
  if (psi !== null && psi !== undefined) return formatPressure(psi);
  return status ? prettify(status) : '-';
}

function renderDriverMode(driveMode: string | null | undefined, gearStatus: string | null | undefined) {
  if (driveMode) {
    return formatDriveMode(driveMode);
  }
  return gearStatus ? prettify(gearStatus) : '-';
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

function prettifyDriveMode(value: string) {
  return formatDriveMode(value);
}

function prettify(value: string | null | undefined) {
  if (!value) return '-';
  return value.replace(/^chrgr_sts_/, '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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

function getDoorOverlayUrls(images: VehicleImages['all'] | undefined, openDoors: DoorKey[], designPreference: 'light' | 'dark'): string[] {
  if (!images || openDoors.length === 0) return [];
  const overheadImages = images.filter((image) => normalizePlacement(image.placement) === 'overhead');
  const urls = openDoors.map((door) => findBestDoorOverlay(overheadImages, door, designPreference)).filter((url): url is string => Boolean(url));
  return Array.from(new Set(urls));
}

function findBestDoorOverlay(images: VehicleImages['all'], door: DoorKey, designPreference: 'light' | 'dark'): string | undefined {
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
  return images.find((image) => normalizePlacement(image.placement) === 'overhead')?.url;
}

function findFirstSideImage(images: VehicleImages['all'] | undefined, design?: 'light' | 'dark'): string | undefined {
  if (!images) return undefined;
  if (design) {
    const preferred = images.find((image) => normalizePlacement(image.placement) === 'side' && designMatches(image.design, design));
    if (preferred?.url) return preferred.url;
  }
  return images.find((image) => normalizePlacement(image.placement) === 'side')?.url;
}

function findBestChargingSideOverlay(images: VehicleImages['all'] | undefined, designPreference: 'light' | 'dark') {
  if (!images) return undefined;
  const sideImages = images.filter((image) => normalizePlacement(image.placement) === 'side');
  const tokenSets = [
    ['charging', 'light'],
    ['charge', 'light'],
    ['charge', 'port'],
    ['port', 'open'],
  ];

  for (const tokens of tokenSets) {
    const preferred = sideImages.find((image) => designMatches(image.design, designPreference) && tokens.every((token) => imageText(image).includes(token)));
    if (preferred?.url) return preferred.url;
  }

  for (const tokens of tokenSets) {
    const fallback = sideImages.find((image) => tokens.every((token) => imageText(image).includes(token)));
    if (fallback?.url) return fallback.url;
  }

  return undefined;
}

function normalizePlacement(value: string | null | undefined): 'side' | 'overhead' | 'front' | 'rear' | 'unknown' {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.includes('side')) return 'side';
  if (normalized.includes('overhead') || normalized.includes('top') || normalized.includes('bird')) return 'overhead';
  if (normalized.includes('front')) return 'front';
  if (normalized.includes('rear') || normalized.includes('back')) return 'rear';
  return 'unknown';
}

function designMatches(value: string | null | undefined, expected: 'light' | 'dark') {
  return (value ?? '').toLowerCase().includes(expected);
}

function imageText(image: VehicleImages['all'][number]) {
  return `${image.placement ?? ''} ${image.design ?? ''} ${JSON.stringify(image.metadata ?? {})}`.toLowerCase();
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

registerWidget({
  componentType: 'custom',
  definitionId: 'charging.connection',
  title: 'Charging Connection',
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 5, h: 5 },
  defaultOptions: { forceShow: false },
  component: ChargingConnectedVehicleWidget,
});
