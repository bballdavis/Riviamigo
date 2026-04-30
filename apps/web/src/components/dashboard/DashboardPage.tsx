import React, { useEffect, useRef, useState } from 'react';
import { useAuth, useCurrentVehicleStatus, useVehicles } from '@riviamigo/hooks';
import { PageLayout, DateRangePicker, Tooltip } from '@riviamigo/ui/primitives';
import {
  DashboardRenderer,
  useDashboardBySlug,
  useUpdateDashboard,
  getDefaultBySlug,
} from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';
import type { VehicleImages, VehicleStatus } from '@riviamigo/types';
import { AppLayout } from '../layout/AppLayout';
import { AuthGuard } from '../layout/AuthGuard';
import { NoVehicleState } from '../layout/NoVehicleState';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../../lib/dates';
import { Battery, Car, Gauge, MapPin, Save, Thermometer, Trash2, Edit2, Cpu } from 'lucide-react';
import { BsLockFill, BsUnlockFill } from 'react-icons/bs';
import { PiPlugsConnectedFill, PiPlugsFill } from 'react-icons/pi';
import { MdOutlinePendingActions } from 'react-icons/md';

export interface DashboardPageProps {
  /** Sidebar nav key (e.g. "dashboard", "battery"). */
  navKey: string;
  /** Dashboard slug to resolve. */
  slug: string;
  /** Override the page title shown in PageLayout. */
  title?: string | undefined;
}

export function DashboardPage({ navKey, slug, title }: DashboardPageProps) {
  return (
    <AuthGuard>
      <DashboardPageContent navKey={navKey} slug={slug} title={title} />
    </AuthGuard>
  );
}

function DashboardPageContent({ navKey, slug, title }: DashboardPageProps) {
  const { defaultVehicleId } = useAuth();

  const [preset, setPreset] = useState<PresetKey | undefined>(DEFAULT_PRESET);
  const [range, setRange] = useState(presetToRange(DEFAULT_PRESET));
  const { from, to } = rangeToIso(range);

  // Try API first; fall back to bundled defaults if API unavailable / loading
  const { data: apiConfig, isLoading } = useDashboardBySlug(slug);
  const localDefault = getDefaultBySlug(slug);
  const savedConfig: DashboardConfig | undefined = apiConfig ?? localDefault;

  const [isEditMode, setIsEditMode] = useState(false);
  const [localConfig, setLocalConfig] = useState<DashboardConfig | null>(null);
  const updateDashboard = useUpdateDashboard();

  const activeConfig = localConfig ?? savedConfig;
  const ctx = { vehicleId: defaultVehicleId, from, to };
  const { data: currentStatus } = useCurrentVehicleStatus(defaultVehicleId);
  const { data: vehicles } = useVehicles();
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === defaultVehicleId);

  function enterEdit() {
    setLocalConfig(savedConfig ?? null);
    setIsEditMode(true);
  }

  function exitEdit() {
    setIsEditMode(false);
    setLocalConfig(null);
  }

  async function handleSave() {
    if (!localConfig) {
      exitEdit();
      return;
    }
    try {
      await updateDashboard.mutateAsync(localConfig);
      exitEdit();
    } catch {
      // API unavailable or rejected — stay in edit mode so changes aren't lost
    }
  }

  return (
    <AppLayout activeKey={navKey}>
      <PageLayout
        title={title ?? activeConfig?.name ?? slug}
        titleAction={
          !isEditMode ? (
            <button
              onClick={enterEdit}
              className="p-1 rounded-md text-fg-tertiary hover:text-fg hover:bg-bg-elevated transition-colors"
              title="Edit dashboard"
            >
              <Edit2 className="h-4 w-4" />
            </button>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            {activeConfig?.controls?.dateRange && !isEditMode && (
              <DateRangePicker
                value={range}
                preset={preset}
                onChange={(r, p) => { setRange(r); setPreset(p); }}
              />
            )}
            {isEditMode && (
              <>
                <button
                  onClick={handleSave}
                  disabled={updateDashboard.isPending}
                  title="Save changes"
                  className="p-2 rounded-lg bg-accent text-white disabled:opacity-40 hover:bg-accent/90 transition-colors"
                >
                  <Save className="h-4 w-4" />
                </button>
                <button
                  onClick={exitEdit}
                  title="Discard changes"
                  className="p-2 rounded-lg border border-border hover:bg-bg-elevated transition-colors text-fg-tertiary hover:text-fg"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        }
      >
        {!defaultVehicleId ? (
          <NoVehicleState />
        ) : isLoading && !activeConfig ? (
          <div className="text-xs text-fg-tertiary p-4">Loading…</div>
        ) : activeConfig ? (
          <>
            {slug === 'dashboard' && !isEditMode && (
              <CurrentVehicleStatePanel status={currentStatus} images={activeVehicle?.images} />
            )}
            <DashboardRenderer
              config={activeConfig}
              ctx={ctx}
              mode={isEditMode ? 'edit' : 'view'}
              onConfigChange={setLocalConfig}
            />
          </>
        ) : null}
      </PageLayout>
    </AppLayout>
  );
}

function CurrentVehicleStatePanel({ status, images }: { status: VehicleStatus | null | undefined; images?: VehicleImages | null | undefined }) {
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
    fl: formatTire(status?.tire_fl_psi, status?.tire_fl_status),
    fr: formatTire(status?.tire_fr_psi, status?.tire_fr_status),
    rl: formatTire(status?.tire_rl_psi, status?.tire_rl_status),
    rr: formatTire(status?.tire_rr_psi, status?.tire_rr_status),
  };
  const stats = [
    { label: 'Driver mode', value: renderDriverMode(status?.drive_mode, status?.gear_status), icon: <Car className="h-3.5 w-3.5" /> },
    { label: 'Altitude', value: formatFeet(status?.altitude_m), icon: <MapPin className="h-3.5 w-3.5" /> },
    { label: 'Cabin', value: formatTemp(status?.cabin_temp_c), icon: <Thermometer className="h-3.5 w-3.5" /> },
    { label: 'Speed', value: formatSpeed(status?.speed_mph), icon: <Gauge className="h-3.5 w-3.5" /> },
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
    <section className="mb-4 overflow-hidden rounded-2xl border border-border bg-[radial-gradient(circle_at_20%_20%,rgba(253,131,4,0.16),transparent_32%),linear-gradient(135deg,var(--rm-bg-surface),var(--rm-bg-elevated))] p-4 shadow-lg shadow-black/10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-tertiary">Vehicle overview</p>
        </div>
        <span className="rounded-full border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-tertiary">
          {status?.last_updated ? `Updated ${new Date(status.last_updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Awaiting telemetry'}
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[16rem_minmax(22rem,1fr)_18rem]">
        <div className="grid min-h-60 grid-cols-[3.75rem_minmax(0,1fr)] gap-4 rounded-2xl border border-accent/25 bg-accent/10 p-4">
          <div className="relative h-full min-h-48 overflow-hidden rounded-2xl border border-accent/40 bg-bg-surface">
            <div
              className="absolute inset-x-1 bottom-1 rounded-xl transition-all"
              style={{
                height: `${batteryLevel}%`,
                background: `linear-gradient(to top, var(--rm-accent) 0%, color-mix(in oklab, var(--rm-accent) ${100 - batteryLevel}%, #10B981 ${batteryLevel}%) 100%)`,
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
              <SocDatum label="Range" value={formatMiles(status?.range_miles)} />
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
            {status?.doors_locked ? <BsLockFill className="h-3 w-3" /> : <BsUnlockFill className="h-3 w-3 text-accent" />}
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
                />
                <VehicleOverheadLayers
                  base={baseOverheadDark ?? baseOverheadFallback}
                  overlays={overlaysDark}
                  darkClassName="hidden dark:block"
                />
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

        <div className="grid gap-2">
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

function VehicleLabel({ className, value }: { className: string; value: string }) {
  return <span className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-elevated/90 px-2 py-1 font-mono text-[11px] text-fg shadow-sm backdrop-blur ${className}`}>{value}</span>;
}

function LockLabel({ className, locked, title }: { className: string; locked: boolean | null | undefined; title?: string }) {
  const known = locked !== null && locked !== undefined;
  const unlocked = known && locked === false;
  const Icon = unlocked ? BsUnlockFill : BsLockFill;
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
}: {
  base: string;
  overlays: string[];
  darkClassName: string;
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
        alt=""
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

function formatMiles(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value)} mi`;
}

function formatKwh(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value)} kWh`;
}

function formatSpeed(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value)} mph`;
}

function formatFeet(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value * 3.28084).toLocaleString()} ft`;
}

function formatTemp(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value * 9 / 5 + 32)} F`;
}

function formatTire(psi: number | null | undefined, status?: string | null) {
  if (psi !== null && psi !== undefined) return `${Math.round(psi)} psi`;
  return status ? prettify(status) : '-';
}

function formatCharging(chargerState: string | null | undefined, chargerStatus: string | null | undefined) {
  if (chargerStatus === 'chrgr_sts_not_connected') return 'Not charging';
  if (chargerState && !['unknown', 'disconnected'].includes(chargerState.toLowerCase())) return prettify(chargerState);
  if (chargerStatus) return prettify(chargerStatus);
  return 'Not charging';
}

function formatDrive(driveMode: string | null | undefined, gearStatus: string | null | undefined) {
  if (driveMode) return prettifyDriveMode(driveMode);
  return gearStatus ? prettify(gearStatus) : '-';
}

function renderDriverMode(driveMode: string | null | undefined, gearStatus: string | null | undefined) {
  const value = formatDrive(driveMode, gearStatus);
  if (value === 'Unknown') {
    return (
      <Tooltip content="Current sensor status is unknown." align="end">
        <span className="inline-flex items-center justify-end text-fg-tertiary">
          <MdOutlinePendingActions className="h-4 w-4" />
        </span>
      </Tooltip>
    );
  }
  return value;
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
  const map: Record<string, string> = {
    everyday: 'All-Purpose',
    all_purpose: 'All-Purpose',
    sport: 'Sport',
    distance: 'Conserve',
    conserve: 'Conserve',
    winter: 'Snow',
    towing: 'Towing',
    off_road_auto: 'All-Terrain',
    off_road_sand: 'Soft Sand',
    off_road_rocks: 'Rock Crawl',
    off_road_sport_auto: 'Rally',
    off_road_sport_drift: 'Drift',
  };
  return map[value] ?? prettify(value);
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
