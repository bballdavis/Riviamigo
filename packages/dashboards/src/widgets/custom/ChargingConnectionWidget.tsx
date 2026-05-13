import React from 'react';
import { Car, Zap } from 'lucide-react';
import { PiPlugsFill } from 'react-icons/pi';
import { useAuth, useChargingSummary, useCurrentVehicleStatus, useVehicles } from '@riviamigo/hooks';
import { formatKwh, formatNumber, formatPercent as formatDashboardPercent } from '@riviamigo/ui/lib/utils';
import type { VehicleStatus } from '@riviamigo/types';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';
import { findBestChargingSideOverlay, findFirstSideImage, findSideChargingImage } from './imageUtils';

const CHARGING_SIDE_LIGHT_IMAGE_URL = '/vehicle-images/r1s-side-charging-light.png';

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

function ChargingConnectionWidget({
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
  const forceShow = options.forceShow === true;
  const visible = pluggedIn || forceShow;
  const charging = forceShow || isActivelyCharging(status);
  const timeToFull = forceShow ? 95 : status?.time_to_end_of_charge_min;
  const snapshot = summary as ChargingSummarySnapshot | undefined;
  const sideLight = activeVehicle?.images?.side?.light ?? findFirstSideImage(activeVehicle?.images?.all, 'light');
  const sideDark = activeVehicle?.images?.side?.dark ?? findFirstSideImage(activeVehicle?.images?.all, 'dark');
  const sideFallback = sideLight ?? sideDark ?? findFirstSideImage(activeVehicle?.images?.all);
  const chargingSideLight =
    findSideChargingImage(activeVehicle?.images?.all, 'light') ??
    findBestChargingSideOverlay(activeVehicle?.images?.all, 'light') ??
    CHARGING_SIDE_LIGHT_IMAGE_URL;
  const chargingSideDark =
    findSideChargingImage(activeVehicle?.images?.all, 'dark') ??
    findBestChargingSideOverlay(activeVehicle?.images?.all, 'dark') ??
    chargingSideLight;
  const idleSideLight = sideLight ?? sideFallback;
  const idleSideDark = sideDark ?? idleSideLight;
  const activeSideLight = charging ? chargingSideLight : idleSideLight;
  const activeSideDark = charging ? chargingSideDark : idleSideDark;
  const activeImageMode = charging ? 'side-charging' : 'side';
  const rows = [
    {
      label: 'Status',
      value: charging ? 'Charging' : 'Standby',
      accent: charging,
    },
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
    {
      label: 'Full In',
      value: formatTimeToFull(timeToFull),
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
      data-charging-state={charging ? 'charging' : 'standby'}
      data-image-mode={activeImageMode}
      data-image-light={activeSideLight ?? ''}
      data-image-dark={activeSideDark ?? ''}
      className="relative h-full min-h-0 overflow-hidden rounded-2xl border border-border bg-[linear-gradient(135deg,var(--rm-bg-surface),var(--rm-bg-elevated))] shadow-lg shadow-black/10"
    >
      <div className="absolute inset-0 flex items-stretch justify-end">
        {charging ? (
          <>
            <VehicleSideImage source={chargingSideLight} mode="charging" darkClassName="dark:hidden" />
            <VehicleSideImage source={chargingSideDark} mode="charging" darkClassName="hidden dark:block" />
          </>
        ) : idleSideLight ? (
          <>
            <VehicleSideImage source={idleSideLight} mode="side" darkClassName="dark:hidden" />
            <VehicleSideImage source={idleSideDark ?? idleSideLight} mode="side" darkClassName="hidden dark:block" />
          </>
        ) : (
          <div className="mr-4 flex h-full w-2/3 items-center justify-center rounded-2xl border border-dashed border-border bg-bg-elevated text-fg-tertiary">
            <Car className="h-10 w-10" />
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-y-0 left-0 w-[62%] bg-gradient-to-r from-bg via-bg/82 to-transparent" />

      <div className="absolute left-4 top-4 z-10 grid w-[40%] min-w-[180px] max-w-[260px] gap-2 pb-[12%]">
        {rows.map((row) => (
          <ChargingSummaryRow key={row.label} label={row.label} value={row.value} accent={row.accent === true} />
        ))}
      </div>

      <ChargingBatteryLedBar level={status?.battery_level} charging={charging} />
    </section>
  );
}

function ChargingSummaryRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/70 px-3 py-2 text-xs"
    >
      <span className={`inline-flex min-w-0 items-center gap-2 truncate text-fg-tertiary`}>
        {accent ? <Zap className="h-3.5 w-3.5 shrink-0" /> : null}
        {label}
      </span>
      <span className={`shrink-0 font-mono font-medium tabular-nums ${accent ? 'text-accent' : 'text-fg'}`}>{value}</span>
    </div>
  );
}

function ChargingBatteryLedBar({
  level,
  charging,
}: {
  level: number | null | undefined;
  charging: boolean;
}) {
  const normalizedLevel = Math.max(0, Math.min(100, level ?? 0));
  const activeSegments = Math.round(normalizedLevel / 5);
  const segmentCount = 20;
  const segmentGapPx = 2;
  const segmentWidth = `calc((100% - ${segmentGapPx * (segmentCount - 1)}px) / ${segmentCount})`;
  const segmentGridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${segmentCount}, ${segmentWidth})`,
    gap: segmentGapPx,
    height: '100%',
  } as React.CSSProperties;

  return (
    <div
      data-testid="charging-battery-led-bar"
      aria-label={`Battery ${Math.round(normalizedLevel)} percent`}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 14,
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      <div style={{ position: 'relative', height: '100%', overflow: 'visible' }}>
        <div
          data-testid="charging-battery-led-segments"
          style={segmentGridStyle}
        >
          {Array.from({ length: 20 }, (_, index) => {
            const filled = index < activeSegments;
            return (
              <span
                key={index}
                data-testid="charging-battery-led-segment"
                data-filled={filled ? 'true' : 'false'}
                style={{
                  display: 'block',
                  height: '100%',
                  borderRadius: 4,
                  backgroundColor: filled ? '#16a34a' : 'rgba(161, 161, 170, 0.82)',
                  boxShadow: filled ? '0 0 10px rgba(22, 163, 74, 0.72)' : 'none',
                }}
              />
            );
          })}
        </div>
        {charging ? (
          <div
            data-testid="charging-battery-led-sweep"
            className="charging-led-sweep"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              display: 'block',
              width: segmentWidth,
            }}
          >
            <span
              style={{
                display: 'block',
                height: '100%',
                width: '100%',
                borderRadius: 4,
                backgroundColor: '#22c55e',
                boxShadow: '0 0 16px rgba(34, 197, 94, 0.82)',
              }}
            />
          </div>
        ) : null}
      </div>
      <style>{`
        @keyframes charging-led-sweep {
          0% { left: 0; }
          100% { left: calc(100% - ${segmentWidth}); }
        }

        .charging-led-sweep {
          animation: charging-led-sweep 14.25s steps(19, end) infinite;
        }
      `}</style>
    </div>
  );
}

function VehicleSideImage({
  source,
  mode,
  darkClassName,
}: {
  source: string;
  mode: 'side' | 'charging';
  darkClassName: string;
}) {
  const transform = mode === 'charging' ? 'translateX(-12%) scale(1.05)' : 'translateX(-5%) scale(1.15)';
  const objectPosition = mode === 'charging' ? 'left center' : 'right center';

  return (
    <div className={`absolute inset-y-0 right-0 flex h-full w-full items-center justify-end ${darkClassName}`}>
      <img
        src={source}
        alt=""
        data-testid="charging-side-image"
        data-image-mode={mode}
        className="h-full w-auto max-w-none object-contain"
        style={{ objectPosition, transform, transformOrigin: mode === 'charging' ? 'left center' : 'right center' }}
      />
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

registerWidget({
  componentType: 'custom',
  definitionId: 'charging.connection',
  title: 'Charging Connection',
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 5, h: 5 },
  defaultOptions: { forceShow: false },
  component: ChargingConnectionWidget,
});
