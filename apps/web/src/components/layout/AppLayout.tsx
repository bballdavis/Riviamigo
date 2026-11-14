import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Sidebar,
  ThemeToggle,
  AmbientOrbs,
  DEFAULT_NAV_ITEMS,
  type NavItem,
} from '@riviamigo/ui/primitives';
import { getUnitSystem } from '@riviamigo/ui/lib/utils';
import {
  useAuth,
  useCurrentVehicleStatus,
  useMe,
  useOwnershipEnabled,
  useResolvedVehicleSelection,
  useVehicleStatus,
} from '@riviamigo/hooks';
import { UserCog } from 'lucide-react';
import { GiRestingVampire } from 'react-icons/gi';
import { TbCarSuv } from 'react-icons/tb';
import { FaTruckPickup } from 'react-icons/fa6';
import { emitToast } from '../feedback/toast';
import { useThemePreferenceController } from '../../hooks/useThemePreferenceController';
import { useGithubReleaseCheck } from '../../hooks/useGithubReleaseCheck';
import { getRivianCredentialRenewalNotice } from '../../lib/rivianCredentialRenewal';
import { AppSidebarFooter, type AppReleaseSummary } from './AppSidebarFooter';
import {
  getFeedHealthIssue,
  resolveVehicleOnlineState,
  shouldEmitFeedHealthToast,
} from './vehicleFeedHealth';

export {
  getFeedHealthIssue,
  resolveVehicleOnlineState,
  shouldEmitFeedHealthToast,
} from './vehicleFeedHealth';

interface AppLayoutProps {
  children: React.ReactNode;
  activeKey: string;
}

export function AppLayout({ children, activeKey }: AppLayoutProps) {
  const releaseCheck = useGithubReleaseCheck();
  const navigate = useNavigate();
  const accessToken = useAuth((s) => s.accessToken);
  const logout = useAuth((s) => s.logout);
  const { effectiveVehicleId, vehicleSelectionReady, vehicles } = useResolvedVehicleSelection();
  const me = useMe();
  const canAccessUsers = me.data?.role === 'admin' || me.data?.role === 'super_user';
  // A user who turned Ownership off in Settings no longer sees it in the navigation.
  const ownershipEnabled = useOwnershipEnabled();
  const liveVehicleId = vehicleSelectionReady ? effectiveVehicleId : null;
  const liveAccessToken = vehicleSelectionReady ? accessToken : null;
  const {
    status: liveStatus,
    connected,
    connectionState,
  } = useVehicleStatus(liveVehicleId, liveAccessToken);
  const { data: currentStatus } = useCurrentVehicleStatus(liveVehicleId);
  const status = currentStatus ?? liveStatus;
  const themeController = useThemePreferenceController();
  const [unitSystem, setUnitSystem] = React.useState(() => getUnitSystem());
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('rm-sidebar-collapsed') === 'true';
  });

  const setPersistedSidebarCollapsed = React.useCallback((nextCollapsed: boolean) => {
    setSidebarCollapsed(nextCollapsed);
    localStorage.setItem('rm-sidebar-collapsed', String(nextCollapsed));
  }, []);

  // Stable reference so both addEventListener and removeEventListener receive the
  // same function identity even if React re-renders between the two calls.
  const handleUnitsChange = React.useCallback(() => {
    setUnitSystem(getUnitSystem());
  }, []);

  const feedHealthIssue = getFeedHealthIssue(currentStatus);
  const renewalNotice = getRivianCredentialRenewalNotice(currentStatus);
  React.useEffect(() => {
    if (!liveVehicleId || !feedHealthIssue || !connected) return;

    const storageKey = `rm-feed-health-toast:${liveVehicleId}:${feedHealthIssue.key}`;
    const emitIfDue = () => {
      if (!shouldEmitFeedHealthToast(localStorage, storageKey)) return;
      emitToast({
        title: feedHealthIssue.title,
        message: feedHealthIssue.message,
        variant: 'error',
      });
    };

    emitIfDue();
    const interval = window.setInterval(emitIfDue, 60_000);
    return () => window.clearInterval(interval);
  }, [
    connected,
    feedHealthIssue?.key,
    feedHealthIssue?.message,
    feedHealthIssue?.title,
    liveVehicleId,
  ]);

  React.useEffect(() => {
    window.addEventListener('rm-units-change', handleUnitsChange as EventListener);
    window.addEventListener('storage', handleUnitsChange);
    return () => {
      window.removeEventListener('rm-units-change', handleUnitsChange as EventListener);
      window.removeEventListener('storage', handleUnitsChange);
    };
  }, [handleUnitsChange]);

  const onlineState = resolveVehicleOnlineState({
    liveVehicleId,
    vehicleSelectionReady,
    connectionState,
    connected,
    feedHealthIssue,
  });
  const releaseSummary: AppReleaseSummary = {
    updateAvailable: releaseCheck.updateAvailable,
    currentVersion: releaseCheck.version.data?.version ?? null,
    latestVersion: releaseCheck.status.latestVersion,
  };
  const sidebarItems = React.useMemo<NavItem[]>(() => {
    const firstVehicleModel = vehicles[0]?.model?.toUpperCase() ?? '';
    const overviewIcon = firstVehicleModel.includes('R1T') ? (
      <FaTruckPickup className="h-[1.125rem] w-[1.125rem]" />
    ) : (
      <TbCarSuv className="h-[1.125rem] w-[1.125rem]" />
    );
    const inBatterySection = activeKey === 'battery' || activeKey.startsWith('battery.');
    return DEFAULT_NAV_ITEMS.filter((item) => item.key !== 'ownership' || ownershipEnabled).map((item) => {
      if (item.key === 'dashboard') {
        return {
          ...item,
          icon: overviewIcon,
        };
      }
      if (item.key !== 'battery' || !inBatterySection) return item;
      return {
        ...item,
        children: [
          {
            key: 'battery.phantom-drain',
            label: 'Phantom Drain',
            href: '/battery/phantom-drain',
            icon: <GiRestingVampire className="h-3.5 w-3.5" />,
          },
        ],
      };
    }).concat(
      canAccessUsers
        ? [
            {
              key: 'users',
              label: 'Users',
              href: '/users',
              icon: <UserCog className="h-[1.125rem] w-[1.125rem]" />,
              pinToBottom: true,
            },
          ]
        : []
    );
  }, [activeKey, vehicles, canAccessUsers, ownershipEnabled]);

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
        items={sidebarItems}
        mobileHeaderSlot={<ThemeToggle mode={themeController.mode} onModeChange={themeController.onModeChange} disabled={themeController.isPending} variant="ghost" className="h-11 w-11" ariaLabel="Theme options" />}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setPersistedSidebarCollapsed}
        bottomSlot={(footer) => (
          <AppSidebarFooter
            {...footer}
            onlineState={onlineState}
            status={status}
            renewalNotice={renewalNotice}
            release={releaseSummary}
            themeController={themeController}
            onSignOut={handleLogout}
          />
        )}
      />

      {/* Main content: offset by sidebar width on lg+ */}
      <main
        className={`rm-app-main transition-all duration-200 ${sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-64'}`}
        style={{ '--rm-content-inset-left': sidebarCollapsed ? '72px' : '16rem' } as React.CSSProperties}
      >
        <div className="rm-app-content p-4 pt-14 sm:p-6 sm:pt-14 lg:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
