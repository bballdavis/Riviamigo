import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Check,
  Clipboard,
  MailPlus,
  Pencil,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { api, useAuth, useAuthReady, useMe } from '@riviamigo/hooks';
import type { UserRole } from '@riviamigo/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageLayout,
  Tooltip,
} from '@riviamigo/ui/primitives';
import { AppLayout } from '../layout/AppLayout';

type Section = 'users' | 'invitations';
type DetailTab = 'account' | 'vehicles' | 'invites';
type Confirmation =
  | { kind: 'delete-user'; userId: string; email: string }
  | { kind: 'revoke-account-invitation'; invitationId: string; email: string }
  | { kind: 'revoke-vehicle-invitation'; userId: string; invitationId: string; vehicleName: string };

const CONTROL_CLASS = 'h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none transition-colors hover:border-border-strong focus:border-accent focus:ring-1 focus:ring-accent';

function emitToast(title: string, message: string, variant: 'error' | 'success' | 'info' = 'info') {
  window.dispatchEvent(new CustomEvent('riviamigo:toast', { detail: { title, message, variant } }));
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Please try again.';
}

function invitationStatus(invitation: { accepted_at: string | null; revoked_at: string | null }) {
  if (invitation.accepted_at) return 'accepted';
  if (invitation.revoked_at) return 'revoked';
  return 'pending';
}

function IconAction({
  label,
  children,
  variant = 'secondary',
  onClick,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  variant?: 'secondary' | 'danger';
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <Button
        type="button"
        variant={variant}
        aria-label={label}
        className="h-9 w-9 shrink-0 px-0"
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

function ConfirmationDialog({
  confirmation,
  onCancel,
  onConfirm,
  pending,
}: {
  confirmation: Confirmation;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const copy = confirmation.kind === 'delete-user'
    ? {
      title: `Delete ${confirmation.email}?`,
      description: 'This permanently removes the account and its membership access.',
      action: 'Delete account',
    }
    : confirmation.kind === 'revoke-account-invitation'
      ? {
        title: `Revoke invitation for ${confirmation.email}?`,
        description: 'The recipient will no longer be able to activate this account invitation.',
        action: 'Revoke invitation',
      }
      : {
        title: `Revoke invitation for ${confirmation.vehicleName}?`,
        description: 'The recipient will no longer be able to accept this vehicle invitation.',
        action: 'Revoke invitation',
      };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-bg-page/80 p-2 backdrop-blur-sm sm:items-center sm:justify-center">
      <div role="dialog" aria-modal="true" aria-label={copy.title} className="w-full rounded-xl border border-border bg-bg-surface p-5 shadow-lg sm:max-w-sm">
        <h2 className="text-base font-semibold text-fg">{copy.title}</h2>
        <p className="mt-2 text-sm text-fg-tertiary">{copy.description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="md" onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="danger" size="md" loading={pending} onClick={onConfirm}>{copy.action}</Button>
        </div>
      </div>
    </div>
  );
}

function InviteUserDialog({
  email,
  setEmail,
  activationLink,
  pending,
  onClose,
  onSubmit,
  onCopy,
}: {
  email: string;
  setEmail: (email: string) => void;
  activationLink: string | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onCopy: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-bg-page/80 p-2 backdrop-blur-sm sm:items-center sm:justify-center">
      <div role="dialog" aria-modal="true" aria-label="Invite user" className="w-full rounded-xl border border-border bg-bg-surface p-5 shadow-lg sm:max-w-md">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-fg">Invite user</h2>
            <p className="mt-1 text-sm text-fg-tertiary">Create a standard account invitation. The activation link is shown once.</p>
          </div>
          <IconAction label="Close invite dialog" onClick={onClose}><X className="h-4 w-4" /></IconAction>
        </div>
        {activationLink ? (
          <div className="mt-5 grid gap-2">
            <label className="text-xs font-medium text-fg-secondary" htmlFor="activation-link">Activation link</label>
            <div className="flex gap-2">
              <input id="activation-link" readOnly value={activationLink} className={`${CONTROL_CLASS} min-w-0 flex-1 font-mono text-xs`} />
              <IconAction label={copied ? 'Activation link copied' : 'Copy activation link'} onClick={() => { onCopy(); setCopied(true); }}>
                {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
              </IconAction>
            </div>
            <p className="text-xs text-fg-tertiary" aria-live="polite">{copied ? 'Activation link copied. It cannot be recovered later.' : 'Copy this link before closing. It cannot be recovered later.'}</p>
          </div>
        ) : (
          <form className="mt-5 grid gap-4" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium text-fg-secondary" htmlFor="invite-email">Email address</label>
              <input id="invite-email" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@example.com" className={CONTROL_CLASS} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="md" onClick={onClose}>Cancel</Button>
              <Button type="submit" size="md" iconLeft={<MailPlus className="h-4 w-4" />} loading={pending} disabled={!email.trim()}>Create invitation</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function UserManagementPage() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const authReady = useAuthReady();
  const me = useMe();
  const isPrivileged = me.data?.role === 'admin' || me.data?.role === 'super_user';
  const isSuperUser = me.data?.role === 'super_user';

  const [section, setSection] = React.useState<Section>('users');
  const [search, setSearch] = React.useState('');
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [detailTab, setDetailTab] = React.useState<DetailTab>('account');
  const [isEditingAccount, setIsEditingAccount] = React.useState(false);
  const [accountDraft, setAccountDraft] = React.useState({ email: '', role: 'user' as UserRole });
  const [grantVehicleId, setGrantVehicleId] = React.useState('');
  const [grantRole, setGrantRole] = React.useState<'owner' | 'manager' | 'viewer'>('viewer');
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [activationLink, setActivationLink] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<Confirmation | null>(null);

  const users = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => api.listUsers(search.trim()),
    enabled: authReady && isPrivileged && !!accessToken,
  });
  const accountInvitations = useQuery({
    queryKey: ['admin-account-invitations'],
    queryFn: () => api.listAccountInvitations(),
    enabled: authReady && isPrivileged && !!accessToken,
  });
  const vehicleOptions = useQuery({
    queryKey: ['admin-vehicle-options'],
    queryFn: () => api.listAdminVehicleOptions(),
    enabled: authReady && isPrivileged && !!accessToken,
  });

  React.useEffect(() => {
    if (!users.data?.length) {
      setSelectedUserId(null);
      return;
    }
    if (!selectedUserId || !users.data.some((user) => user.id === selectedUserId)) {
      setSelectedUserId(users.data[0]?.id ?? null);
    }
  }, [selectedUserId, users.data]);

  const selectedUser = users.data?.find((user) => user.id === selectedUserId) ?? null;
  const detail = useQuery({
    queryKey: ['admin-user-detail', selectedUserId],
    queryFn: () => api.getUserDetail(selectedUserId!),
    enabled: authReady && isPrivileged && !!selectedUserId && !!accessToken,
  });

  React.useEffect(() => {
    if (!detail.data) return;
    setAccountDraft({ email: detail.data.user.email, role: detail.data.user.role });
    setIsEditingAccount(false);
    setDetailTab('account');
  }, [detail.data?.user.id, detail.data?.user.email, detail.data?.user.role]);

  const createInvitation = useMutation({
    mutationFn: () => api.createAccountInvitation({ email: inviteEmail.trim() }),
    onSuccess: (result) => {
      setActivationLink(`${window.location.origin}/activate#${result.activation_token}`);
      void queryClient.invalidateQueries({ queryKey: ['admin-account-invitations'] });
    },
  });
  const updateUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { email?: string; role?: UserRole; is_disabled?: boolean } }) => api.updateUser(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] });
    },
  });
  const deleteUser = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => {
      setSelectedUserId(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
  const revokeAccountInvitation = useMutation({
    mutationFn: (id: string) => api.revokeAccountInvitation(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-account-invitations'] }),
  });
  const grantMembership = useMutation({
    mutationFn: ({ userId, vehicleId, role }: { userId: string; vehicleId: string; role: 'owner' | 'manager' | 'viewer' }) =>
      api.grantUserVehicleMembership(userId, vehicleId, role),
    onSuccess: () => {
      setGrantVehicleId('');
      void queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] });
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });
  const updateMembership = useMutation({
    mutationFn: ({ userId, vehicleId, role }: { userId: string; vehicleId: string; role: 'owner' | 'manager' | 'viewer' }) =>
      api.updateUserVehicleMembership(userId, vehicleId, role),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] }),
  });
  const removeMembership = useMutation({
    mutationFn: ({ userId, vehicleId }: { userId: string; vehicleId: string }) => api.removeUserVehicleMembership(userId, vehicleId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] }),
  });
  const revokeVehicleInvitation = useMutation({
    mutationFn: ({ userId, invitationId }: { userId: string; invitationId: string }) => api.revokeUserInvite(userId, invitationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] }),
  });

  const pendingInvitations = (accountInvitations.data ?? []).filter((invitation) => invitationStatus(invitation) === 'pending');
  const invitationHistory = (accountInvitations.data ?? []).filter((invitation) => invitationStatus(invitation) !== 'pending');

  async function handleInviteSubmit() {
    try {
      await createInvitation.mutateAsync();
      emitToast('Invitation created', 'Copy the activation link before closing this dialog.', 'success');
    } catch (error) {
      emitToast('Invitation failed', errorMessage(error), 'error');
    }
  }

  async function handleAccountSave() {
    if (!detail.data) return;
    const body: { email?: string; role?: UserRole } = {};
    const email = accountDraft.email.trim();
    if (email && email !== detail.data.user.email) body.email = email;
    if (accountDraft.role !== detail.data.user.role) body.role = accountDraft.role;
    if (!Object.keys(body).length) {
      setIsEditingAccount(false);
      return;
    }
    try {
      await updateUser.mutateAsync({ id: detail.data.user.id, body });
      setIsEditingAccount(false);
      emitToast('Account updated', 'The account details have been saved.', 'success');
    } catch (error) {
      emitToast('Account update failed', errorMessage(error), 'error');
    }
  }

  async function handleConfirmation() {
    if (!confirmation) return;
    try {
      if (confirmation.kind === 'delete-user') {
        await deleteUser.mutateAsync(confirmation.userId);
        emitToast('Account deleted', `${confirmation.email} has been removed.`, 'success');
      } else if (confirmation.kind === 'revoke-account-invitation') {
        await revokeAccountInvitation.mutateAsync(confirmation.invitationId);
        emitToast('Invitation revoked', `The invitation for ${confirmation.email} is no longer active.`, 'success');
      } else {
        await revokeVehicleInvitation.mutateAsync({ userId: confirmation.userId, invitationId: confirmation.invitationId });
        emitToast('Invitation revoked', `The ${confirmation.vehicleName} invitation is no longer active.`, 'success');
      }
      setConfirmation(null);
    } catch (error) {
      emitToast('Action failed', errorMessage(error), 'error');
    }
  }

  const confirmationPending = deleteUser.isPending || revokeAccountInvitation.isPending || revokeVehicleInvitation.isPending;

  return (
    <AppLayout activeKey="users">
      <PageLayout
        title="Users"
        subtitle="Manage accounts, vehicle access, and invitations."
        actions={isPrivileged ? (
          <Button type="button" size="md" iconLeft={<MailPlus className="h-4 w-4" />} onClick={() => { setActivationLink(null); setInviteEmail(''); setInviteOpen(true); }}>
            Invite user
          </Button>
        ) : undefined}
      >
        {!isPrivileged ? (
          <Card><CardContent><p className="text-sm text-fg-tertiary">Admin access is required.</p></CardContent></Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="User management sections">
              <button type="button" onClick={() => setSection('users')} className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors ${section === 'users' ? 'bg-accent text-fg-on-accent shadow-glow-button' : 'text-fg-secondary hover:bg-bg-elevated hover:text-fg'}`}>
                <UsersRound className="h-4 w-4" /> Users
              </button>
              <button type="button" aria-label="Invitations" onClick={() => setSection('invitations')} className={`flex h-9 shrink-0 items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium transition-colors ${section === 'invitations' ? 'bg-accent text-fg-on-accent shadow-glow-button' : 'text-fg-secondary hover:bg-bg-elevated hover:text-fg'}`}>
                <span className="flex items-center gap-2"><MailPlus className="h-4 w-4" /> Invitations</span>
                {pendingInvitations.length > 0 ? <Badge size="sm" variant="warning">{pendingInvitations.length}</Badge> : null}
              </button>
            </nav>

            {section === 'users' ? (
              <Card padding="none" className="overflow-hidden">
                <div className="grid min-h-[34rem] lg:grid-cols-[20rem_minmax(0,1fr)]">
                  <section className="border-b border-border p-4 lg:border-b-0 lg:border-r" aria-label="Accounts">
                    <label className="sr-only" htmlFor="user-search">Search accounts</label>
                    <input id="user-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search accounts" className={`${CONTROL_CLASS} w-full`} />
                    <div className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
                      {users.isLoading ? <p className="p-4 text-sm text-fg-tertiary">Loading accounts…</p> : null}
                      {!users.isLoading && (users.data?.length ?? 0) === 0 ? <p className="p-4 text-sm text-fg-tertiary">No accounts found.</p> : null}
                      {users.data?.map((user) => (
                        <button key={user.id} type="button" onClick={() => setSelectedUserId(user.id)} className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors ${selectedUserId === user.id ? 'bg-accent-muted/35' : 'hover:bg-bg-elevated/70'}`}>
                          <span className="min-w-0"><span className="block truncate text-sm font-medium text-fg">{user.email}</span><span className="mt-1 flex flex-wrap items-center gap-1.5"><Badge size="sm">{user.role}</Badge><Badge size="sm" variant={user.is_disabled ? 'warning' : 'success'}>{user.is_disabled ? 'disabled' : 'active'}</Badge></span></span>
                          <span className="shrink-0 text-xs text-fg-tertiary">{user.vehicle_count} vehicle{user.vehicle_count === 1 ? '' : 's'}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="p-4" aria-label="Selected user">
                    {!selectedUser ? <EmptyState icon={<UserRound />} title="Select an account" description="Choose an account to manage its details and vehicle access." className="min-h-72" /> : detail.isLoading || !detail.data ? <p className="p-4 text-sm text-fg-tertiary">Loading account details…</p> : (
                      <div className="grid gap-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0"><h2 className="truncate text-lg font-semibold text-fg">{detail.data.user.email}</h2><div className="mt-1 flex flex-wrap gap-1.5"><Badge>{detail.data.user.role}</Badge><Badge variant={detail.data.user.is_disabled ? 'warning' : 'success'}>{detail.data.user.is_disabled ? 'disabled' : 'active'}</Badge></div></div>
                          <div className="flex items-center gap-2">
                            <IconAction label={detail.data.user.is_disabled ? 'Enable account' : 'Disable account'} onClick={() => void updateUser.mutateAsync({ id: detail.data!.user.id, body: { is_disabled: !detail.data!.user.is_disabled } }).then(() => emitToast(detail.data!.user.is_disabled ? 'Account enabled' : 'Account disabled', detail.data!.user.email, 'success')).catch((error) => emitToast('Account update failed', errorMessage(error), 'error'))}>
                              {detail.data.user.is_disabled ? <Check className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                            </IconAction>
                            {isSuperUser ? <IconAction label="Delete account" variant="danger" onClick={() => setConfirmation({ kind: 'delete-user', userId: detail.data!.user.id, email: detail.data!.user.email })}><Trash2 className="h-4 w-4" /></IconAction> : null}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Account details">
                          {([['account', 'Account'], ['vehicles', 'Vehicles'], ['invites', 'Invites']] as const).map(([tab, label]) => <Button key={tab} type="button" size="md" variant={detailTab === tab ? 'primary' : 'secondary'} role="tab" aria-selected={detailTab === tab} onClick={() => setDetailTab(tab)}>{label}</Button>)}
                        </div>

                        {detailTab === 'account' ? (
                          isEditingAccount ? (
                            <div className="grid gap-3 rounded-xl border border-border bg-bg-elevated/35 p-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto_auto]">
                              <label className="sr-only" htmlFor="account-email">Account email</label><input id="account-email" value={accountDraft.email} onChange={(event) => setAccountDraft((current) => ({ ...current, email: event.target.value }))} className={CONTROL_CLASS} />
                              <label className="sr-only" htmlFor="account-role">Account role</label><select id="account-role" value={accountDraft.role} disabled={!isSuperUser} onChange={(event) => setAccountDraft((current) => ({ ...current, role: event.target.value as UserRole }))} className={CONTROL_CLASS}><option value="user">user</option><option value="admin">admin</option><option value="super_user">super_user</option></select>
                              <Button type="button" size="md" loading={updateUser.isPending} onClick={() => void handleAccountSave()}>Save</Button>
                              <Button type="button" size="md" variant="secondary" onClick={() => { setAccountDraft({ email: detail.data!.user.email, role: detail.data!.user.role }); setIsEditingAccount(false); }}>Cancel</Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated/35 p-4"><dl className="grid gap-2 text-sm"><div className="grid gap-1 sm:grid-cols-[6rem_1fr]"><dt className="text-fg-tertiary">Email</dt><dd className="text-fg">{detail.data.user.email}</dd></div><div className="grid gap-1 sm:grid-cols-[6rem_1fr]"><dt className="text-fg-tertiary">Role</dt><dd className="text-fg">{detail.data.user.role}</dd></div></dl><IconAction label="Edit account" onClick={() => setIsEditingAccount(true)}><Pencil className="h-4 w-4" /></IconAction></div>
                          )
                        ) : null}

                        {detailTab === 'vehicles' ? (
                          <div className="grid gap-4">
                            <div className="grid gap-2 rounded-xl border border-border bg-bg-elevated/35 p-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
                              <label className="sr-only" htmlFor="grant-vehicle">Vehicle</label><select id="grant-vehicle" value={grantVehicleId} onChange={(event) => setGrantVehicleId(event.target.value)} className={CONTROL_CLASS}><option value="">Select a vehicle</option>{vehicleOptions.data?.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.display_name} · {vehicle.model}</option>)}</select>
                              <label className="sr-only" htmlFor="grant-role">Membership role</label><select id="grant-role" value={grantRole} onChange={(event) => setGrantRole(event.target.value as 'owner' | 'manager' | 'viewer')} className={CONTROL_CLASS}><option value="owner">owner</option><option value="manager">manager</option><option value="viewer">viewer</option></select>
                              <Button type="button" size="md" loading={grantMembership.isPending} disabled={!grantVehicleId} onClick={() => { if (detail.data) void grantMembership.mutateAsync({ userId: detail.data.user.id, vehicleId: grantVehicleId, role: grantRole }).then(() => emitToast('Vehicle access granted', 'The membership has been saved.', 'success')).catch((error) => emitToast('Vehicle access failed', errorMessage(error), 'error')); }}>Grant access</Button>
                            </div>
                            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                              {detail.data.memberships.length === 0 ? <p className="p-4 text-sm text-fg-tertiary">No vehicle access has been assigned.</p> : detail.data.memberships.map((membership) => <div key={membership.vehicle_id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium text-fg">{membership.display_name || membership.model}</p><div className="mt-1 flex items-center gap-2"><Badge size="sm">{membership.role}</Badge>{membership.is_default ? <Badge size="sm" variant="success">default</Badge> : null}</div></div><div className="flex items-center gap-2"><label className="sr-only" htmlFor={`membership-role-${membership.vehicle_id}`}>Role for {membership.display_name || membership.model}</label><select id={`membership-role-${membership.vehicle_id}`} value={membership.role} onChange={(event) => void updateMembership.mutateAsync({ userId: detail.data!.user.id, vehicleId: membership.vehicle_id, role: event.target.value as 'owner' | 'manager' | 'viewer' }).then(() => emitToast('Vehicle role updated', 'The membership role has been saved.', 'success')).catch((error) => emitToast('Vehicle role failed', errorMessage(error), 'error'))} className={`${CONTROL_CLASS} w-28`}><option value="owner">owner</option><option value="manager">manager</option><option value="viewer">viewer</option></select><IconAction label={`Remove ${membership.display_name || membership.model} access`} variant="danger" onClick={() => void removeMembership.mutateAsync({ userId: detail.data!.user.id, vehicleId: membership.vehicle_id }).then(() => emitToast('Vehicle access removed', 'The membership has been removed.', 'success')).catch((error) => emitToast('Vehicle removal failed', errorMessage(error), 'error'))}><Trash2 className="h-4 w-4" /></IconAction></div></div>)}
                            </div>
                          </div>
                        ) : null}

                        {detailTab === 'invites' ? <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">{detail.data.invites.length === 0 ? <p className="p-4 text-sm text-fg-tertiary">No vehicle invitations for this account.</p> : detail.data.invites.map((invitation) => { const status = invitationStatus(invitation); return <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium text-fg">{invitation.vehicle_name}</p><p className="mt-1 text-xs text-fg-tertiary">{status === 'pending' ? `Expires ${new Date(invitation.expires_at).toLocaleString()}` : status}</p></div><div className="flex items-center gap-2"><Badge size="sm" variant={status === 'pending' ? 'warning' : status === 'accepted' ? 'success' : 'danger'}>{status}</Badge>{status === 'pending' ? <IconAction label={`Revoke ${invitation.vehicle_name} invitation`} variant="danger" onClick={() => setConfirmation({ kind: 'revoke-vehicle-invitation', userId: detail.data!.user.id, invitationId: invitation.id, vehicleName: invitation.vehicle_name })}><Trash2 className="h-4 w-4" /></IconAction> : null}</div></div>; })}</div> : null}
                      </div>
                    )}
                  </section>
                </div>
              </Card>
            ) : (
              <Card padding="none" className="overflow-hidden">
                <section className="p-4 sm:p-5" aria-label="Account invitations">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-fg">Account invitations</h2><p className="mt-1 text-sm text-fg-tertiary">Pending invitations are actionable; completed invitations remain available as history.</p></div><Button type="button" size="md" iconLeft={<MailPlus className="h-4 w-4" />} onClick={() => { setActivationLink(null); setInviteEmail(''); setInviteOpen(true); }}>Invite user</Button></div>
                  <div className="mt-5 divide-y divide-border overflow-hidden rounded-xl border border-border">{pendingInvitations.length === 0 ? <p className="p-4 text-sm text-fg-tertiary">No pending account invitations.</p> : pendingInvitations.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium text-fg">{invitation.invitee_email}</p><p className="mt-1 text-xs text-fg-tertiary">Expires {new Date(invitation.expires_at).toLocaleString()}</p></div><div className="flex items-center gap-2"><Badge size="sm" variant="warning">pending</Badge><IconAction label={`Revoke invitation for ${invitation.invitee_email}`} variant="danger" onClick={() => setConfirmation({ kind: 'revoke-account-invitation', invitationId: invitation.id, email: invitation.invitee_email })}><Trash2 className="h-4 w-4" /></IconAction></div></div>)}</div>
                  {invitationHistory.length > 0 ? <details className="mt-4 rounded-xl border border-border bg-bg-elevated/35"><summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg">Invitation history ({invitationHistory.length})</summary><div className="divide-y divide-border border-t border-border">{invitationHistory.map((invitation) => { const status = invitationStatus(invitation); return <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><span className="text-fg">{invitation.invitee_email}</span><Badge size="sm" variant={status === 'accepted' ? 'success' : 'danger'}>{status}</Badge></div>; })}</div></details> : null}
                </section>
              </Card>
            )}
          </div>
        )}
      </PageLayout>
      {inviteOpen ? <InviteUserDialog email={inviteEmail} setEmail={setInviteEmail} activationLink={activationLink} pending={createInvitation.isPending} onClose={() => setInviteOpen(false)} onSubmit={() => void handleInviteSubmit()} onCopy={() => { if (activationLink) { void navigator.clipboard?.writeText(activationLink); emitToast('Activation link copied', 'The invitation link is ready to share.', 'success'); } }} /> : null}
      {confirmation ? <ConfirmationDialog confirmation={confirmation} pending={confirmationPending} onCancel={() => setConfirmation(null)} onConfirm={() => void handleConfirmation()} /> : null}
    </AppLayout>
  );
}
