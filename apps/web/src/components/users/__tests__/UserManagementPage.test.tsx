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
  getAuthConfig: vi.fn(),
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
      { id: 'invite-1', invitee_email: 'new@example.com', vehicle_names: [], auth_methods: 'password', expires_at: '2026-07-20T00:00:00Z', accepted_at: null, revoked_at: null, created_at: '2026-07-01T00:00:00Z' },
      { id: 'invite-2', invitee_email: 'accepted@example.com', vehicle_names: [], auth_methods: 'password', expires_at: '2026-07-10T00:00:00Z', accepted_at: '2026-07-02T00:00:00Z', revoked_at: null, created_at: '2026-07-01T00:00:00Z' },
    ]);
    apiMocks.listAdminVehicleOptions.mockResolvedValue([{ id: 'vehicle-1', display_name: 'R1S', model: 'R1S' }]);
    apiMocks.getUserDetail.mockImplementation(async (id: string) => ({
      user: id === secondUser.id ? secondUser : user,
      memberships: [{ vehicle_id: 'vehicle-1', role: 'viewer', is_default: true, created_at: '2026-07-01T00:00:00Z', model: 'R1S', display_name: 'R1S' }],
      invites: [],
    }));
    apiMocks.createAccountInvitation.mockResolvedValue({ id: 'invite-3', invitee_email: 'new@example.com', expires_at: '2026-07-20T00:00:00Z', activation_token: 'one-time-token' });
    apiMocks.getAuthConfig.mockResolvedValue({ oidc_enabled: false, oidc_ready: false, password_login_enabled: true, button_label: 'Continue with SSO' });
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
    await actor.click(screen.getByLabelText('Vehicle'));
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
    await actor.click(screen.getByRole('button', { name: 'Continue' }));
    await actor.click(screen.getByRole('checkbox', { name: /R1S/ }));
    await actor.click(screen.getByRole('button', { name: 'Create invitation' }));
    await waitFor(() => expect(apiMocks.createAccountInvitation).toHaveBeenCalledWith({ email: 'new@example.com', vehicle_ids: ['vehicle-1'], auth_methods: 'password' }));
    expect((await screen.findByLabelText('Activation link')).getAttribute('value')).toContain('/activate#one-time-token');
    await actor.click(screen.getByRole('button', { name: 'Copy activation link' }));
    expect(screen.getByRole('button', { name: 'Activation link copied' })).toBeInTheDocument();

    await actor.click(screen.getByRole('button', { name: 'Close invite dialog' }));
    await actor.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByRole('dialog', { name: 'Delete driver@example.com?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Delete driver@example.com?' })).not.toBeInTheDocument();
  });

  it('defaults account invitations to no vehicle access', async () => {
    const actor = userEvent.setup();
    renderPage();

    await actor.click(await screen.findByRole('button', { name: 'Invite user' }));
    await actor.type(screen.getByLabelText('Email address'), 'none@example.com');
    await actor.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/leave all unchecked for no vehicle access/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /R1S/ })).not.toBeChecked();
    await actor.click(screen.getByRole('button', { name: 'Create invitation' }));

    await waitFor(() => expect(apiMocks.createAccountInvitation).toHaveBeenCalledWith({ email: 'none@example.com', vehicle_ids: [], auth_methods: 'password' }));
  });

  it('defaults to SSO only when password login is disabled', async () => {
    const actor = userEvent.setup();
    apiMocks.getAuthConfig.mockResolvedValue({ oidc_enabled: true, oidc_ready: true, password_login_enabled: false, button_label: 'Continue with SSO' });
    renderPage();
    await actor.click(await screen.findByRole('button', { name: 'Invite user' }));
    expect(await screen.findByRole('button', { name: 'Sign-in methods' })).toHaveTextContent('SSO only');
    await actor.type(screen.getByLabelText('Email address'), 'sso@example.com');
    await actor.click(screen.getByRole('button', { name: 'Continue' }));
    await actor.click(screen.getByRole('button', { name: 'Create invitation' }));
    await waitFor(() => expect(apiMocks.createAccountInvitation).toHaveBeenCalledWith({ email: 'sso@example.com', vehicle_ids: [], auth_methods: 'sso' }));
  });

  it('defaults to both when both methods are available and allows a narrower choice', async () => {
    const actor = userEvent.setup();
    apiMocks.getAuthConfig.mockResolvedValue({ oidc_enabled: true, oidc_ready: true, password_login_enabled: true, button_label: 'Continue with SSO' });
    renderPage();
    await actor.click(await screen.findByRole('button', { name: 'Invite user' }));
    const picker = await screen.findByRole('button', { name: 'Sign-in methods' });
    expect(picker).toHaveTextContent('Password and SSO');
    await actor.click(picker);
    await actor.click(screen.getByRole('option', { name: 'SSO only' }));
    await actor.type(screen.getByLabelText('Email address'), 'choice@example.com');
    await actor.click(screen.getByRole('button', { name: 'Continue' }));
    await actor.click(screen.getByRole('button', { name: 'Create invitation' }));
    await waitFor(() => expect(apiMocks.createAccountInvitation).toHaveBeenCalledWith({ email: 'choice@example.com', vehicle_ids: [], auth_methods: 'sso' }));
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
