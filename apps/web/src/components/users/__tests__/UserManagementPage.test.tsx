import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  listAccountInvitations: vi.fn(),
  listAdminVehicleOptions: vi.fn(),
  getUserDetail: vi.fn(),
  createAccountInvitation: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  revokeAccountInvitation: vi.fn(),
  grantUserVehicleMembership: vi.fn(),
  updateUserVehicleMembership: vi.fn(),
  removeUserVehicleMembership: vi.fn(),
  revokeUserInvite: vi.fn(),
}));

vi.mock('@riviamigo/hooks', () => ({
  api: apiMocks,
  useAuth: () => ({ accessToken: 'token' }),
  useAuthReady: () => true,
  useMe: () => ({ data: { role: 'super_user' } }),
}));

vi.mock('../../layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { UserManagementPage } from '../UserManagementPage';

const user = {
  id: 'user-1',
  email: 'driver@example.com',
  role: 'user' as const,
  is_disabled: false,
  vehicle_count: 1,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

const secondUser = {
  ...user,
  id: 'user-2',
  email: 'second@example.com',
  vehicle_count: 0,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><UserManagementPage /></QueryClientProvider>);
}

describe('UserManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listUsers.mockResolvedValue([user, secondUser]);
    apiMocks.listAccountInvitations.mockResolvedValue([
      { id: 'invite-1', invitee_email: 'new@example.com', expires_at: '2026-07-20T00:00:00Z', accepted_at: null, revoked_at: null, created_at: '2026-07-01T00:00:00Z' },
      { id: 'invite-2', invitee_email: 'accepted@example.com', expires_at: '2026-07-10T00:00:00Z', accepted_at: '2026-07-02T00:00:00Z', revoked_at: null, created_at: '2026-07-01T00:00:00Z' },
    ]);
    apiMocks.listAdminVehicleOptions.mockResolvedValue([{ id: 'vehicle-1', display_name: 'R1S', model: 'R1S' }]);
    apiMocks.getUserDetail.mockImplementation(async (id: string) => ({
      user: id === secondUser.id ? secondUser : user,
      memberships: [{ vehicle_id: 'vehicle-1', role: 'viewer', is_default: true, created_at: '2026-07-01T00:00:00Z', model: 'R1S', display_name: 'R1S' }],
      invites: [],
    }));
    apiMocks.createAccountInvitation.mockResolvedValue({ id: 'invite-3', invitee_email: 'new@example.com', expires_at: '2026-07-20T00:00:00Z', activation_token: 'one-time-token' });
  });

  it('separates the accounts workspace from invitations and uses a named vehicle picker', async () => {
    const actor = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('button', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invitations' })).toBeInTheDocument();
    expect((await screen.findAllByText('driver@example.com')).length).toBeGreaterThan(0);

    await actor.click(screen.getByRole('button', { name: /second@example\.com/ }));
    await waitFor(() => expect(apiMocks.getUserDetail).toHaveBeenLastCalledWith('user-2'));

    await actor.click(await screen.findByRole('tab', { name: 'Vehicles' }));
    expect(await screen.findByLabelText('Vehicle')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'R1S · R1S' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Vehicle UUID')).not.toBeInTheDocument();

    await actor.click(screen.getByRole('button', { name: /Invitations/ }));
    expect(await screen.findByRole('heading', { name: 'Account invitations' })).toBeInTheDocument();
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    expect(screen.getByText('Invitation history (1)')).toBeInTheDocument();
  });

  it('shows the activation link only in the invitation dialog and confirms destructive actions', async () => {
    const actor = userEvent.setup();
    renderPage();

    await actor.click(await screen.findByRole('button', { name: 'Invite user' }));
    expect(screen.getByRole('dialog', { name: 'Invite user' })).toBeInTheDocument();
    await actor.type(screen.getByLabelText('Email address'), 'new@example.com');
    await actor.click(screen.getByRole('button', { name: 'Create invitation' }));
    expect((await screen.findByLabelText('Activation link')).getAttribute('value')).toContain('/activate#one-time-token');
    await actor.click(screen.getByRole('button', { name: 'Copy activation link' }));
    expect(screen.getByRole('button', { name: 'Activation link copied' })).toBeInTheDocument();

    await actor.click(screen.getByRole('button', { name: 'Close invite dialog' }));
    await actor.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByRole('dialog', { name: 'Delete driver@example.com?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Delete driver@example.com?' })).not.toBeInTheDocument();
  });

  it('requires an explicit save for account edits', async () => {
    const actor = userEvent.setup();
    apiMocks.updateUser.mockResolvedValue(undefined);
    renderPage();

    await actor.click(await screen.findByRole('button', { name: 'Edit account' }));
    const email = screen.getByLabelText('Account email');
    await actor.clear(email);
    await actor.type(email, 'updated@example.com');
    expect(apiMocks.updateUser).not.toHaveBeenCalled();
    await actor.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMocks.updateUser).toHaveBeenCalledWith('user-1', { email: 'updated@example.com' }));
  });
});
