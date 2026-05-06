import * as React from 'react';
import { Wifi, WifiOff, Battery, BatteryCharging, BatteryFull, BatteryMedium, BatteryLow, Loader2 } from 'lucide-react';
import { cn, formatMiles } from '../lib/utils';

export type VehicleOnlineState = 'online' | 'offline' | 'connecting' | 'error';

export interface StatusBarProps {
  vehicleName?: string | undefined;
  onlineState: VehicleOnlineState;
  socPercent?: number | undefined;
  isCharging?: boolean | undefined;
  rangeEstimateMi?: number | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
}

function getBatteryIcon(socPercent?: number | undefined, isCharging?: boolean | undefined) {
  if (isCharging) return { Icon: BatteryCharging, variant: 'charging' as const };
  if (socPercent === undefined) return { Icon: Battery, variant: 'unknown' as const };
  if (socPercent >= 80) return { Icon: BatteryFull, variant: 'full' as const };
  if (socPercent >= 30) return { Icon: BatteryMedium, variant: 'medium' as const };
  return { Icon: BatteryLow, variant: 'low' as const };
}

export function StatusBar({
  vehicleName,
  onlineState,
  socPercent,
  isCharging,
  rangeEstimateMi,
  compact = false,
  className,
}: StatusBarProps) {
  const statusLabel = onlineState === 'online'
    ? 'Online'
    : onlineState === 'connecting'
    ? 'Connecting...'
    : onlineState === 'error'
    ? 'Connection failed'
    : 'Offline';
  const { Icon: BatteryIcon, variant: batteryVariant } = getBatteryIcon(socPercent, isCharging);

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-elevated',
        compact && 'justify-center px-2',
        className
      )}
    >
      <div
        className={cn('flex items-center gap-1.5', compact && 'gap-0')}
        title={`Vehicle status: ${statusLabel}`}
        aria-label={`Vehicle status: ${statusLabel}`}
      >
        {onlineState === 'connecting' ? (
          <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
        ) : onlineState === 'online' ? (
          <Wifi className="h-3.5 w-3.5 text-[#10B981]" />
        ) : onlineState === 'error' ? (
          <WifiOff className="h-3.5 w-3.5 text-[#F87171]" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-fg-tertiary" />
        )}
        {!compact && (
          <span
            className={cn(
              'text-xs font-medium',
              onlineState === 'online'
                ? 'text-[#10B981]'
                : onlineState === 'connecting'
                ? 'text-accent'
                : onlineState === 'error'
                ? 'text-[#F87171]'
                : 'text-fg-tertiary'
            )}
          >
            {statusLabel}
          </span>
        )}
      </div>

      {!compact && vehicleName && (
        <span className="text-xs text-fg-tertiary truncate max-w-[120px]">{vehicleName}</span>
      )}

      {socPercent !== undefined && (
        <div
          className={cn('flex items-center gap-1 ml-auto', compact && 'gap-0')}
          title={`Battery status: ${Math.round(socPercent)}%`}
          aria-label={`Battery status: ${Math.round(socPercent)}%`}
          data-battery-variant={batteryVariant}
        >
          <BatteryIcon
            className={cn(
              'h-3.5 w-3.5',
              isCharging
                ? 'text-accent'
                : socPercent > 50
                ? 'text-[#10B981]'
                : socPercent > 20
                ? 'text-[#F59E0B]'
                : 'text-[#F87171]'
            )}
          />
          {!compact && <span className="text-xs font-mono font-medium text-fg">{Math.round(socPercent)}%</span>}
          {!compact && rangeEstimateMi !== undefined && (
            <span className="text-xs text-fg-tertiary">- {formatMiles(rangeEstimateMi)}</span>
          )}
        </div>
      )}
    </div>
  );
}
