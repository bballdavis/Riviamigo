import { useNavigate } from '@tanstack/react-router';
import { StatusBar, ThemeToggle, Tooltip, getBatteryIcon, type VehicleOnlineState } from '@riviamigo/ui/primitives';
import { isVehicleCharging, type VehicleStatus } from '@riviamigo/types';
import { BatteryCharging, CalendarClock, Download, Loader2, LogOut, Settings, TriangleAlert, Wifi, WifiOff } from 'lucide-react';
import type { useThemePreferenceController } from '../../hooks/useThemePreferenceController';
import { RELEASES_URL } from '../../lib/releaseCheck';
import type { RivianCredentialRenewalNotice } from '../../lib/rivianCredentialRenewal';

function CredentialRenewalNotice({
  notice,
  compact = false,
  onClick,
}: {
  notice: RivianCredentialRenewalNotice;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={notice.message}
      aria-label={`${notice.label}. ${notice.message}`}
      className={compact
        ? '-mx-1 flex h-8 w-[calc(100%+0.5rem)] items-center justify-center rounded-lg bg-bg-elevated text-status-warning transition-colors hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
        : 'flex min-h-10 w-full items-center gap-2 rounded-lg bg-bg-elevated px-3 py-2 text-start text-status-warning transition-colors hover:bg-bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'}
    >
      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!compact ? <span className="min-w-0 text-sm font-medium leading-5">{notice.label}</span> : null}
    </button>
  );
}

/** Only rendered when a newer release exists; otherwise the footer has no update affordance. */
function GitHubReleasesLink({
  updateAvailable,
  currentVersion,
  latestVersion,
  size = 'desktop',
}: {
  updateAvailable: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  size?: 'desktop' | 'mobile' | 'collapsed';
}) {
  if (!updateAvailable || !latestVersion) return null;
  const dimensions = size === 'mobile'
    ? 'h-12 w-12'
    : size === 'collapsed'
      ? 'h-8 w-6'
      : 'h-8 w-8';
  const tooltip = (
    <span className="flex flex-col gap-1">
      <span className="font-medium text-status-warning">Update available</span>
      <span className="flex items-center justify-between gap-3">
        <span className="text-fg-tertiary">Current</span>
        <span className="font-mono">{currentVersion && currentVersion !== 'unknown' ? currentVersion : 'Unknown'}</span>
      </span>
      <span className="flex items-center justify-between gap-3">
        <span className="text-fg-tertiary">Latest</span>
        <span className="font-mono text-status-warning">{latestVersion}</span>
      </span>
    </span>
  );
  return (
    <Tooltip content={tooltip} align="end">
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`New release ${latestVersion} available. View GitHub Releases`}
        className={`flex shrink-0 items-center justify-center rounded-lg text-status-warning transition-colors hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${dimensions}`}
      >
        <Download className={`${size === 'desktop' ? 'h-4 w-4' : 'h-5 w-5'} shrink-0`} aria-hidden="true" />
      </a>
    </Tooltip>
  );
}

export interface AppReleaseSummary {
  updateAvailable: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
}

type ThemeController = ReturnType<typeof useThemePreferenceController>;

export interface AppSidebarFooterProps {
  collapsed: boolean;
  mobile: boolean;
  closeMobileNavigation: (restoreFocus?: boolean) => void;
  onlineState: VehicleOnlineState;
  status: VehicleStatus | null | undefined;
  renewalNotice: RivianCredentialRenewalNotice | null;
  release: AppReleaseSummary;
  themeController: ThemeController;
  onSignOut: () => Promise<void>;
}

/** Sidebar footer: vehicle status, credential renewal, settings, sign-out, and theme controls. */
export function AppSidebarFooter({
  collapsed,
  mobile,
  closeMobileNavigation,
  onlineState,
  status,
  renewalNotice,
  release,
  themeController,
  onSignOut,
}: AppSidebarFooterProps) {
  const navigate = useNavigate();
  const compactBatteryLevel =
    typeof status?.battery_level === 'number' ? status.battery_level : undefined;
  const compactIsCharging = isVehicleCharging(status);
  const showCompactBattery = compactBatteryLevel !== undefined && onlineState === 'online';
  const compactBatteryIcon = showCompactBattery
    ? compactIsCharging
      ? { Component: BatteryCharging, variant: 'charging' }
      : getBatteryIcon(compactBatteryLevel)
    : undefined;
  const collapsedFooterRow =
    '-mx-1 grid w-[calc(100%+0.5rem)] grid-cols-[24px_24px] items-center justify-between';
  const collapsedSettingsRow = release.updateAvailable
    ? collapsedFooterRow
    : '-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-center';
  const collapsedStatusRow = compactBatteryIcon
    ? collapsedFooterRow
    : 'flex w-full items-center justify-center';
  const collapsedFooterCell = 'flex h-8 w-6 items-center justify-center';
  if (mobile) {
    return (
      <div className="flex flex-col gap-3">
        {renewalNotice ? (
          <CredentialRenewalNotice
            notice={renewalNotice}
            onClick={() => {
              navigate({ to: '/settings' });
              closeMobileNavigation(false);
            }}
          />
        ) : null}
        <StatusBar
          onlineState={onlineState}
          socPercent={status?.battery_level ?? undefined}
          isCharging={isVehicleCharging(status)}
          rangeEstimateMi={status?.range_miles ?? undefined}
          className="h-12 px-4"
          size="menu"
        />

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              navigate({ to: '/settings' });
              closeMobileNavigation(false);
            }}
            aria-label="Open settings"
            className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-4 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-elevated hover:text-fg"
          >
            <Settings className="h-5 w-5 shrink-0" />
            <span>Settings</span>
          </button>
          <GitHubReleasesLink
            size="mobile"
            updateAvailable={release.updateAvailable}
            currentVersion={release.currentVersion}
            latestVersion={release.latestVersion}
          />
        </div>

        <button
          type="button"
          onClick={async () => {
            closeMobileNavigation(false);
            await onSignOut();
          }}
          aria-label="Sign out"
          className="flex h-12 w-full items-center gap-3 rounded-lg px-4 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-elevated hover:text-fg"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span>Sign out</span>
        </button>
      </div>
    );
  }
  if (collapsed) {
    return (
      <div className="flex w-full flex-col gap-2">
        <div className={collapsedStatusRow} data-collapsed-status-row>
          <div
            className={collapsedFooterCell}
            title={`Vehicle status: ${
              onlineState === 'online'
                ? 'Online'
                : onlineState === 'connecting'
                  ? 'Reconnecting...'
                  : onlineState === 'unhealthy'
                    ? 'Feed unhealthy'
                    : onlineState === 'error'
                      ? 'Connection failed'
                      : 'Offline'
            }`}
            aria-label="Vehicle status"
          >
            {onlineState === 'connecting' ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            ) : onlineState === 'online' ? (
              <Wifi className="h-4 w-4 text-status-positive" />
            ) : onlineState === 'unhealthy' ? (
              <TriangleAlert className="h-4 w-4 text-status-danger" />
            ) : onlineState === 'error' ? (
              <WifiOff className="h-4 w-4 text-status-danger" />
            ) : (
              <WifiOff className="h-4 w-4 text-fg-tertiary" />
            )}
          </div>
          <div
            className={collapsedFooterCell}
            title={
              showCompactBattery
                ? `Battery status: ${Math.round(compactBatteryLevel)}%`
                : 'Battery status unavailable'
            }
            aria-label="Battery status"
          >
            {compactBatteryIcon && (
              <compactBatteryIcon.Component
                className={`h-5 w-5 ${
                  compactBatteryIcon.variant === 'charging'
                    ? 'text-accent'
                    : (compactBatteryLevel ?? 0) > 50
                      ? 'text-status-positive'
                      : (compactBatteryLevel ?? 0) > 20
                        ? 'text-status-warning'
                        : 'text-status-danger'
                }`}
                data-battery-icon={`battery-${compactBatteryIcon.variant}`}
              />
            )}
          </div>
        </div>

        {renewalNotice ? (
          <CredentialRenewalNotice
            compact
            notice={renewalNotice}
            onClick={() => navigate({ to: '/settings' })}
          />
        ) : null}

        <div className={collapsedSettingsRow}>
          <button
            type="button"
            onClick={() => navigate({ to: '/settings' })}
            title="Settings"
            aria-label="Open settings"
            className="flex h-8 w-6 items-center justify-center rounded-lg text-fg-tertiary transition-colors hover:bg-bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Settings className="h-4 w-4 shrink-0" />
          </button>
          <GitHubReleasesLink
            size="collapsed"
            updateAvailable={release.updateAvailable}
            currentVersion={release.currentVersion}
            latestVersion={release.latestVersion}
          />
        </div>

        <div className={collapsedFooterRow}>
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="flex h-8 w-6 items-center justify-center rounded-lg text-fg-tertiary transition-colors hover:bg-bg-elevated hover:text-fg"
          >
            <LogOut className="h-4 w-4 shrink-0" />
          </button>
          <ThemeToggle mode={themeController.mode} onModeChange={themeController.onModeChange} disabled={themeController.isPending} variant="ghost" className="h-8 w-6" iconClassName="h-5 w-5" ariaLabel="Theme options" />
        </div>
      </div>
    );
  }
  return (
      <div className="flex flex-col gap-2">
        {renewalNotice ? (
          <CredentialRenewalNotice
            notice={renewalNotice}
            onClick={() => navigate({ to: '/settings' })}
          />
        ) : null}
        <StatusBar
          onlineState={onlineState}
          socPercent={status?.battery_level ?? undefined}
          isCharging={isVehicleCharging(status)}
          rangeEstimateMi={status?.range_miles ?? undefined}
          compact={collapsed}
        />

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => navigate({ to: '/settings' })}
            title="Settings"
            aria-label="Open settings"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-fg-tertiary transition-colors hover:bg-bg-elevated hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">Settings</span>
          </button>
          <GitHubReleasesLink
            updateAvailable={release.updateAvailable}
            currentVersion={release.currentVersion}
            latestVersion={release.latestVersion}
          />
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-fg-tertiary transition-colors hover:bg-bg-elevated hover:text-fg"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">Sign out</span>
          </button>
          <ThemeToggle mode={themeController.mode} onModeChange={themeController.onModeChange} disabled={themeController.isPending} variant="ghost" className="h-8 w-8" ariaLabel="Theme options" />
        </div>
      </div>
  );
}
