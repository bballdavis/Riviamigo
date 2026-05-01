import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Sidebar, StatusBar, AmbientOrbs, ThemeToggle } from '@riviamigo/ui/primitives';
import { getUnitSystem } from '@riviamigo/ui/lib/utils';
import { useAuth } from '@riviamigo/hooks';
import { useVehicleStatus } from '@riviamigo/hooks';
import { LogOut, Settings } from 'lucide-react';

interface AppLayoutProps {
  children: React.ReactNode;
  activeKey: string;
}

export function AppLayout({ children, activeKey }: AppLayoutProps) {
  const navigate = useNavigate();
  const { accessToken, defaultVehicleId, logout } = useAuth();
  const { status, connected, connectionState } = useVehicleStatus(defaultVehicleId, accessToken);
  const [unitSystem, setUnitSystem] = React.useState(() => getUnitSystem());

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
        bottomSlot={({ collapsed }) => (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => navigate({ to: '/settings' })}
              title="Settings"
              aria-label="Open settings"
              className={
                collapsed
                  ? 'w-full flex items-center justify-center py-2 rounded-lg text-fg-secondary hover:text-fg hover:bg-bg-elevated transition-colors'
                  : 'w-full flex items-center gap-2 px-2 py-2 rounded-lg text-fg-secondary hover:text-fg hover:bg-bg-elevated transition-colors'
              }
            >
              <Settings className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="text-xs font-medium">Settings</span>}
            </button>

            <StatusBar
              onlineState={onlineState}
              socPercent={status?.battery_level ?? undefined}
              isCharging={status?.charger_state?.toLowerCase().includes('charging') ?? false}
              rangeEstimateMi={status?.range_miles ?? undefined}
              compact={collapsed}
            />

            <div className={collapsed ? 'flex items-center justify-between' : 'flex items-center justify-between'}>
              <button
                type="button"
                onClick={handleLogout}
                title="Sign out"
                aria-label="Sign out"
                className="flex items-center justify-center w-8 h-8 rounded-lg text-fg-tertiary hover:text-fg hover:bg-bg-elevated transition-colors duration-150"
              >
                <LogOut className="h-4 w-4" />
              </button>
              <ThemeToggle />
            </div>
          </div>
        )}
      />

      {/* Main content: offset by sidebar width on lg+ */}
      <main className="lg:pl-64 transition-all duration-200">
        <div className="p-4 sm:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
