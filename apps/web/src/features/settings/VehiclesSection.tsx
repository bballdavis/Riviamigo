import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys, useAuth } from '@riviamigo/hooks';
import type { Vehicle } from '@riviamigo/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Tooltip } from '@riviamigo/ui/primitives';
import { Car, Pause, Pencil, Play, Plus, RefreshCw, RotateCcw, Star, Trash2, Users } from 'lucide-react';
import { formatRivianRenewalDate, getRivianCredentialRenewalNotice } from '../../lib/rivianCredentialRenewal';
import { useSettingsLeaveGuard } from './drafts/SettingsDraftProvider';
import { saveFailure } from './drafts/saveFailure';
import { ThemeVehicleImage, formatMembershipRole, membershipBadgeVariant } from './vehicleSettingsDisplay';
import { VehicleBatteryEditor } from './VehicleBatteryEditor';
import { VehicleConfirmDialogs } from './VehicleConfirmDialogs';
import { VehicleSharingPanel } from './VehicleSharingPanel';

export interface VehiclesSectionProps {
  vehicles: Vehicle[] | undefined;
  defaultVehicleId: string | null | undefined;
  currentUserId: string | undefined;
  isAdmin: boolean;
  canCreateDemoVehicle: boolean;
  /** Held by the page so the token survives switching sections, as before. */
  latestInviteToken: string | null;
  onLatestInviteTokenChange: (token: string | null) => void;
}

/** Vehicle list with defaults, artwork, collection pause, editing, sharing, and deletion. */
export function VehiclesSection({
  vehicles,
  defaultVehicleId,
  currentUserId,
  isAdmin,
  canCreateDemoVehicle,
  latestInviteToken,
  onLatestInviteTokenChange,
}: VehiclesSectionProps) {
  const requestLeave = useSettingsLeaveGuard();
  const { setDefaultVehicleId, setActiveVehicleId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editingBatteryVehicleId, setEditingBatteryVehicleId] = React.useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = React.useState('');
  const [demoRefreshConfirmId, setDemoRefreshConfirmId] = React.useState<string | null>(null);
  const closeDelete = () => { setDeleteConfirmId(null); setDeleteConfirmText(''); };
  const [sharingVehicleId, setSharingVehicleId] = React.useState<string | null>(null);
  const [demoPickerOpen, setDemoPickerOpen] = React.useState(false);

  React.useEffect(() => {
    if (!sharingVehicleId) return;
    if (!(vehicles ?? []).some((vehicle) => vehicle.id === sharingVehicleId)) {
      setSharingVehicleId(null);
    }
  }, [sharingVehicleId, vehicles]);

  // Row actions report failures here; the API message explains refusals such
  // as refreshing artwork for a paused vehicle.
  const [actionError, setActionError] = React.useState<string | null>(null);
  const rowAction = (fallback: string) => ({
    onMutate: () => setActionError(null),
    onError: (error: unknown) => setActionError(saveFailure(error, fallback).message),
  });

  const deleteVehicle = useMutation({
    mutationFn: (vehicleId: string) => api.deleteVehicle(vehicleId),
    ...rowAction('Unable to delete the vehicle.'),
    onSuccess: (result) => {
      setDefaultVehicleId(result.default_vehicle_id ?? null);
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all, exact: true });
    },
  });

  const refreshVehicleArtwork = useMutation({
    mutationFn: (vehicleId: string) => api.refreshVehicleArtwork(vehicleId),
    ...rowAction('Unable to refresh vehicle artwork.'),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all, exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle.images(result.vehicle_id) });
    },
  });

  const updateVehicleCollection = useMutation({
    mutationFn: ({ vehicleId, paused }: { vehicleId: string; paused: boolean }) =>
      api.updateVehicleCollection(vehicleId, paused),
    ...rowAction('Unable to change data collection for the vehicle.'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all, exact: true });
    },
  });

  const purgeVehicleArtworkCache = useMutation({
    mutationFn: (vehicleId: string) => api.purgeVehicleArtworkCache(vehicleId),
    ...rowAction('Unable to clear the artwork cache.'),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all, exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle.images(result.vehicle_id) });
    },
  });

  const refreshDemoVehicle = useMutation({
    mutationFn: (vehicleId: string) => api.refreshDemoVehicle(vehicleId),
    ...rowAction('Unable to refresh demo data.'),
    onSuccess: () => {
      setDemoRefreshConfirmId(null);
      void queryClient.invalidateQueries();
    },
  });

  const setDefaultVehicle = useMutation({
    mutationFn: (vehicleId: string) => api.setDefaultVehicle(vehicleId),
    ...rowAction('Unable to set the default vehicle.'),
    onSuccess: (result) => {
      setDefaultVehicleId(result.default_vehicle_id);
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all, exact: true });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
    },
  });

  const createDemoVehicle = useMutation({
    mutationFn: (model: 'R1T' | 'R1S' | 'R2') => api.createDemoVehicle({ model }),
    onSuccess: (result) => {
      setActiveVehicleId(result.vehicle_id);
      setDemoPickerOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all, exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.status(result.vehicle_id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle.health(result.vehicle_id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle.images(result.vehicle_id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
    },
  });

  function startEditVehicle(vehicleId: string) {
    if (editingBatteryVehicleId === vehicleId) return;
    requestLeave(() => setEditingBatteryVehicleId(vehicleId));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vehicles</CardTitle>
        <div className="flex items-center gap-2">
          {canCreateDemoVehicle && (
            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Plus className="h-3.5 w-3.5" />}
                loading={createDemoVehicle.isPending}
                onClick={() => setDemoPickerOpen((current) => !current)}
              >
                Demo Vehicle
              </Button>
              {demoPickerOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 w-40 rounded-lg border border-border bg-bg-surface p-1 shadow-lg">
                  {(['R1T', 'R1S', 'R2'] as const).map((model) => (
                    <button
                      key={model}
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-bg-elevated hover:text-fg"
                      onClick={() => createDemoVehicle.mutate(model)}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Button variant="secondary" size="sm" iconLeft={<Plus className="h-3.5 w-3.5" />}
            onClick={() => navigate({ to: '/connect' })}>
            Vehicle
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {(vehicles?.length ?? 0) === 0 && (
          <p className="text-sm text-fg-tertiary">No vehicles connected yet.</p>
        )}
        {actionError ? (
          <p role="alert" className="mb-3 rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-sm text-status-danger">
            {actionError}
          </p>
        ) : null}
        <VehicleConfirmDialogs
          vehicles={vehicles}
          deleteConfirmId={deleteConfirmId}
          deleteConfirmText={deleteConfirmText}
          onDeleteConfirmTextChange={setDeleteConfirmText}
          onDismissDelete={closeDelete}
          onConfirmDelete={(vehicleId) => {
            deleteVehicle.mutate(vehicleId);
            closeDelete();
          }}
          deletePending={deleteVehicle.isPending}
          demoRefreshConfirmId={demoRefreshConfirmId}
          onDismissDemoRefresh={() => setDemoRefreshConfirmId(null)}
          onConfirmDemoRefresh={(vehicleId) => refreshDemoVehicle.mutateAsync(vehicleId)}
        />
        <div className="divide-y divide-border">
          {vehicles?.map((v) => {
            const isActive = defaultVehicleId === v.id || (!defaultVehicleId && vehicles[0]?.id === v.id);
            const isEditingBattery = editingBatteryVehicleId === v.id;
            const isSharingExpanded = sharingVehicleId === v.id;
            const membershipRole = v.membership_role ?? 'viewer';
            const canManageVehicle = membershipRole === 'owner' || membershipRole === 'manager';
            const canManageMembers = membershipRole === 'owner';
            const isDemo = v.is_demo ?? v.rivian_vehicle_id?.startsWith('demo-') ?? false;

            const needsReauth = !isDemo && v.auth_state === 'needs_reauth';
            const renewalNotice = !isDemo && !needsReauth
              ? getRivianCredentialRenewalNotice(v)
              : null;
            const expectedRenewalDate = !isDemo
              ? formatRivianRenewalDate(v.expected_renewal_at)
              : null;
            const collectionPaused = !isDemo && v.collection_paused === true;
            const collectorHealthy = v.worker_health === 'ok' || v.worker_health === 'connected';
            const collectorPassive = v.worker_health === 'passive';
            const healthColor = isDemo
              ? 'var(--rm-status-info)'
              : collectionPaused
              ? 'var(--rm-status-warning)'
              : needsReauth
              ? 'var(--rm-status-warning)'
              : collectorHealthy
                ? 'var(--rm-status-positive)'
                : collectorPassive
                  ? 'var(--rm-border-default)'
                : v.worker_health != null
                  ? 'var(--rm-status-danger)'
                  : 'var(--rm-border-default)';
            const healthText = isDemo
              ? 'Demo data'
              : collectionPaused
              ? 'Paused'
              : needsReauth
              ? 'Login required'
              : collectorHealthy
                ? (isActive ? 'Active' : 'Connected')
                : collectorPassive
                  ? 'Standby'
                : v.worker_health != null
                  ? 'Error'
                  : (isActive ? 'Active' : 'Offline');
            const hasGlow = isDemo || collectionPaused || needsReauth || v.worker_health != null;

            const modelLine = [v.model, v.year, v.trim].filter(Boolean).join(' · ') || 'Vehicle details pending';
            const batteryLabel = v.battery_capacity_kwh != null ? ` · ${v.battery_capacity_kwh} kWh` : '';

            return (
            <div key={v.id} className="py-2">
              <div className="@container/vehicle rounded-lg border border-border bg-bg-elevated/35 p-3">
                {/* Sized by the card, not the window: image and details sit side by side once
                    the card is wide enough, and the actions join that row only when the
                    details still have room, so nothing overlaps at in-between widths. */}
                <div className="grid gap-3 @min-[30rem]/vehicle:grid-cols-[10rem_minmax(0,1fr)] @min-[56rem]/vehicle:grid-cols-[10rem_minmax(0,1fr)_auto]">
                  {/* Status chip */}
                  <div
                    className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border bg-bg-elevated/70 px-1.5 py-2 transition-shadow"
                    style={{
                      borderColor: healthColor,
                      boxShadow: hasGlow
                        ? `0 0 18px color-mix(in oklab, ${healthColor} 35%, transparent)`
                        : 'none',
                    }}
                  >
                    <ThemeVehicleImage
                      images={v.images}
                      model={v.model}
                      placement="side"
                      className="w-full object-contain"
                      fallback={<Car className="h-6 w-6 text-fg-secondary" />}
                    />
                    <span className="text-[10px] font-medium leading-none" style={{ color: healthColor }}>
                      {healthText}
                    </span>
                  </div>

                  {/* Name + model */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <p className="text-lg font-medium text-fg">{v.display_name}</p>
                      <Badge variant={membershipBadgeVariant(membershipRole)} size="sm">
                        {formatMembershipRole(membershipRole)}
                      </Badge>
                      {isDemo && (
                        <Badge variant="info" size="sm" dot>Demo data</Badge>
                      )}
                      {isActive && (
                        <Badge variant="success" size="sm" dot>Default vehicle</Badge>
                      )}
                      {collectionPaused && (
                        <Badge variant="warning" size="sm" dot>Collection paused</Badge>
                      )}
                      {needsReauth && (
                        <Badge variant="warning" size="sm" dot>Refresh Rivian login required</Badge>
                      )}
                      {renewalNotice && (
                        <Badge variant="warning" size="sm" dot>{renewalNotice.label}</Badge>
                      )}
                      {isAdmin && !isDemo && v.images?.cache && (
                        <Badge
                          variant={v.images.cache.status === 'ready' ? 'success' : v.images.cache.status === 'failed' ? 'warning' : 'default'}
                          size="sm"
                          title={v.images.cache.last_error ?? undefined}
                        >
                          {v.images.cache.status === 'ready' ? 'Artwork' : 'Artwork restoring'} {v.images.cache.ready_asset_count}/{v.images.cache.asset_count}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-auto grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5 text-sm">
                      <span className="text-fg-tertiary">Model</span>
                      <span className="text-fg">{modelLine}{!isEditingBattery && batteryLabel}</span>
                      <span className="text-fg-tertiary">VIN</span>
                      <span className="break-all font-mono text-fg">{v.vin ?? 'Not reported'}</span>
                      <span className="whitespace-nowrap text-fg-tertiary">Rivian ID</span>
                      <span className="break-all font-mono text-fg">{v.rivian_vehicle_id}</span>
                      {!isDemo && (
                        <>
                          <span className="whitespace-nowrap text-fg-tertiary">Rivian renewal</span>
                          <span className="text-fg">
                            {expectedRenewalDate ? `${expectedRenewalDate} (estimated)` : 'Estimate unavailable'}
                          </span>
                        </>
                      )}
                    </div>
                    {renewalNotice ? (
                      <p className="mt-2 max-w-[65ch] text-sm leading-5 text-status-warning">
                        {renewalNotice.message}
                      </p>
                    ) : null}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap items-center justify-start gap-1.5 border-t border-border/60 pt-3 @min-[30rem]/vehicle:col-span-2 @min-[30rem]/vehicle:justify-end @min-[56rem]/vehicle:col-span-1 @min-[56rem]/vehicle:self-center @min-[56rem]/vehicle:border-t-0 @min-[56rem]/vehicle:pt-0">
                    {!isActive && (
                      <Tooltip content="Set as default vehicle">
                        <Button
                          aria-label={`Set ${v.display_name} as default vehicle`}
                          variant="secondary"
                          size="sm"
                          className="h-8 w-8 px-0"
                          loading={setDefaultVehicle.isPending && setDefaultVehicle.variables === v.id}
                          onClick={() => setDefaultVehicle.mutate(v.id)}
                        >
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    )}
                    {canManageMembers && (
                      <Tooltip content={isSharingExpanded ? 'Hide sharing' : 'Manage sharing'}>
                        <Button
                          aria-label={`${isSharingExpanded ? 'Hide sharing for' : 'Manage sharing for'} ${v.display_name}`}
                          variant="secondary"
                          size="sm"
                          className="h-8 w-8 px-0"
                          onClick={() => {
                            setSharingVehicleId((current) => current === v.id ? null : v.id);
                          }}
                        >
                          <Users className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    )}
                    {canManageVehicle && !isDemo && (
                      <Tooltip content={collectionPaused ? 'Resume data collection from Rivian' : 'Pause data collection from Rivian'}>
                        <Button
                          aria-label={`${collectionPaused ? 'Resume' : 'Pause'} data collection for ${v.display_name}`}
                          aria-pressed={collectionPaused}
                          variant="secondary"
                          size="sm"
                          className={[
                            'h-8 w-8 px-0',
                            collectionPaused
                              ? 'border-[var(--rm-status-warning)] text-[var(--rm-status-warning)] hover:border-[var(--rm-status-warning)] hover:text-[var(--rm-status-warning)]'
                              : '',
                          ].join(' ')}
                          loading={updateVehicleCollection.isPending && updateVehicleCollection.variables?.vehicleId === v.id}
                          onClick={() => updateVehicleCollection.mutate({ vehicleId: v.id, paused: !collectionPaused })}
                        >
                          {collectionPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                        </Button>
                      </Tooltip>
                    )}
                    {canManageVehicle && !isDemo && (
                      <Tooltip content="Refresh Rivian login">
                        <Button
                          aria-label={`Refresh Rivian login for ${v.display_name}`}
                          variant="secondary"
                          size="sm"
                          className={[
                            'h-8 w-8 px-0',
                            needsReauth
                              ? 'border-[var(--rm-status-warning)] text-[var(--rm-status-warning)] hover:border-[var(--rm-status-warning)] hover:text-[var(--rm-status-warning)]'
                              : '',
                          ].join(' ')}
                          onClick={() => navigate({ to: '/connect', search: { mode: 'refresh', vehicle_id: v.id } })}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    )}
                    {isAdmin && !isDemo && (
                      <Tooltip content="Clear local artwork cache; the next artwork view restores it">
                        <Button
                          aria-label={`Clear local artwork cache for ${v.display_name}`}
                          variant="secondary"
                          size="sm"
                          className="h-8 w-8 px-0"
                          loading={purgeVehicleArtworkCache.isPending && purgeVehicleArtworkCache.variables === v.id}
                          onClick={() => purgeVehicleArtworkCache.mutate(v.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    )}
                    {isAdmin && !isDemo && (
                      <Tooltip content={collectionPaused ? 'Resume data collection to refresh artwork from Rivian' : 'Refresh vehicle artwork from Rivian'}>
                        <Button
                          aria-label={`Refresh vehicle artwork for ${v.display_name}`}
                          variant="secondary"
                          size="sm"
                          className="h-8 w-8 px-0"
                          disabled={collectionPaused}
                          loading={refreshVehicleArtwork.isPending && refreshVehicleArtwork.variables === v.id}
                          onClick={() => refreshVehicleArtwork.mutate(v.id)}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    )}
                    {isAdmin && isDemo && (
                      <Tooltip content="Refresh demo data">
                        <Button
                          aria-label={`Refresh demo data for ${v.display_name}`}
                          variant="secondary"
                          size="sm"
                          className="h-8 w-8 px-0"
                          loading={refreshDemoVehicle.isPending && refreshDemoVehicle.variables === v.id}
                          onClick={() => setDemoRefreshConfirmId(v.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    )}
                    {canManageVehicle && (
                      <Tooltip content="Edit vehicle">
                        <Button
                          aria-label={`Edit ${v.display_name}`}
                          variant="secondary"
                          size="sm"
                          className="h-8 w-8 px-0"
                          onClick={() => startEditVehicle(v.id)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    )}
                    {membershipRole === 'owner' && (
                      <Tooltip content="Delete vehicle">
                        <Button
                          aria-label={`Delete ${v.display_name}`}
                          variant="danger"
                          size="sm"
                          className="h-8 w-8 px-0"
                          onClick={() => { setDeleteConfirmId(v.id); setDeleteConfirmText(''); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    )}
                  </div>
                </div>

                {/* Battery capacity edit — only when open. Staged; the page bar saves it. */}
                {isEditingBattery && (
                  <VehicleBatteryEditor
                    key={v.id}
                    vehicle={v}
                    onDone={() => setEditingBatteryVehicleId((current) => (current === v.id ? null : current))}
                  />
                )}
                {isSharingExpanded && (
                  <VehicleSharingPanel
                    vehicleId={v.id}
                    currentUserId={currentUserId}
                    latestInviteToken={latestInviteToken}
                    onLatestInviteTokenChange={onLatestInviteTokenChange}
                  />
                )}
              </div>
            </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
