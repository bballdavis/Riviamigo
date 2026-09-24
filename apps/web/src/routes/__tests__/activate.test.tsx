import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => import('../../test/mockPrimitives'));

const { accept, startSso, navigate } = vi.hoisted(() => ({
  accept: vi.fn(),
  startSso: vi.fn(),
  navigate: vi.fn(),
}));
let preview = {
  email: 'invitee@example.com',
  expires_at: '2026-10-01T00:00:00Z',
  auth_methods: 'password' as 'password' | 'sso' | 'both',
  password_available: true,
  sso_available: false,
  button_label: 'Continue with SSO',
};

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ data: preview, isLoading: false, isError: false }),
}));
vi.mock('@riviamigo/hooks', () => ({
  api: { previewAccountInvitation: vi.fn(), startAccountInvitationOidc: startSso },
  useAuth: (selector: (state: { acceptAccountInvitation: typeof accept }) => unknown) => selector({ acceptAccountInvitation: accept }),
}));
vi.mock('@riviamigo/ui/hooks', () => ({ useDocumentTheme: () => true, useDocumentPalette: () => 'classic' }));

import { ActivatePage } from '../activate';

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/activate#invitation-token');
  preview = {
    email: 'invitee@example.com',
    expires_at: '2026-10-01T00:00:00Z',
    auth_methods: 'password',
    password_available: true,
    sso_available: false,
    button_label: 'Continue with SSO',
  };
  startSso.mockResolvedValue({ authorization_url: 'https://id.example/authorize' });
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, hash: '#invitation-token', pathname: '/activate', assign: vi.fn() } });
});

describe('ActivatePage invitation methods', () => {
  it('offers password setup for a password-only invitation', () => {
    render(<ActivatePage />);
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with SSO' })).not.toBeInTheDocument();
  });

  it('starts the token-bound SSO flow without asking for a password', async () => {
    preview = { ...preview, auth_methods: 'sso', password_available: false, sso_available: true };
    render(<ActivatePage />);
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue with SSO' }));
    await waitFor(() => expect(startSso).toHaveBeenCalledWith('invitation-token'));
    expect(window.location.assign).toHaveBeenCalledWith('https://id.example/authorize');
  });

  it('lets the recipient choose either allowed method', () => {
    preview = { ...preview, auth_methods: 'both', sso_available: true };
    render(<ActivatePage />);
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with SSO' })).toBeInTheDocument();
  });

  it('explains when the configured sign-in method is unavailable', () => {
    preview = { ...preview, password_available: false };
    render(<ActivatePage />);
    expect(screen.getByText(/sign-in method is currently unavailable/i)).toBeInTheDocument();
  });
});
