import * as React from 'react';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { TbBattery1, TbBattery2, TbBattery3, TbBattery4, TbBatteryCharging, TbBatteryOff } from 'react-icons/tb';
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

function getBatteryIcon(socPercent: number) {
  if (socPercent > 75) return { Component: TbBattery4, variant: 'four' };
  if (socPercent > 50) return { Component: TbBattery3, variant: 'three' };
  if (socPercent > 25) return { Component: TbBattery2, variant: 'two' };
  if (socPercent > 5) return { Component: TbBattery1, variant: 'one' };
  return { Component: TbBatteryOff, variant: 'off' };
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
  const batteryIcon = socPercent !== undefined
    ? isCharging
      ? { Component: TbBatteryCharging, variant: 'charging' }
      : getBatteryIcon(socPercent)
    : undefined;
  const statusLabel = onlineState === 'online'
    ? 'Online'
    : onlineState === 'connecting'
    ? 'Connecting...'
    : onlineState === 'error'
    ? 'Connection failed'
    : 'Offline';

  const showBattery = socPercent !== undefined && onlineState === 'online';
  const shouldCenterConnection = compact && !showBattery;

  return (
    <div
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 rounded-lg',
        compact && 'justify-between px-2',
        shouldCenterConnection && 'justify-center',
        className
      )}
    >
      <div
        className={cn('flex items-center gap-1.5', compact && 'gap-0')}
        title={`Vehicle status: ${statusLabel}`}
        aria-label={`Vehicle status: ${statusLabel}`}
      >
        {onlineState === 'connecting' ? (
          <Loader2 className="h-4 w-4 text-accent animate-spin" />
        ) : onlineState === 'online' ? (
          <Wifi className="h-4 w-4 text-[#10B981]" />
        ) : onlineState === 'error' ? (
          <WifiOff className="h-4 w-4 text-[#F87171]" />
        ) : (
          <WifiOff className="h-4 w-4 text-fg-tertiary" />
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

      {showBattery && (
        <div
          className={cn('flex items-center gap-1 ml-auto', compact && 'gap-0')}
          title={`Battery status: ${Math.round(socPercent)}%`}
          aria-label={`Battery status: ${Math.round(socPercent)}%`}
        >
          {batteryIcon && (
            <batteryIcon.Component
              className={cn(
                'h-[1.44375rem] w-[1.44375rem]',
                isCharging
                  ? 'text-accent'
                  : socPercent > 50
                  ? 'text-[#10B981]'
                  : socPercent > 20
                  ? 'text-[#F59E0B]'
                  : 'text-[#F87171]'
              )}
              data-battery-icon={`tb-battery-${batteryIcon.variant}`}
            />
          )}
          {!compact && <span className="text-xs font-mono font-medium text-fg">{Math.round(socPercent)}%</span>}
          {!compact && rangeEstimateMi !== undefined && (
            <span className="text-xs text-fg-tertiary">- {formatMiles(rangeEstimateMi)}</span>
          )}
        </div>
      )}
    </div>
  );
}
