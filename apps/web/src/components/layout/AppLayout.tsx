import React from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { Sidebar, StatusBar, AmbientOrbs, ThemeToggle } from '@riviamigo/ui/primitives';
import { useAuth } from '@riviamigo/hooks';
import { useVehicleStatus } from '@riviamigo/hooks';

interface AppLayoutProps {
  children: React.ReactNode;
  activeKey: string;
}

export function AppLayout({ children, activeKey }: AppLayoutProps) {
  const navigate = useNavigate();
  const { accessToken, defaultVehicleId } = useAuth();
  const { status, connected } = useVehicleStatus(defaultVehicleId, accessToken);

  const onlineState = !defaultVehicleId
    ? 'offline' as const
    : connected
    ? 'online' as const
    : 'connecting' as const;

  return (
    <div className="min-h-screen bg-bg-page text-fg">
      <AmbientOrbs />

      <Sidebar
        activeKey={activeKey}
        onNavigate={(href) => navigate({ to: href })}
        bottomSlot={
          <div className="flex flex-col gap-2">
            <StatusBar
              onlineState={onlineState}
              socPercent={status?.battery_level ?? undefined}
              isCharging={status?.charger_state === 'Charging'}
              rangeEstimateMi={status?.range_miles ?? undefined}
            />
            <ThemeToggle />
          </div>
        }
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
