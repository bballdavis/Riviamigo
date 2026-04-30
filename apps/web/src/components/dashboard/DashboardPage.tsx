import React, { useState } from 'react';
import { useAuth, useCurrentVehicleStatus, useVehicles } from '@riviamigo/hooks';
import { PageLayout, DateRangePicker } from '@riviamigo/ui/primitives';
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
import { Battery, Car, Gauge, Lock, MapPin, PlugZap, Save, Thermometer, Trash2, Edit2, Unlock, DoorOpen, Cpu } from 'lucide-react';

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

function CurrentVehicleStatePanel({ status, images }: { status: VehicleStatus | undefined; images?: VehicleImages | null | undefined }) {
  const batteryLevel = clamp(status?.battery_level ?? 0, 0, 100);
  const overheadLight = images?.overhead?.light ?? images?.overhead?.dark ?? images?.all?.find((image) => image.placement === 'overhead')?.url;
  const overheadDark = images?.overhead?.dark ?? images?.overhead?.light ?? overheadLight;
  const locksKnown = [status?.door_front_left_locked, status?.door_front_right_locked, status?.door_rear_left_locked, status?.door_rear_right_locked]
    .some((value) => value !== null && value !== undefined);
  const tires = {
    fl: formatTire(status?.tire_fl_psi, status?.tire_fl_status),
    fr: formatTire(status?.tire_fr_psi, status?.tire_fr_status),
    rl: formatTire(status?.tire_rl_psi, status?.tire_rl_status),
    rr: formatTire(status?.tire_rr_psi, status?.tire_rr_status),
  };
  const stats = [
    { label: 'Charging', value: formatCharging(status?.charger_state, status?.charger_status), icon: <PlugZap className="h-3.5 w-3.5" /> },
    { label: 'Drive', value: formatDrive(status?.drive_mode, status?.gear_status), icon: <Car className="h-3.5 w-3.5" /> },
    { label: 'Altitude', value: formatFeet(status?.altitude_m), icon: <MapPin className="h-3.5 w-3.5" /> },
    { label: 'Cabin', value: formatTemp(status?.cabin_temp_c), icon: <Thermometer className="h-3.5 w-3.5" /> },
    { label: 'Speed', value: formatSpeed(status?.speed_mph), icon: <Gauge className="h-3.5 w-3.5" /> },
    { label: 'Software', value: formatSoftware(status), icon: <Cpu className="h-3.5 w-3.5" /> },
  ];

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
      <div className="grid gap-4 xl:grid-cols-[15rem_minmax(20rem,1fr)_18rem]">
        <div className="rounded-2xl border border-accent/25 bg-accent/10 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.16em] text-fg-tertiary">SoC</span>
            <Battery className="h-4 w-4 text-accent" />
          </div>
          <div className="flex items-end gap-3">
            <div className="relative h-28 w-14 overflow-hidden rounded-xl border border-accent/40 bg-bg-surface">
              <div className="absolute inset-x-1 bottom-1 rounded-lg bg-accent transition-all" style={{ height: `${batteryLevel}%` }} />
            </div>
            <div>
              <p className="font-mono text-4xl font-semibold tabular-nums text-fg">{formatPercent(status?.battery_level)}</p>
              <p className="mt-1 text-sm text-fg-secondary">{formatMiles(status?.range_miles)} range</p>
              <p className="mt-2 text-xs text-fg-tertiary">Limit {formatPercent(status?.battery_limit)}</p>
            </div>
          </div>
        </div>

        <div className="relative min-h-56 rounded-2xl border border-border bg-bg-surface/70 p-4">
          <div className="absolute left-3 top-3 rounded-full border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-tertiary">
            Tires {formatTire(status?.tire_min_psi, status?.tire_pressure_status)}
          </div>
          <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-tertiary">
            {status?.doors_locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            {locksKnown ? (status?.doors_locked ? 'Locked' : 'Unlocked') : 'Locks pending'}
          </div>

          <VehicleLabel className="left-[18%] top-[27%]" value={tires.fl} />
          <VehicleLabel className="right-[18%] top-[27%]" value={tires.fr} />
          <VehicleLabel className="left-[18%] bottom-[18%]" value={tires.rl} />
          <VehicleLabel className="right-[18%] bottom-[18%]" value={tires.rr} />
          <LockLabel className="left-[32%] top-[20%]" locked={status?.door_front_left_locked} />
          <LockLabel className="right-[32%] top-[20%]" locked={status?.door_front_right_locked} />
          <LockLabel className="left-[32%] bottom-[18%]" locked={status?.door_rear_left_locked} />
          <LockLabel className="right-[32%] bottom-[18%]" locked={status?.door_rear_right_locked} />

          <div className="flex h-full items-center justify-center px-8 py-8">
            {overheadLight || overheadDark ? (
              <>
                {overheadLight && <img src={overheadLight} alt="" className="max-h-48 w-full rotate-90 object-contain dark:hidden" />}
                {overheadDark && <img src={overheadDark} alt="" className="hidden max-h-48 w-full rotate-90 object-contain dark:block" />}
              </>
            ) : (
              <div className="flex h-28 w-64 items-center justify-center rounded-[2rem] border border-dashed border-border bg-bg-elevated text-fg-tertiary">
                <Car className="h-10 w-10" />
              </div>
            )}
          </div>
          {(status?.open_closures?.length ?? 0) > 0 && (
            <div className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-200">
              <DoorOpen className="h-3 w-3" />
              {status?.open_closures?.join(', ')}
            </div>
          )}
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

function VehicleLabel({ className, value }: { className: string; value: string }) {
  return <span className={`absolute rounded-lg border border-border bg-bg-elevated/90 px-2 py-1 font-mono text-[11px] text-fg shadow-sm ${className}`}>{value}</span>;
}

function LockLabel({ className, locked }: { className: string; locked: boolean | null | undefined }) {
  const known = locked !== null && locked !== undefined;
  const Icon = locked ? Lock : Unlock;
  return (
    <span className={`absolute inline-flex h-6 w-6 items-center justify-center rounded-full border ${known ? 'border-border bg-bg-elevated text-fg' : 'border-border bg-bg-elevated/60 text-fg-tertiary'} ${className}`}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value)}%`;
}

function formatMiles(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${Math.round(value)} mi`;
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

function formatSoftware(status: VehicleStatus | undefined) {
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
