import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rootRoute } from './__root';
import { api, useAuth, useAuthReady, useMe } from '@riviamigo/hooks';
import { AppLayout } from '../components/layout/AppLayout';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, PageLayout } from '@riviamigo/ui/primitives';

export const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  component: UsersPage,
});

function UsersPage() {
  return <ProtectedRoute><UsersContent /></ProtectedRoute>;
}

function UsersContent() {
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();
  const authReady = useAuthReady();
  const [search, setSearch] = React.useState('');
  const [newEmail, setNewEmail] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [newRole, setNewRole] = React.useState<'user' | 'admin' | 'super_user'>('user');
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<'account' | 'vehicles' | 'invites'>('account');
  const [grantVehicleId, setGrantVehicleId] = React.useState('');
  const [grantRole, setGrantRole] = React.useState<'owner' | 'manager' | 'viewer'>('viewer');

  const me = useMe();
  const isPrivileged = me.data?.role === 'admin' || me.data?.role === 'super_user';
  const isSuperUser = me.data?.role === 'super_user';

  const users = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => api.listUsers(search.trim()),
    enabled: authReady && isPrivileged && !!accessToken,
  });

  React.useEffect(() => {
    if (!users.data?.length) {
      setSelectedUserId(null);
      return;
    }
    if (!selectedUserId || !users.data.some((user) => user.id === selectedUserId)) {
      const firstUser = users.data[0];
      if (firstUser) {
        setSelectedUserId(firstUser.id);
      }
    }
  }, [users.data, selectedUserId]);

  const selectedUser = users.data?.find((user) => user.id === selectedUserId) ?? null;

  const detail = useQuery({
    queryKey: ['admin-user-detail', selectedUserId],
    queryFn: () => api.getUserDetail(selectedUserId!),
    enabled: authReady && isPrivileged && !!selectedUserId && !!accessToken,
  });

  const createUser = useMutation({
    mutationFn: () => api.createUser({ email: newEmail.trim(), password: newPassword, role: newRole }),
    onSuccess: () => {
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const updateUser = useMutation({
    mutationFn: ({ id, role, isDisabled, email }: { id: string; role: 'user' | 'admin' | 'super_user'; isDisabled: boolean; email?: string }) =>
      api.updateUser(id, email ? { role, is_disabled: isDisabled, email } : { role, is_disabled: isDisabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const grantMembership = useMutation({
    mutationFn: ({ userId, vehicleId, role }: { userId: string; vehicleId: string; role: 'owner' | 'manager' | 'viewer' }) =>
      api.grantUserVehicleMembership(userId, vehicleId, role),
    onSuccess: () => {
      setGrantVehicleId('');
      queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const updateMembership = useMutation({
    mutationFn: ({ userId, vehicleId, role }: { userId: string; vehicleId: string; role: 'owner' | 'manager' | 'viewer' }) =>
      api.updateUserVehicleMembership(userId, vehicleId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] }),
  });

  const removeMembership = useMutation({
    mutationFn: ({ userId, vehicleId }: { userId: string; vehicleId: string }) =>
      api.removeUserVehicleMembership(userId, vehicleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] }),
  });

  const revokeInvite = useMutation({
    mutationFn: ({ userId, inviteId }: { userId: string; inviteId: string }) => api.revokeUserInvite(userId, inviteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] }),
  });

  return (
    <AppLayout activeKey="users">
      <PageLayout title="Users" subtitle="Admin account management and support tooling.">
        {!isPrivileged ? (
          <Card>
            <CardContent>
              <p className="text-sm text-fg-tertiary">Admin access is required.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Create User</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_10rem_auto]">
                <input
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  placeholder="email@example.com"
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                />
                <input
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  placeholder="Temporary password"
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                />
                <select
                  value={newRole}
                  onChange={(event) => setNewRole(event.target.value as 'user' | 'admin' | 'super_user')}
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="super_user">Super User</option>
                </select>
                <Button
                  size="sm"
                  className="h-9"
                  loading={createUser.isPending}
                  disabled={!newEmail.trim() || newPassword.length < 12}
                  onClick={() => createUser.mutate()}
                >
                  Create
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Accounts</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by email"
                  className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                />
                <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-bg-elevated text-fg-tertiary">
                        <tr>
                          {['Email', 'Role', 'Status'].map((heading) => (
                            <th key={heading} className="px-3 py-2 font-medium">{heading}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {users.data?.map((user) => (
                          <tr
                            key={user.id}
                            className={`cursor-pointer ${selectedUserId === user.id ? 'bg-accent-muted/30' : 'hover:bg-bg-elevated/60'}`}
                            onClick={() => setSelectedUserId(user.id)}
                          >
                            <td className="px-3 py-2 text-fg">{user.email}</td>
                            <td className="px-3 py-2">{user.role}</td>
                            <td className="px-3 py-2">
                              <Badge variant={user.is_disabled ? 'warning' : 'success'}>
                                {user.is_disabled ? 'disabled' : 'active'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                        {(users.data?.length ?? 0) === 0 && (
                          <tr>
                            <td colSpan={3} className="px-3 py-6 text-center text-fg-tertiary">No users found.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-border bg-bg-surface">
                    {!selectedUser || !detail.data ? (
                      <div className="p-4 text-sm text-fg-tertiary">Select a user to view support details.</div>
                    ) : (
                      <div className="grid gap-4 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-fg">{detail.data.user.email}</div>
                          <Badge>{detail.data.user.role}</Badge>
                          <Badge variant={detail.data.user.is_disabled ? 'warning' : 'success'}>
                            {detail.data.user.is_disabled ? 'disabled' : 'active'}
                          </Badge>
                        </div>

                        <div className="flex gap-2">
                          <Button variant={activeTab === 'account' ? 'primary' : 'secondary'} size="sm" onClick={() => setActiveTab('account')}>Account</Button>
                          <Button variant={activeTab === 'vehicles' ? 'primary' : 'secondary'} size="sm" onClick={() => setActiveTab('vehicles')}>Vehicles</Button>
                          <Button variant={activeTab === 'invites' ? 'primary' : 'secondary'} size="sm" onClick={() => setActiveTab('invites')}>Invites</Button>
                        </div>

                        {activeTab === 'account' && (
                          <div className="grid gap-3">
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto_auto]">
                              <input
                                defaultValue={detail.data.user.email}
                                onBlur={(event) => {
                                  const next = event.target.value.trim();
                                  if (next && next !== detail.data?.user.email) {
                                    updateUser.mutate({
                                      id: detail.data.user.id,
                                      role: detail.data.user.role,
                                      isDisabled: detail.data.user.is_disabled,
                                      email: next,
                                    });
                                  }
                                }}
                                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                              />
                              <select
                                value={detail.data.user.role}
                                disabled={!isSuperUser}
                                onChange={(event) => updateUser.mutate({
                                  id: detail.data!.user.id,
                                  role: event.target.value as 'user' | 'admin' | 'super_user',
                                  isDisabled: detail.data!.user.is_disabled,
                                })}
                                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                              >
                                <option value="user">user</option>
                                <option value="admin">admin</option>
                                <option value="super_user">super_user</option>
                              </select>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => updateUser.mutate({
                                  id: detail.data!.user.id,
                                  role: detail.data!.user.role,
                                  isDisabled: !detail.data!.user.is_disabled,
                                })}
                              >
                                {detail.data.user.is_disabled ? 'Enable' : 'Disable'}
                              </Button>
                              {isSuperUser && (
                                <Button variant="danger" size="sm" onClick={() => deleteUser.mutate(detail.data!.user.id)}>
                                  Delete
                                </Button>
                              )}
                            </div>
                          </div>
                        )}

                        {activeTab === 'vehicles' && (
                          <div className="grid gap-3">
                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
                              <input
                                value={grantVehicleId}
                                onChange={(event) => setGrantVehicleId(event.target.value)}
                                placeholder="Vehicle UUID"
                                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                              />
                              <select
                                value={grantRole}
                                onChange={(event) => setGrantRole(event.target.value as 'owner' | 'manager' | 'viewer')}
                                className="h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg outline-none focus:border-accent"
                              >
                                <option value="owner">owner</option>
                                <option value="manager">manager</option>
                                <option value="viewer">viewer</option>
                              </select>
                              <Button
                                size="sm"
                                loading={grantMembership.isPending}
                                disabled={!grantVehicleId.trim()}
                                onClick={() => grantMembership.mutate({ userId: detail.data!.user.id, vehicleId: grantVehicleId.trim(), role: grantRole })}
                              >
                                Grant
                              </Button>
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-border">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-bg-elevated text-fg-tertiary">
                                  <tr>
                                    {['Vehicle', 'Role', 'Default', 'Actions'].map((heading) => (
                                      <th key={heading} className="px-3 py-2 font-medium">{heading}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {detail.data.memberships.map((membership) => (
                                    <tr key={membership.vehicle_id}>
                                      <td className="px-3 py-2 text-fg">{membership.display_name || membership.model}</td>
                                      <td className="px-3 py-2">
                                        <select
                                          value={membership.role}
                                          onChange={(event) => updateMembership.mutate({
                                            userId: detail.data!.user.id,
                                            vehicleId: membership.vehicle_id,
                                            role: event.target.value as 'owner' | 'manager' | 'viewer',
                                          })}
                                          className="h-8 rounded-md border border-border bg-bg-elevated px-2"
                                        >
                                          <option value="owner">owner</option>
                                          <option value="manager">manager</option>
                                          <option value="viewer">viewer</option>
                                        </select>
                                      </td>
                                      <td className="px-3 py-2">{membership.is_default ? 'yes' : 'no'}</td>
                                      <td className="px-3 py-2">
                                        <Button
                                          variant="danger"
                                          size="sm"
                                          onClick={() => removeMembership.mutate({ userId: detail.data!.user.id, vehicleId: membership.vehicle_id })}
                                        >
                                          Remove
                                        </Button>
                                      </td>
                                    </tr>
                                  ))}
                                  {detail.data.memberships.length === 0 && (
                                    <tr>
                                      <td colSpan={4} className="px-3 py-6 text-center text-fg-tertiary">No memberships found.</td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {activeTab === 'invites' && (
                          <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-bg-elevated text-fg-tertiary">
                                <tr>
                                  {['Vehicle', 'Role', 'Status', 'Expires', 'Actions'].map((heading) => (
                                    <th key={heading} className="px-3 py-2 font-medium">{heading}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {detail.data.invites.map((invite) => {
                                  const status = invite.accepted_at ? 'accepted' : invite.revoked_at ? 'revoked' : 'pending';
                                  return (
                                    <tr key={invite.id}>
                                      <td className="px-3 py-2 text-fg">{invite.vehicle_name}</td>
                                      <td className="px-3 py-2">{invite.role}</td>
                                      <td className="px-3 py-2">
                                        <Badge variant={status === 'pending' ? 'warning' : status === 'accepted' ? 'success' : 'danger'}>{status}</Badge>
                                      </td>
                                      <td className="px-3 py-2 text-fg-tertiary">{new Date(invite.expires_at).toLocaleString()}</td>
                                      <td className="px-3 py-2">
                                        {!invite.accepted_at && !invite.revoked_at && (
                                          <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() => revokeInvite.mutate({ userId: detail.data!.user.id, inviteId: invite.id })}
                                          >
                                            Revoke
                                          </Button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {detail.data.invites.length === 0 && (
                                  <tr>
                                    <td colSpan={5} className="px-3 py-6 text-center text-fg-tertiary">No invites found.</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </PageLayout>
    </AppLayout>
  );
}
