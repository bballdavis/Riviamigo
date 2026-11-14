import React, { useEffect, useRef, useState } from 'react';
import { Battery, Car, CheckCircle2, CircleAlert, Gauge, LocateFixed, Lock, Maximize2, Minimize2, Package, PackageOpen, TriangleAlert, Unlock } from 'lucide-react';
import { PiPlugsConnectedFill, PiPlugsFill } from 'react-icons/pi';
import { AuthenticatedVehicleArtwork, resolveVehicleArtwork, useAuth, useCurrentVehicleStatus, useUpdateOverviewMapExpanded, useUpdateOverviewView, useUserPreferences, useVehicles, useVehicleArtwork } from '@riviamigo/hooks';
import { formatMiles } from '@riviamigo/ui/lib/utils';
import { DEFAULT_TARGET_TIRE_PRESSURE_PSI, formatTireLabel, getTireHealthLegend, getTireHealthTone, tireHealthBorderClass } from '@riviamigo/ui/lib/vehicleTires';
import { AssistantWave, FrunkIcon, LiftgateIcon, Tooltip } from '@riviamigo/ui/primitives';
import { isVehicleCharging } from '@riviamigo/types';
import type { VehicleImages, VehicleStatus } from '@riviamigo/types';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';
import { isVehiclePluggedIn } from '../../dashboardVisibility';
import { getDoorOverlayUrls, getOpenDoorStates } from './imageUtils';
import { resolveOverviewStatIds } from './overviewStats';
import { getOverviewStatRequirements, presentOverviewStat, type OverviewStatData } from './overviewStatDisplay';
import { useOverviewStatData, useUnitPreferencesVersion } from './useOverviewStatData';
import { resolveOverviewMapOptions, resolveVehicleFacingDeg, type OverviewMapOptions, type OverviewView } from './overviewMap';
import { OverviewLocationMap } from './OverviewLocationMap';
import { createMapFrameSource, OverviewDriveWave } from './OverviewDriveWave';

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

// Rivian's real R2 overview render has more empty canvas behind the tailgate
// than the R1 renders, so the shared 4% rear-gate anchor leaves a visibly wider
// gap than the frunk anchor has at the front. Pull it in to match; the other
// anchors already sit on their parts. Not used for the packaged fallback art.
const R2_REAL_ARTWORK_ANCHORS: AnchorSet = {
  ...SHARED_OVERVIEW_ANCHORS,
  rearGateLock: 'left-[8.8%] top-1/2',
};

const OVERVIEW_ANCHORS: Record<string, AnchorSet> = {
  default: SHARED_OVERVIEW_ANCHORS,
  R1T: {
    ...SHARED_OVERVIEW_ANCHORS,
    sideBinLeftCover: 'left-[36%] top-[24%]',
    sideBinRightCover: 'left-[36%] top-[76%]',
  },
  R1S: SHARED_OVERVIEW_ANCHORS,
  R2: SHARED_OVERVIEW_ANCHORS,
  R2S: SHARED_OVERVIEW_ANCHORS,
};

// Grid columns for the three-column tiers. Each set is chosen whole, since
// conflicting utilities at the same breakpoint resolve by stylesheet order.
const DEFAULT_LAYOUT_COLUMNS = '@min-[34rem]/overview:grid-cols-[11.25rem_minmax(0,1fr)_8.75rem] @min-[58rem]/overview:grid-cols-[16rem_minmax(22rem,1fr)_18rem]';
// The SoC column shrinks to its battery rail (rail width plus panel padding)
// and the map column takes the freed width; the vehicle column keeps `1fr`.
const EXPANDED_LAYOUT_COLUMNS = '@min-[34rem]/overview:grid-cols-[3.75rem_minmax(0,1fr)_16.25rem] @min-[58rem]/overview:grid-cols-[5.75rem_minmax(22rem,1fr)_28.25rem]';
// The map canvas always keeps the expanded map column's width (the last
// track above) and sits centered in its panel, which clips the overflow.
// Expanding then only reveals more of a map that is already drawn, instead of
// resizing and redrawing the WebGL canvas on every frame of the transition.
const MAP_CANVAS_WIDTH = 'w-full @min-[34rem]/overview:w-[16.25rem] @min-[58rem]/overview:w-[28.25rem]';
// Edge overlays drawn by the map (its credits) shift in by the clipped
// overflow so they stay inside the panel. `100cqw` is the panel's width.
const MAP_CANVAS_STYLE = { '--rm-map-overlay-inset-x': 'calc((100% - 100cqw) / 2)' } as React.CSSProperties;
const SOC_DEFAULT_COLUMNS = '@min-[34rem]/overview:grid-cols-[2.25rem_minmax(0,1fr)] @min-[58rem]/overview:grid-cols-[3.75rem_minmax(0,1fr)]';
const SOC_RAIL_ONLY_COLUMNS = '@min-[34rem]/overview:grid-cols-[minmax(0,1fr)]';

function OverviewVehicleWidget({ instance, ctx }: { instance: WidgetInstance; ctx: WidgetCtx }) {
  const { defaultVehicleId } = useAuth();
  const vehicleId = ctx.vehicleId ?? defaultVehicleId;
  const { data: status } = useCurrentVehicleStatus(vehicleId);
  const { data: vehicles } = useVehicles();
  const activeVehicle = vehicles?.find((vehicle) => vehicle.id === vehicleId);
  const statIds = resolveOverviewStatIds(instance.options?.stats);
  const statData = useOverviewStatData(statIds, vehicleId ?? null);
  useUnitPreferencesVersion();
  // The cluster/map choice and the map's expansion are saved to the account so
  // they follow the user across sessions and devices. Local copies keep the
  // controls instant while a save is in flight or if it fails.
  const preferences = useUserPreferences().data;
  const savedView = preferences?.overview_view === 'map' ? 'map' : 'cluster';
  const savedMapExpanded = preferences?.overview_map_expanded === true;
  const updateOverviewView = useUpdateOverviewView();
  const updateOverviewMapExpanded = useUpdateOverviewMapExpanded();
  const [chosenView, setChosenView] = useState<OverviewView | null>(null);
  const [chosenMapExpanded, setChosenMapExpanded] = useState<boolean | null>(null);
  const changeView = (next: OverviewView) => {
    setChosenView(next);
    updateOverviewView.mutate(next);
  };
  const changeMapExpanded = (next: boolean) => {
    setChosenMapExpanded(next);
    updateOverviewMapExpanded.mutate(next);
  };

  return (
    <CurrentVehicleStatePanel
      status={status}
      images={activeVehicle?.images}
      vehicleName={activeVehicle?.display_name}
      vehicleModel={activeVehicle?.model}
      isDemoVehicle={activeVehicle?.is_demo ?? activeVehicle?.rivian_vehicle_id?.startsWith('demo-') ?? false}
      targetTirePressurePsi={activeVehicle?.target_tire_pressure_psi}
      statIds={statIds}
      statData={statData}
      mapOptions={resolveOverviewMapOptions(instance.options)}
      view={chosenView ?? savedView}
      onViewChange={changeView}
      mapExpanded={chosenMapExpanded ?? savedMapExpanded}
      onMapExpandedChange={changeMapExpanded}
    />
  );
}

export function CurrentVehicleStatePanel({
  status,
  images,
  vehicleName,
  vehicleModel,
  isDemoVehicle = false,
  targetTirePressurePsi,
  statIds,
  statData,
  mapOptions,
  view: controlledView,
  onViewChange,
  mapExpanded: controlledMapExpanded,
  onMapExpandedChange,
}: {
  status: VehicleStatus | null | undefined;
  images?: VehicleImages | null | undefined;
  vehicleName?: string | undefined;
  vehicleModel?: string | undefined;
  isDemoVehicle?: boolean;
  targetTirePressurePsi?: number | null | undefined;
  /** Saved `stats` option: which sensors fill the five stat rows. Defaults apply when absent. */
  statIds?: unknown;
  /** Metric and summary values for rows that read more than live vehicle status. */
  statData?: OverviewStatData;
  /** Location map settings. Omitted or disabled, the panel offers no cluster/map toggle. */
  mapOptions?: OverviewMapOptions | undefined;
  /** Controlled cluster/map view (the widget saves it per user); uncontrolled starts on the cluster. */
  view?: OverviewView | undefined;
  onViewChange?: ((view: OverviewView) => void) | undefined;
  /** Controlled map expansion (the widget saves it per user); uncontrolled starts collapsed. */
  mapExpanded?: boolean | undefined;
  onMapExpandedChange?: ((expanded: boolean) => void) | undefined;
}) {
  const [uncontrolledView, setUncontrolledView] = useState<OverviewView>('cluster');
  const view = controlledView ?? uncontrolledView;
  const setView = (next: OverviewView) => {
    if (onViewChange) onViewChange(next);
    else setUncontrolledView(next);
  };
  const mapAvailable = mapOptions?.enabled === true;
  const showMap = mapAvailable && view === 'map';
  const [uncontrolledMapExpanded, setUncontrolledMapExpanded] = useState(false);
  const mapExpandedPreference = controlledMapExpanded ?? uncontrolledMapExpanded;
  const setMapExpanded = (next: boolean) => {
    if (onMapExpandedChange) onMapExpandedChange(next);
    else setUncontrolledMapExpanded(next);
  };
  // Expansion only applies while the map is showing; the cluster always uses
  // the normal three-column layout, and the map reopens at the saved size.
  const mapExpanded = showMap && mapExpandedPreference;
  const batteryLevel = clamp(status?.battery_level ?? 0, 0, 100);
  const resolvedOverhead = resolveVehicleArtwork(images, vehicleModel, 'overview');
  const baseOverheadLight = resolvedOverhead.light;
  const baseOverheadDark = resolvedOverhead.dark;
  const apiOverheadFallback = baseOverheadLight ?? baseOverheadDark;
  const localOverheadFallback = resolvedOverhead.fallback;
  const overheadArtworkAvailable = Boolean(apiOverheadFallback ?? localOverheadFallback);
  const isR2RealArtwork = (vehicleModel === 'R2' || vehicleModel === 'R2S') && !isDemoVehicle && Boolean(apiOverheadFallback);
  const anchors = isR2RealArtwork
    ? R2_REAL_ARTWORK_ANCHORS
    : OVERVIEW_ANCHORS[vehicleModel ?? ''] ?? SHARED_OVERVIEW_ANCHORS;
  const openDoorStates = getOpenDoorStates(status);
  const overlaysLight = getDoorOverlayUrls(images?.all, openDoorStates, 'light');
  const overlaysDark = getDoorOverlayUrls(images?.all, openDoorStates, 'dark');
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const [locationPanelRef, locationPanelHeight] = useObservedHeight();
  const [mapFrames] = useState(createMapFrameSource);
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
  const stats = resolveOverviewStatIds(statIds).map((id) => ({ id, ...presentOverviewStat(id, status, statData) }));
  const rearGateLock = vehicleModel === 'R1T'
    ? status?.closure_tailgate_locked
    : status?.closure_liftgate_locked ?? status?.closure_tailgate_locked;
  const rearGateLockTitle = vehicleModel === 'R1T' ? 'Tailgate lock' : 'Rear gate lock';
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
      className="@container/overview flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border p-4 shadow-sm"
      style={{ background: 'var(--rm-bg-surface)' }}
    >
      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-tertiary">Vehicle overview</p>
        <div className="flex items-center gap-2">
          {mapAvailable ? <OverviewViewToggle view={view} onChange={setView} /> : null}
        </div>
      </div>
      {/* Tiers follow the widget's own width, not the viewport: the dashboard
          gives this widget a fixed-height cell from 640px up, so every tier
          that can appear there must keep all three regions on one row. The
          stacked tier only renders in auto-height cells (phones), and the
          vertical overflow guard keeps a narrow custom layout scrollable
          rather than silently clipped. */}
      <div
        data-testid="overview-layout"
        data-map-expanded={mapExpanded || undefined}
        className={`grid flex-1 min-h-0 content-stretch gap-4 overflow-y-auto transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none @min-[34rem]/overview:-mx-4 @min-[34rem]/overview:gap-3 @min-[58rem]/overview:gap-4 ${mapExpanded ? EXPANDED_LAYOUT_COLUMNS : DEFAULT_LAYOUT_COLUMNS}`}
      >
        <div
          data-testid="overview-soc-panel"
          data-collapsed={mapExpanded || undefined}
          className={`grid min-h-60 grid-cols-[3.75rem_minmax(0,1fr)] gap-4 rounded-2xl border p-4 @min-[34rem]/overview:min-h-0 @min-[34rem]/overview:rounded-l-none @min-[34rem]/overview:border-l-0 @min-[34rem]/overview:gap-3 @min-[34rem]/overview:p-3 @min-[58rem]/overview:min-h-60 @min-[58rem]/overview:gap-4 @min-[58rem]/overview:p-4 ${mapExpanded ? SOC_RAIL_ONLY_COLUMNS : SOC_DEFAULT_COLUMNS}`}
          style={{
            backgroundColor: 'color-mix(in srgb, var(--rm-accent) 8%, var(--rm-bg-surface))',
            borderColor: 'color-mix(in srgb, var(--rm-accent) 28%, var(--rm-border-default))',
          }}
        >
          <div
            className="relative h-full min-h-48 overflow-hidden rounded-2xl border bg-bg-surface @min-[34rem]/overview:min-h-0"
            style={{ borderColor: 'color-mix(in srgb, var(--rm-accent) 32%, var(--rm-border-default))' }}
          >
            <div
              data-testid="overview-soc-rail"
              role="img"
              aria-label={`State of charge ${formatPercent(status?.battery_level)}`}
              title={mapExpanded ? `SoC ${formatPercent(status?.battery_level)}` : undefined}
              className="absolute inset-1 flex items-end overflow-hidden rounded-xl p-1"
            >
              <div
                data-testid="overview-soc-fill"
                className="h-full w-full rounded-lg transition-[clip-path]"
                style={{
                  background: 'linear-gradient(to top, var(--rm-status-danger) 0%, var(--rm-chart-rose) 10%, var(--rm-chart-orange) 20%, var(--rm-chart-amber) 32%, var(--rm-chart-amber) 42%, var(--rm-chart-emerald) 62%, var(--rm-status-positive) 78%, var(--rm-status-positive) 100%)',
                  clipPath: `inset(${100 - batteryLevel}% 0 0 round 0.5rem)`,
                }}
              />
            </div>
            <Battery className="absolute left-1/2 top-3 h-4 w-4 -translate-x-1/2 text-fg/80" />
          </div>
          <div
            data-testid="overview-soc-details"
            className={`min-w-0 flex-col justify-between gap-4 @min-[34rem]/overview:gap-3 @min-[58rem]/overview:gap-4 ${mapExpanded ? 'flex @min-[34rem]/overview:hidden' : 'flex'}`}
          >
            <div>
              <span className="text-xs uppercase tracking-[0.16em] text-fg-tertiary">SoC</span>
              <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-fg @min-[34rem]/overview:text-3xl @min-[58rem]/overview:text-4xl">{formatPercent(status?.battery_level)}</p>
            </div>
            <div className="grid gap-2 text-sm @min-[34rem]/overview:gap-1.5 @min-[58rem]/overview:gap-2">
              <SocDatum label="Range" value={formatMiles(status?.range_miles)} />
              <SocDatum label="Limit" value={formatPercent(status?.battery_limit)} />
              <SocDatum label="Charging" value={<ChargingGlyph status={status} />} />
              {isCharging(status) ? (
                <SocDatum label="To Limit" value={formatTimeToFull(status?.time_to_end_of_charge_min)} />
              ) : null}
            </div>
          </div>
        </div>
        <div ref={imageStageRef} data-testid="overview-image-stage" className="relative min-h-60 overflow-hidden rounded-2xl border border-border bg-bg-surface/70 p-1 @min-[34rem]/overview:min-h-0 @min-[58rem]/overview:min-h-60">
          <div className="absolute right-3 top-3 z-30 inline-flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg-tertiary shadow-sm backdrop-blur">
            {status?.doors_locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3 text-accent" />}
            {locksKnown ? (status?.doors_locked ? 'Locked' : 'Unlocked') : 'Locks pending'}
          </div>
          <div className="absolute inset-1 z-10 flex items-center justify-center">
            {overheadArtworkAvailable ? (
              <VehicleArtFrame source={apiOverheadFallback} fallbackSource={localOverheadFallback} heightPx={imageStageHeight} widthPx={imageStageWidth}>
                <VehicleOverheadLayers base={baseOverheadLight ?? apiOverheadFallback} fallbackBase={localOverheadFallback} overlays={overlaysLight} darkClassName="dark:hidden" vehicleName={vehicleName} isR1tFallback={vehicleModel === 'R1T'} />
                <VehicleOverheadLayers base={baseOverheadDark ?? apiOverheadFallback} fallbackBase={localOverheadFallback} overlays={overlaysDark} darkClassName="hidden dark:block" isR1tFallback={vehicleModel === 'R1T'} />
                <VehicleLabel className={anchors.tire.rl} value={tires.rl.value} tone={tires.rl.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <VehicleLabel className={anchors.tire.fl} value={tires.fl.value} tone={tires.fl.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <VehicleLabel className={anchors.tire.rr} value={tires.rr.value} tone={tires.rr.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <VehicleLabel className={anchors.tire.fr} value={tires.fr.value} tone={tires.fr.tone} targetTirePressurePsi={targetTirePressurePsi} />
                <LockLabel className={anchors.doorLocks.rl} locked={status?.door_rear_left_locked} title="Rear left door lock" />
                <LockLabel className={anchors.doorLocks.fl} locked={status?.door_front_left_locked} title="Front left door lock" />
                <LockLabel className={anchors.doorLocks.rr} locked={status?.door_rear_right_locked} title="Rear right door lock" />
                <LockLabel className={anchors.doorLocks.fr} locked={status?.door_front_right_locked} title="Front right door lock" />
                {vehicleModel === 'R1T' ? (
                  <LockLabel className={anchors.rearGateLock} locked={rearGateLock} title={rearGateLockTitle} />
                ) : (
                  <ClosureLabel className={anchors.rearGateLock} closed={status?.closure_liftgate_closed} locked={status?.closure_liftgate_locked} title="Liftgate" icon={LiftgateIcon} description="The rear hatch that opens upward for cargo access." />
                )}
                <ClosureLabel className={anchors.frunkLock} closed={status?.closure_frunk_closed} locked={status?.closure_frunk_locked} title="Frunk" icon={FrunkIcon} description="The front trunk under the hood." />
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
        {showMap && mapOptions ? (
          <div
            ref={locationPanelRef}
            data-testid="overview-location-panel"
            className={`@container relative overflow-hidden rounded-xl border border-border bg-bg-surface @min-[34rem]/overview:min-h-0 @min-[34rem]/overview:rounded-r-none @min-[34rem]/overview:border-r-0 ${mapExpanded ? 'min-h-96' : 'min-h-60'}`}
          >
            <button
              type="button"
              data-testid="overview-map-expand"
              aria-label={mapExpanded ? 'Collapse map' : 'Expand map'}
              aria-pressed={mapExpanded}
              title={mapExpanded ? 'Collapse map' : 'Expand map'}
              onClick={() => setMapExpanded(!mapExpanded)}
              className="absolute right-0 top-0 z-20 inline-flex h-11 w-11 items-center justify-center rounded-bl-xl border-b border-l border-border/60 bg-bg-elevated/50 text-accent backdrop-blur-sm transition-colors hover:bg-bg-elevated/85 focus-visible:bg-bg-elevated/85 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent @min-[34rem]/overview:h-8 @min-[34rem]/overview:w-8 @min-[34rem]/overview:rounded-bl-lg"
            >
              {mapExpanded ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
            </button>
            <div data-testid="overview-map-canvas" className={`absolute inset-y-0 left-1/2 min-w-full -translate-x-1/2 ${MAP_CANVAS_WIDTH}`} style={MAP_CANVAS_STYLE}>
              <OverviewLocationMap
                latitude={status?.latitude}
                longitude={status?.longitude}
                headingDeg={resolveVehicleFacingDeg(status)}
                artwork={resolvedOverhead}
                options={mapOptions}
                heightPx={locationPanelHeight - 2}
                onRenderFrame={mapFrames.publish}
              />
            </div>
            <OverviewDriveWave status={status} mapFrames={mapFrames} />
          </div>
        ) : (
        <div data-testid="overview-stats" className="grid auto-rows-fr gap-2 @min-[34rem]/overview:gap-1.5 @min-[58rem]/overview:gap-2">
          {stats.map((stat) => (
            <div
              key={stat.id}
              className="flex min-h-10 min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-bg-surface px-3 py-2 text-sm @min-[34rem]/overview:min-h-0 @min-[34rem]/overview:rounded-r-none @min-[34rem]/overview:border-r-0 @min-[34rem]/overview:flex-col @min-[34rem]/overview:items-start @min-[34rem]/overview:justify-center @min-[34rem]/overview:gap-0.5 @min-[34rem]/overview:px-2.5 @min-[34rem]/overview:py-1.5 @min-[58rem]/overview:min-h-10 @min-[58rem]/overview:flex-row @min-[58rem]/overview:items-center @min-[58rem]/overview:justify-between @min-[58rem]/overview:gap-3 @min-[58rem]/overview:px-3 @min-[58rem]/overview:py-2"
            >
              <span className="inline-flex min-w-0 max-w-full items-center gap-2 truncate text-fg-tertiary @min-[34rem]/overview:gap-1.5 @min-[34rem]/overview:text-[11px] @min-[58rem]/overview:gap-2 @min-[58rem]/overview:text-sm">
                {stat.icon}
                <span className="truncate">{stat.label}</span>
              </span>
              <span
                className="max-w-full shrink-0 truncate font-mono font-medium tabular-nums text-fg"
                title={typeof stat.value === 'string' ? stat.value : undefined}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>
        )}
      </div>
    </section>
  );
}

/** Tracks an element's border-box height through a callback ref, so it also works for elements that mount later. */
function useObservedHeight(): [(element: HTMLDivElement | null) => void, number] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const update = () => setHeight(element.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, height];
}

const OVERVIEW_VIEW_CHOICES: ReadonlyArray<{ value: OverviewView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'cluster', label: 'Vehicle cluster', icon: Gauge },
  { value: 'map', label: 'Current location map', icon: LocateFixed },
];

function OverviewViewToggle({ view, onChange }: { view: OverviewView; onChange: (view: OverviewView) => void }) {
  return (
    <div role="group" aria-label="Overview view" className="inline-flex h-11 items-center gap-0.5 rounded-lg border border-border bg-bg-elevated p-0.5 @min-[34rem]/overview:h-8">
      {OVERVIEW_VIEW_CHOICES.map(({ value, label, icon: Icon }) => {
        const selected = view === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={selected}
            title={label}
            onClick={() => onChange(value)}
            className={`inline-flex h-full w-10 items-center @min-[34rem]/overview:w-7 justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
              selected ? 'border-accent/60 bg-accent/10 text-accent' : 'border-transparent text-fg-tertiary hover:text-fg'
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

function SocDatum({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-10 min-w-0 items-center justify-between gap-2 rounded-lg border border-accent/15 bg-bg-surface/55 px-3 py-2 leading-none @min-[34rem]/overview:min-h-0 @min-[34rem]/overview:flex-col @min-[34rem]/overview:items-start @min-[34rem]/overview:gap-1 @min-[34rem]/overview:px-2.5 @min-[34rem]/overview:py-1.5 @min-[58rem]/overview:min-h-10 @min-[58rem]/overview:flex-row @min-[58rem]/overview:items-center @min-[58rem]/overview:gap-2 @min-[58rem]/overview:px-3 @min-[58rem]/overview:py-2">
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

function ClosureLabel({ className, closed, locked, title, icon, description }: {
  className: string;
  closed: boolean | null | undefined;
  locked?: boolean | null | undefined;
  title: string;
  icon?: React.ComponentType<{ className?: string }> | undefined;
  description?: string | undefined;
}) {
  const known = closed !== null && closed !== undefined;
  const open = known && closed === false;
  const Icon = icon ?? (open ? PackageOpen : Package);
  const stateLabel = known ? (open ? 'open' : 'closed') : 'unavailable';
  // Custom closure glyphs carry more detail than the stock icons, so they get a larger badge.
  const size = icon ? 'h-9 w-9' : 'h-6 w-6';
  const tone = open
    ? icon ? 'border-status-danger bg-status-danger text-fg-on-accent' : 'border-accent/60 bg-bg-elevated/90 text-accent'
    : known ? 'border-status-positive/60 bg-bg-elevated/90 text-status-positive' : 'border-border bg-bg-elevated/60 text-fg-tertiary';
  const badge = (
    <span
      role="img"
      aria-label={`${title}: ${stateLabel}`}
      tabIndex={icon ? 0 : undefined}
      className={`inline-flex ${size} items-center justify-center rounded-full border shadow-sm backdrop-blur focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${tone}`}
    >
      <Icon className={icon ? 'h-6 w-6' : 'h-3.5 w-3.5'} />
    </span>
  );
  const positioned = `absolute z-30 -translate-x-1/2 -translate-y-1/2 ${className}`;
  if (!icon) {
    return (
      <span
        title={`${title}: ${stateLabel}`}
        className={`${positioned} inline-flex ${size} items-center justify-center rounded-full border shadow-sm backdrop-blur ${tone}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
    );
  }
  const meaning = !known
    ? 'No report from the vehicle yet.'
    : open
      ? `Open. Close it before driving.`
      : 'Closed and secure.';
  const lockKnown = locked !== null && locked !== undefined;
  return (
    <Tooltip
      className={positioned}
      contentClassName="w-60 rounded-xl border-border/80 bg-bg-elevated/95 px-3 py-3 text-xs shadow-2xl backdrop-blur"
      content={(
        <div className="space-y-1.5" data-testid="closure-tooltip">
          <div className="flex items-center gap-2 font-medium text-fg">
            <span
              className={`inline-block h-2 w-2 rounded-full ${open ? 'bg-status-danger' : known ? 'bg-status-positive' : 'bg-fg-tertiary'}`}
              aria-hidden="true"
            />
            {title} {stateLabel}
          </div>
          <p className="text-fg-secondary">{description} {meaning}</p>
          {lockKnown ? (
            <p className="flex items-center gap-1.5 text-fg-tertiary">
              {locked ? <Lock className="h-3 w-3" aria-hidden="true" /> : <Unlock className="h-3 w-3" aria-hidden="true" />}
              {locked ? 'Locked' : 'Unlocked'}
            </p>
          ) : null}
        </div>
      )}
    >
      {badge}
    </Tooltip>
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
  // Wait for the real artwork rather than flashing the packaged fallback; the
  // fallback is only for vehicles whose own artwork is missing or broken.
  const loading = artwork.isLoading;
  const frameArtworkSrc = loading ? null : artwork.src ?? fallbackArtwork.src;
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
  // The compact tier's stage can be narrower than 260px; a larger floor would
  // size the frame past the stage and clip the vehicle.
  const maxWidth = widthPx > 0 ? Math.max(160, (widthPx - 34) / 1.04) : 520;
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
      {loading ? (
        <div className="absolute inset-0 flex items-center">
          <AssistantWave label="Loading vehicle picture" />
        </div>
      ) : frameArtworkSrc ? children : null}
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
}: {
  base: string | null | undefined;
  fallbackBase?: string | null | undefined;
  overlays: string[];
  darkClassName: string;
  vehicleName?: string | undefined;
  isR1tFallback: boolean;
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
      // The shared rear/front lock anchors sit at 4% and 102%. Center the
      // packaged fallback at their midpoint whenever it is displayed, for real
      // and demo vehicles alike, leaving Rivian artwork and all annotations on
      // their established coordinates.
      left: '53%',
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
  return isVehicleCharging(status);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
        <p className="text-sm font-medium text-fg">Target: {targetTirePressurePsi ?? DEFAULT_TARGET_TIRE_PRESSURE_PSI} psi</p>
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
  dataRequirements: (instance) => getOverviewStatRequirements(resolveOverviewStatIds(instance.options?.stats)),
  component: OverviewVehicleWidget,
});
