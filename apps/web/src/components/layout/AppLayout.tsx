import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Sidebar, StatusBar, AmbientOrbs, ThemeToggle } from '@riviamigo/ui/primitives';
import { getUnitSystem } from '@riviamigo/ui/lib/utils';
import { useAuth, useCurrentVehicleStatus, useVehicleStatus } from '@riviamigo/hooks';
import { Loader2, LogOut, Settings, Wifi, WifiOff } from 'lucide-react';
import { TbBattery1, TbBattery2, TbBattery3, TbBattery4, TbBatteryCharging, TbBatteryOff } from 'react-icons/tb';

interface AppLayoutProps {
  children: React.ReactNode;
  activeKey: string;
}

function getCompactBatteryIcon(socPercent: number) {
  if (socPercent > 75) return { Component: TbBattery4, variant: 'four' };
  if (socPercent > 50) return { Component: TbBattery3, variant: 'three' };
  if (socPercent > 25) return { Component: TbBattery2, variant: 'two' };
  if (socPercent > 5) return { Component: TbBattery1, variant: 'one' };
  return { Component: TbBatteryOff, variant: 'off' };
}

export function AppLayout({ children, activeKey }: AppLayoutProps) {
  const navigate = useNavigate();
  const { accessToken, defaultVehicleId, logout } = useAuth();
  const { status: liveStatus, connected, connectionState } = useVehicleStatus(defaultVehicleId, accessToken);
  const { data: currentStatus } = useCurrentVehicleStatus(defaultVehicleId);
  const status = currentStatus ?? liveStatus;
  const [unitSystem, setUnitSystem] = React.useState(() => getUnitSystem());
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('rm-sidebar-collapsed') === 'true';
  });

  const setPersistedSidebarCollapsed = React.useCallback((nextCollapsed: boolean) => {
    setSidebarCollapsed(nextCollapsed);
    localStorage.setItem('rm-sidebar-collapsed', String(nextCollapsed));
  }, []);

  // Fire a single reauth warning toast when the vehicle worker signals it needs
  // re-authentication.  The ref prevents the same toast firing more than once
  // per page session even if the status keeps polling.
  const reauthToastFired = React.useRef(false);
  React.useEffect(() => {
    if (currentStatus?.auth_state === 'needs_reauth' && !reauthToastFired.current) {
      reauthToastFired.current = true;
      window.dispatchEvent(
        new CustomEvent('riviamigo:toast', {
          detail: {
            title: 'Rivian re-authentication required',
            message:
              'Your Rivian session has expired. Go to Settings → Vehicle to reconnect.',
            variant: 'warning',
          },
        })
      );
    }
    // Reset so the toast can refire if the vehicle recovers and expires again.
    if (currentStatus?.auth_state !== 'needs_reauth') {
      reauthToastFired.current = false;
    }
  }, [currentStatus?.auth_state]);

  React.useEffect(() => {
    const handleUnitsChange = () => setUnitSystem(getUnitSystem());
    window.addEventListener('rm-units-change', handleUnitsChange as EventListener);
    window.addEventListener('storage', handleUnitsChange);
    return () => {
      window.removeEventListener('rm-units-change', handleUnitsChange as EventListener);
      window.removeEventListener('storage', handleUnitsChange);
    };
  }, []);

  const onlineState = !defaultVehicleId
    ? 'offline' as const
    : connectionState === 'failed'
    ? 'error' as const
    : connected
    ? 'online' as const
    : 'connecting' as const;
  const compactBatteryLevel = typeof status?.battery_level === 'number' ? status.battery_level : undefined;
  const compactIsCharging = status?.charger_state?.toLowerCase().includes('charging') ?? false;
  const showCompactBattery = compactBatteryLevel !== undefined && onlineState === 'online';
  const compactBatteryIcon = showCompactBattery
    ? compactIsCharging
      ? { Component: TbBatteryCharging, variant: 'charging' }
      : getCompactBatteryIcon(compactBatteryLevel)
    : undefined;
  const collapsedFooterRow = '-mx-1 grid w-[calc(100%+0.5rem)] grid-cols-[24px_24px] items-center justify-between';
  const collapsedFooterCell = 'flex h-8 w-6 items-center justify-center';

  async function handleLogout() {
    await logout();
    navigate({ to: '/login' });
  }

  return (
    <div className="min-h-screen bg-bg-page text-fg" data-unit-system={unitSystem}>
      <AmbientOrbs />

      <Sidebar
        activeKey={activeKey}
        onNavigate={(href) => navigate({ to: href })}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setPersistedSidebarCollapsed}
        bottomSlot={({ collapsed }) => {
          if (collapsed) {
            return (
              <div className="w-full flex flex-col gap-2">
                <div className={collapsedFooterRow}>
                  <div
                    className={collapsedFooterCell}
                    title={`Vehicle status: ${
                      onlineState === 'online'
                        ? 'Online'
                        : onlineState === 'connecting'
                        ? 'Connecting...'
                        : onlineState === 'error'
                        ? 'Connection failed'
                        : 'Offline'
                    }`}
                    aria-label="Vehicle status"
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
                  </div>
                  <div
                    className={collapsedFooterCell}
                    title={showCompactBattery ? `Battery status: ${Math.round(compactBatteryLevel)}%` : 'Battery status unavailable'}
                    aria-label="Battery status"
                  >
                    {compactBatteryIcon && (
                      <compactBatteryIcon.Component
                        className={`h-[1.44375rem] w-[1.44375rem] ${
                          compactBatteryIcon.variant === 'charging'
                            ? 'text-accent'
                            : (compactBatteryLevel ?? 0) > 50
                            ? 'text-[#10B981]'
                            : (compactBatteryLevel ?? 0) > 20
                            ? 'text-[#F59E0B]'
                            : 'text-[#F87171]'
                        }`}
                        data-battery-icon={`tb-battery-${compactBatteryIcon.variant}`}
                      />
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => navigate({ to: '/settings' })}
                  title="Settings"
                  aria-label="Open settings"
                  className="-mx-1 flex h-8 w-[calc(100%+0.5rem)] items-center justify-center rounded-lg text-fg-tertiary hover:text-fg hover:bg-bg-elevated transition-colors"
                >
                  <Settings className="h-4 w-4 shrink-0" />
                </button>

                <div className={collapsedFooterRow}>
                  <button
                    type="button"
                    onClick={handleLogout}
                    title="Sign out"
                    aria-label="Sign out"
                    className="flex h-8 w-6 items-center justify-center rounded-lg text-fg-tertiary hover:text-fg hover:bg-bg-elevated transition-colors"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                  </button>
                  <ThemeToggle className="w-6" />
                </div>
              </div>
            );
          }

          return (
            <div className="flex flex-col gap-2">
              <StatusBar
                onlineState={onlineState}
                socPercent={status?.battery_level ?? undefined}
                isCharging={status?.charger_state?.toLowerCase().includes('charging') ?? false}
                rangeEstimateMi={status?.range_miles ?? undefined}
                compact={collapsed}
              />

              <button
                type="button"
                onClick={() => navigate({ to: '/settings' })}
                title="Settings"
                aria-label="Open settings"
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-fg-tertiary hover:text-fg hover:bg-bg-elevated transition-colors"
              >
                <Settings className="h-4 w-4 shrink-0" />
                <span className="text-xs font-medium">Settings</span>
              </button>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign out"
                  aria-label="Sign out"
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-fg-tertiary hover:text-fg hover:bg-bg-elevated transition-colors"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  <span className="text-xs font-medium">Sign out</span>
                </button>
                <ThemeToggle />
              </div>
            </div>
          );
        }}
      />

      {/* Main content: offset by sidebar width on lg+ */}
      <main className={`rm-app-main transition-all duration-200 ${sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-64'}`}>
        <div className="rm-app-content p-4 pt-14 sm:p-6 sm:pt-14 lg:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
