import * as React from 'react';
import { Wifi, WifiOff, Battery, BatteryCharging, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export type VehicleOnlineState = 'online' | 'offline' | 'connecting';

export interface StatusBarProps {
  vehicleName?: string | undefined;
  onlineState: VehicleOnlineState;
  socPercent?: number | undefined;
  isCharging?: boolean | undefined;
  rangeEstimateMi?: number | undefined;
  className?: string | undefined;
}

export function StatusBar({
  vehicleName,
  onlineState,
  socPercent,
  isCharging,
  rangeEstimateMi,
  className,
}: StatusBarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-elevated',
        className
      )}
    >
      {/* Online indicator */}
      <div className="flex items-center gap-1.5">
        {onlineState === 'connecting' ? (
          <Loader2 className="h-3.5 w-3.5 text-accent animate-spin" />
        ) : onlineState === 'online' ? (
          <Wifi className="h-3.5 w-3.5 text-[#10B981]" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-fg-tertiary" />
        )}
        <span className={cn(
          'text-xs font-medium',
          onlineState === 'online' ? 'text-[#10B981]' :
          onlineState === 'connecting' ? 'text-accent' :
          'text-fg-tertiary'
        )}>
          {onlineState === 'online' ? 'Online' : onlineState === 'connecting' ? 'Connecting…' : 'Offline'}
        </span>
      </div>

      {vehicleName && (
        <span className="text-xs text-fg-tertiary truncate max-w-[120px]">{vehicleName}</span>
      )}

      {socPercent !== undefined && (
        <div className="flex items-center gap-1 ml-auto">
          {isCharging ? (
            <BatteryCharging className="h-3.5 w-3.5 text-accent" />
          ) : (
            <Battery className={cn(
              'h-3.5 w-3.5',
              socPercent > 50 ? 'text-[#10B981]' :
              socPercent > 20 ? 'text-[#F59E0B]' :
              'text-[#F87171]'
            )} />
          )}
          <span className="text-xs font-mono font-medium text-fg">
            {Math.round(socPercent)}%
          </span>
          {rangeEstimateMi !== undefined && (
            <span className="text-xs text-fg-tertiary">
              · {Math.round(rangeEstimateMi)} mi
            </span>
          )}
        </div>
      )}
    </div>
  );
}
