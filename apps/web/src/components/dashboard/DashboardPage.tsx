import React, { useState } from 'react';
import { useAuth, useCurrentVehicleStatus } from '@riviamigo/hooks';
import { PageLayout, DateRangePicker } from '@riviamigo/ui/primitives';
import {
  DashboardRenderer,
  useDashboardBySlug,
  useUpdateDashboard,
  getDefaultBySlug,
} from '@riviamigo/dashboards';
import type { DashboardConfig } from '@riviamigo/dashboards';
import { AppLayout } from '../layout/AppLayout';
import { AuthGuard } from '../layout/AuthGuard';
import { NoVehicleState } from '../layout/NoVehicleState';
import { presetToRange, rangeToIso, DEFAULT_PRESET, type PresetKey } from '../../lib/dates';
import { Activity, Battery, Car, Gauge, Lock, MapPin, PlugZap, Save, ShieldCheck, Thermometer, Trash2, Edit2 } from 'lucide-react';

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
              <CurrentStatusChips status={currentStatus} />
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

function CurrentStatusChips({ status }: { status: ReturnType<typeof useCurrentVehicleStatus>['data'] }) {
  const chips = [
    { label: 'SoC', value: formatPercent(status?.battery_level), icon: <Battery className="h-3.5 w-3.5" />, tone: 'accent' },
    { label: 'Range', value: formatMiles(status?.range_miles), icon: <Activity className="h-3.5 w-3.5" /> },
    { label: 'Charging', value: prettify(status?.charger_state ?? status?.charger_status), icon: <PlugZap className="h-3.5 w-3.5" /> },
    { label: 'Drive', value: prettify(status?.drive_mode ?? status?.gear_status), icon: <Car className="h-3.5 w-3.5" /> },
    { label: 'Altitude', value: formatFeet(status?.altitude_m), icon: <MapPin className="h-3.5 w-3.5" /> },
    { label: 'Cabin', value: formatTemp(status?.cabin_temp_c), icon: <Thermometer className="h-3.5 w-3.5" /> },
    { label: 'Speed', value: formatSpeed(status?.speed_mph), icon: <Gauge className="h-3.5 w-3.5" /> },
    { label: 'Locks', value: status?.doors_locked === null || status?.doors_locked === undefined ? 'Not captured' : status.doors_locked ? 'Locked' : 'Unlocked', icon: <Lock className="h-3.5 w-3.5" />, muted: status?.doors_locked === null || status?.doors_locked === undefined },
    { label: 'Tires', value: status?.tire_pressure_status ?? 'Not captured', icon: <ShieldCheck className="h-3.5 w-3.5" />, muted: !status?.tire_pressure_status },
    { label: 'Software', value: status?.software_update_status ?? 'Not captured', icon: <ShieldCheck className="h-3.5 w-3.5" />, muted: !status?.software_update_status },
  ];

  return (
    <section className="mb-4 rounded-2xl border border-border bg-bg-surface/80 p-3 shadow-lg shadow-black/10">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-fg-tertiary">Current vehicle state</p>
          <p className="text-xs text-fg-tertiary">Live telemetry-backed chips, with unsupported fields called out.</p>
        </div>
        <span className="rounded-full border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-tertiary">
          {status?.last_updated ? `Updated ${new Date(status.last_updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Awaiting telemetry'}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={chip.label}
            className={[
              'inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs',
              chip.tone === 'accent'
                ? 'border-accent/30 bg-accent/10 text-accent'
                : chip.muted
                ? 'border-border bg-bg-elevated/50 text-fg-tertiary'
                : 'border-border bg-bg-elevated text-fg-secondary',
            ].join(' ')}
          >
            {chip.icon}
            <span className="text-fg-tertiary">{chip.label}</span>
            <span className="font-mono font-medium tabular-nums text-fg">{chip.value}</span>
          </span>
        ))}
      </div>
    </section>
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

function prettify(value: string | null | undefined) {
  if (!value) return '-';
  return value.replace(/^chrgr_sts_/, '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
