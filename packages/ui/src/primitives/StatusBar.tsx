import * as React from 'react';
import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Loader2,
  TriangleAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn, formatMiles } from '../lib/utils';

export type VehicleOnlineState = 'online' | 'offline' | 'connecting' | 'unhealthy' | 'error';

export interface StatusBarProps {
  vehicleName?: string | undefined;
  onlineState: VehicleOnlineState;
  socPercent?: number | undefined;
  isCharging?: boolean | undefined;
  rangeEstimateMi?: number | undefined;
  compact?: boolean | undefined;
  size?: 'default' | 'menu' | undefined;
  className?: string | undefined;
}

/** Lucide offers three fill levels, so charge is bucketed into thirds plus a critical warning. */
export function getBatteryIcon(socPercent: number) {
  if (socPercent > 66) return { Component: BatteryFull, variant: 'full' };
  if (socPercent > 33) return { Component: BatteryMedium, variant: 'medium' };
  if (socPercent > 10) return { Component: BatteryLow, variant: 'low' };
  return { Component: BatteryWarning, variant: 'critical' };
}

export function StatusBar({
  vehicleName,
  onlineState,
  socPercent,
  isCharging,
  rangeEstimateMi,
  compact = false,
  size = 'default',
  className,
}: StatusBarProps) {
  const batteryIcon =
    socPercent !== undefined
      ? isCharging
        ? { Component: BatteryCharging, variant: 'charging' }
        : getBatteryIcon(socPercent)
      : undefined;
  const statusLabel =
    onlineState === 'online'
      ? 'Online'
      : onlineState === 'connecting'
        ? 'Reconnecting...'
        : onlineState === 'unhealthy'
          ? 'Feed unhealthy'
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
          <Loader2 className={cn(size === 'menu' ? 'h-5 w-5' : 'h-4 w-4', 'shrink-0 text-accent animate-spin')} />
        ) : onlineState === 'online' ? (
          <Wifi className={cn(size === 'menu' ? 'h-5 w-5' : 'h-4 w-4', 'shrink-0 text-status-positive')} />
        ) : onlineState === 'unhealthy' ? (
          <TriangleAlert className={cn(size === 'menu' ? 'h-5 w-5' : 'h-4 w-4', 'shrink-0 text-status-danger')} />
        ) : onlineState === 'error' ? (
          <WifiOff className={cn(size === 'menu' ? 'h-5 w-5' : 'h-4 w-4', 'shrink-0 text-status-danger')} />
        ) : (
          <WifiOff className={cn(size === 'menu' ? 'h-5 w-5' : 'h-4 w-4', 'shrink-0 text-fg-tertiary')} />
        )}
        {!compact && (
          <span
            className={cn(
              'text-sm font-medium',
              onlineState === 'online'
                ? 'text-status-positive'
                : onlineState === 'connecting'
                  ? 'text-accent'
                  : onlineState === 'unhealthy'
                    ? 'text-status-danger'
                    : onlineState === 'error'
                      ? 'text-status-danger'
                      : 'text-fg-tertiary'
            )}
          >
            {statusLabel}
          </span>
        )}
      </div>

      {!compact && vehicleName && (
        <span className="text-sm font-medium text-fg-tertiary truncate max-w-[120px]">{vehicleName}</span>
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
                size === 'menu' ? 'h-6 w-6' : 'h-5 w-5',
                'relative top-px',
                'shrink-0',
                isCharging
                  ? 'text-accent'
                  : socPercent > 50
                    ? 'text-status-positive'
                    : socPercent > 20
                      ? 'text-status-warning'
                      : 'text-status-danger'
              )}
              data-battery-icon={`battery-${batteryIcon.variant}`}
            />
          )}
          {!compact && (
            <span className="text-sm font-medium tabular-nums">
              <span className="text-fg">{Math.round(socPercent)}%</span>
              {rangeEstimateMi !== undefined && (
                <span className="text-fg-tertiary">({formatMiles(rangeEstimateMi).replace(' ', '')})</span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
