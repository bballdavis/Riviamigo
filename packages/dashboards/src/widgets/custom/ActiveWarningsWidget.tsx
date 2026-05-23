import React from 'react';
import { ShieldAlert, Droplets, Wrench, Flame, ZapOff, Bell, CheckCircle2 } from 'lucide-react';
import { useCurrentVehicleStatus } from '@riviamigo/hooks';
import type { VehicleStatus } from '@riviamigo/types';
import { registerWidget } from '../../registry';
import type { WidgetCtx, WidgetInstance } from '../../registry';

// ── Warning definitions ───────────────────────────────────────────────────────

interface Warning {
  key: string;
  label: string;
  icon: React.ReactNode;
  severity: 'error' | 'warn' | 'info';
  active: (s: VehicleStatus) => boolean;
}

const WARNINGS: Warning[] = [
  {
    key: 'brake_fluid',
    label: 'Brake Fluid Low',
    icon: <Droplets className="h-3.5 w-3.5" />,
    severity: 'error',
    active: (s) => (s as any).brake_fluid_low === true,
  },
  {
    key: 'wiper_fluid',
    label: 'Wiper Fluid Low',
    icon: <Droplets className="h-3.5 w-3.5" />,
    severity: 'warn',
    active: (s) => (s as any).wiper_fluid_low === true,
  },
  {
    key: 'alarm',
    label: 'Alarm Active',
    icon: <Bell className="h-3.5 w-3.5" />,
    severity: 'error',
    active: (s) => (s as any).alarm_active === true,
  },
  {
    key: 'charger_derate',
    label: 'Charger Derate',
    icon: <ZapOff className="h-3.5 w-3.5" />,
    severity: 'warn',
    active: (s) => (s as any).charger_derate_active === true,
  },
  {
    key: 'hv_thermal',
    label: 'HV Thermal Event',
    icon: <Flame className="h-3.5 w-3.5" />,
    severity: 'error',
    active: (s) => !!(s.hv_thermal_event && s.hv_thermal_event !== 'none' && s.hv_thermal_event !== 'idle'),
  },
  {
    key: 'service_mode',
    label: 'Service Mode',
    icon: <Wrench className="h-3.5 w-3.5" />,
    severity: 'info',
    active: (s) => (s as any).service_mode === true,
  },
  {
    key: 'tire_pressure',
    label: 'Tire Pressure',
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
    severity: 'warn',
    active: (s) =>
      s.tire_pressure_status != null &&
      s.tire_pressure_status !== 'ok' &&
      s.tire_pressure_status !== 'none',
  },
];

const SEVERITY_COLORS: Record<Warning['severity'], string> = {
  error: 'bg-[#7F1D1D]/20 text-[#F87171] border-[#F87171]/20',
  warn:  'bg-amber-900/20 text-amber-400 border-amber-400/20',
  info:  'bg-blue-900/20 text-blue-400 border-blue-400/20',
};

// ── Component ─────────────────────────────────────────────────────────────────

function ActiveWarningsWidget({
  instance: _instance,
  ctx,
}: {
  instance: WidgetInstance;
  ctx: WidgetCtx;
}) {
  const vehicleId = ctx.vehicleId ?? null;
  const { data: status } = useCurrentVehicleStatus(vehicleId);

  const activeWarnings = status
    ? WARNINGS.filter((w) => w.active(status))
    : [];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldAlert className={`h-4 w-4 ${activeWarnings.length > 0 ? 'text-[#F87171]' : 'text-fg-tertiary'}`} />
        <span className="text-sm font-medium text-fg">Warnings</span>
        {activeWarnings.length > 0 && (
          <span className="rounded-full bg-[#7F1D1D]/30 px-2 py-0.5 text-xs font-medium text-[#F87171]">
            {activeWarnings.length}
          </span>
        )}
      </div>

      {/* Content */}
      {activeWarnings.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <CheckCircle2 className="h-7 w-7 text-[color:var(--rm-status-positive)]" />
          <p className="text-sm font-medium text-[color:var(--rm-status-positive)]">All clear</p>
          <p className="text-xs text-fg-tertiary">No active warnings</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {activeWarnings.map((w) => (
            <div
              key={w.key}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${SEVERITY_COLORS[w.severity]}`}
            >
              <span className="shrink-0">{w.icon}</span>
              <span className="font-medium">{w.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Registry ──────────────────────────────────────────────────────────────────

registerWidget({
  componentType: 'custom',
  definitionId: 'overview.warnings',
  title: 'Active Warnings',
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  defaultOptions: {},
  component: ActiveWarningsWidget,
});
