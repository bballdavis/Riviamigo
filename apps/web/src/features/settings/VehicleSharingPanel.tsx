import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys, useAuth, useAuthReady } from '@riviamigo/hooks';
import type { VehicleMember } from '@riviamigo/types';
import { formatAppDate } from '@riviamigo/ui/lib/dateTime';
import { Badge, Button, SelectPicker } from '@riviamigo/ui/primitives';
import { formatMembershipRole, membershipBadgeVariant } from './vehicleSettingsDisplay';

export interface VehicleSharingPanelProps {
  vehicleId: string;
  currentUserId: string | undefined;
  /** Held by the page so the token survives switching sections, as before. */
  latestInviteToken: string | null;
  onLatestInviteTokenChange: (token: string | null) => void;
}

/** Members and pending invites for one vehicle. Mounted only while its sharing panel is open. */
export function VehicleSharingPanel({
  vehicleId,
  currentUserId,
  latestInviteToken,
  onLatestInviteTokenChange,
}: VehicleSharingPanelProps) {
  const { accessToken } = useAuth();
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const [shareEmail, setShareEmail] = React.useState('');
  const [shareRole, setShareRole] = React.useState<VehicleMember['role']>('viewer');
  const vehicleMembers = useQuery({
    queryKey: queryKeys.vehicleMembers.byVehicle(vehicleId),
    queryFn: () => api.listVehicleMembers(vehicleId),
    enabled: authReady && !!vehicleId && !!accessToken,
  });
  const vehicleInvites = useQuery({
    queryKey: queryKeys.vehicleInvites.byVehicle(vehicleId),
    queryFn: () => api.listVehicleInvites(vehicleId),
    enabled: authReady && !!vehicleId && !!accessToken,
  });

  const addVehicleMember = useMutation({
    mutationFn: ({ vehicleId, email, role }: { vehicleId: string; email: string; role: VehicleMember['role'] }) =>
      api.addVehicleMember(vehicleId, { email, role }),
    onSuccess: (result, variables) => {
      setShareEmail('');
      setShareRole('viewer');
      onLatestInviteTokenChange(result.invite_created ? (result.invite_token ?? null) : null);
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicleMembers.byVehicle(variables.vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicleInvites.byVehicle(variables.vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all, exact: true });
    },
  });

  const updateVehicleMember = useMutation({
    mutationFn: ({ vehicleId, userId, role }: { vehicleId: string; userId: string; role: VehicleMember['role'] }) =>
      api.updateVehicleMember(vehicleId, userId, { role }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicleMembers.byVehicle(variables.vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all, exact: true });
    },
  });

  const removeVehicleMember = useMutation({
    mutationFn: ({ vehicleId, userId }: { vehicleId: string; userId: string }) =>
      api.removeVehicleMember(vehicleId, userId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicleMembers.byVehicle(variables.vehicleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all, exact: true });
      queryClient.invalidateQueries({ queryKey: queryKeys.me.all });
    },
  });

  const revokeVehicleInvite = useMutation({
    mutationFn: ({ vehicleId, inviteId }: { vehicleId: string; inviteId: string }) =>
      api.revokeVehicleInvite(vehicleId, inviteId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.vehicleInvites.byVehicle(variables.vehicleId) });
    },
  });

  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-fg">Vehicle Access</p>
            <p className="text-xs text-fg-tertiary">
              Owners can add existing Riviamigo users, adjust roles, and remove access.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={vehicleMembers.isFetching}
            onClick={() => {
              vehicleMembers.refetch();
              vehicleInvites.refetch();
            }}
          >
            Refresh
          </Button>
        </div>

        <div className="grid gap-2 rounded-xl border border-border bg-bg-elevated/35 p-3 md:grid-cols-[minmax(0,1.6fr)_11rem_auto]">
          <input
            value={shareEmail}
            onChange={(event) => setShareEmail(event.target.value)}
            placeholder="user@example.com"
            className="h-9 rounded-lg border border-border bg-bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
          />
          <SelectPicker
            className="w-full"
            value={shareRole}
            onChange={(value) => setShareRole(value as VehicleMember['role'])}
            aria-label="Vehicle member role"
            options={[{ value: 'viewer', label: 'Viewer' }, { value: 'manager', label: 'Manager' }, { value: 'owner', label: 'Owner' }]}
          />
          <Button
            size="sm"
            className="h-9"
            loading={addVehicleMember.isPending}
            disabled={!shareEmail.trim()}
            onClick={() => addVehicleMember.mutate({ vehicleId: vehicleId, email: shareEmail.trim(), role: shareRole })}
          >
            Add Member
          </Button>
        </div>
        {latestInviteToken && (
          <div className="rounded-xl border border-border bg-bg-elevated/25 p-3 text-xs text-fg-tertiary">
            Invite created for a user not yet registered. Token:
            <span className="ml-2 font-mono text-fg">{latestInviteToken}</span>
          </div>
        )}

        <div className="grid gap-2">
          {vehicleMembers.isLoading && (
            <div className="rounded-xl border border-border bg-bg-elevated/25 p-3 text-sm text-fg-tertiary">
              Loading members...
            </div>
          )}
          {!vehicleMembers.isLoading && (vehicleMembers.data?.length ?? 0) === 0 && (
            <div className="rounded-xl border border-border bg-bg-elevated/25 p-3 text-sm text-fg-tertiary">
              No members found for this vehicle yet.
            </div>
          )}
          {vehicleMembers.data?.map((member) => {
            const isCurrentUser = member.user_id === currentUserId;
            return (
              <div
                key={member.user_id}
                className="grid gap-2 rounded-xl border border-border bg-bg-elevated/25 p-3 md:grid-cols-[minmax(0,1fr)_10rem_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-fg">{member.email}</p>
                    <Badge variant={membershipBadgeVariant(member.role)} size="sm">
                      {formatMembershipRole(member.role)}
                    </Badge>
                    {member.is_default && (
                      <Badge variant="success" size="sm">Default here</Badge>
                    )}
                    {isCurrentUser && (
                      <Badge variant="default" size="sm">You</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-fg-tertiary">
      Added {formatAppDate(member.created_at)}
                  </p>
                </div>
                <SelectPicker
                  className="min-w-[7rem]"
                  value={member.role}
                  onChange={(value) => updateVehicleMember.mutate({
                    vehicleId: vehicleId,
                    userId: member.user_id,
                    role: value as VehicleMember['role'],
                  })}
                  aria-label={`Role for ${member.email}`}
                  disabled={updateVehicleMember.isPending}
                  options={[{ value: 'viewer', label: 'Viewer' }, { value: 'manager', label: 'Manager' }, { value: 'owner', label: 'Owner' }]}
                />
                <Button
                  variant="danger"
                  size="sm"
                  className="h-9"
                  loading={
                    removeVehicleMember.isPending
                    && removeVehicleMember.variables?.vehicleId === vehicleId
                    && removeVehicleMember.variables?.userId === member.user_id
                  }
                  onClick={() => removeVehicleMember.mutate({ vehicleId: vehicleId, userId: member.user_id })}
                >
                  {isCurrentUser ? 'Remove Me' : 'Remove'}
                </Button>
              </div>
            );
          })}
        </div>
        <div className="grid gap-2 pt-1">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">Pending Invites</p>
          {(vehicleInvites.data ?? [])
            .filter((invite) => !invite.accepted_at && !invite.revoked_at)
            .map((invite) => (
              <div key={invite.id} className="grid gap-2 rounded-xl border border-border bg-bg-elevated/25 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">
                    {invite.invitee_email} <span className="text-fg-tertiary">({formatMembershipRole(invite.role)})</span>
                  </p>
                  <p className="mt-1 text-xs text-fg-tertiary">
                    Expires {formatAppDate(invite.expires_at)}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  className="h-9"
                  loading={revokeVehicleInvite.isPending && revokeVehicleInvite.variables?.inviteId === invite.id}
                  onClick={() => revokeVehicleInvite.mutate({ vehicleId: vehicleId, inviteId: invite.id })}
                >
                  Revoke
                </Button>
              </div>
            ))}
          {(vehicleInvites.data ?? []).filter((invite) => !invite.accepted_at && !invite.revoked_at).length === 0 && (
            <div className="rounded-xl border border-border bg-bg-elevated/25 p-3 text-sm text-fg-tertiary">
              No pending invites.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
