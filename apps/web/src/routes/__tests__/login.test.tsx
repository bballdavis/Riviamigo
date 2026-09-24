import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => import('../../test/mockPrimitives'));

const mockNavigate = vi.fn();
let mockSearch = {} as { redirect?: string; password_changed?: '1'; error?: 'oidc_cancelled' | 'oidc_expired' | 'oidc_denied' | 'oidc_failed' };
let setupRequired = false;
let setupProofRequired = false;
let setupProofAvailable = false;
let authConfig: { oidc_enabled: boolean; oidc_ready: boolean; password_login_enabled: boolean; oidc_auto_login?: boolean; button_label: string } | undefined;
let isAuthenticated = false;
let isBootstrapping = false;
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: ({ queryKey }: { queryKey: string[] }) => queryKey[0] === 'auth-config'
    ? { data: authConfig }
    : { data: { setup_required: setupRequired, setup_proof_required: setupProofRequired, setup_proof_available: setupProofAvailable }, isSuccess: true },
}));

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockResumeSession = vi.fn();
const mockStartOidc = vi.hoisted(() => vi.fn());
vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({
    login: mockLogin,
    register: mockRegister,
    isAuthenticated,
    isBootstrapping,
    resumeSession: mockResumeSession,
  }),
  useDocumentTheme: () => false,
  api: { setup: vi.fn(), getAuthConfig: vi.fn(), startOidc: mockStartOidc },
}));

import { LoginPage } from '../login';

beforeEach(() => {
  mockNavigate.mockClear(); mockLogin.mockClear(); mockRegister.mockClear(); mockResumeSession.mockReset(); mockStartOidc.mockReset();
  mockSearch = {}; setupRequired = false; setupProofRequired = false; setupProofAvailable = false;
  authConfig = { oidc_enabled: false, oidc_ready: false, password_login_enabled: true, oidc_auto_login: false, button_label: 'Sign in with SSO' };
  isAuthenticated = false; isBootstrapping = false;
});

describe('LoginPage', () => {
  it('renders the normal sign-in state after initial setup', () => {
    render(<LoginPage />);
    expect(screen.getByAltText('Riviamigo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/ask an administrator for an activation link/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create one/i })).not.toBeInTheDocument();
  });

  it('renders first-owner setup for an empty installation', () => {
    authConfig = { oidc_enabled: true, oidc_ready: true, password_login_enabled: false, button_label: 'Company SSO' };
    setupRequired = true;
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /create owner account/i })).toBeInTheDocument();
    expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0/12');
    expect(document.querySelector('input[type="password"]')).toHaveAttribute('minlength', '12');
    expect(screen.queryByRole('button', { name: 'Company SSO' })).not.toBeInTheDocument();
  });

  it('shows SSO and password sign-in when both methods are enabled', () => {
    authConfig = { oidc_enabled: true, oidc_ready: true, password_login_enabled: true, button_label: 'Company SSO' };
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: 'Company SSO' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('or')).toBeInTheDocument();
  });

  it('shows only SSO when password login is disabled', () => {
    authConfig = { oidc_enabled: true, oidc_ready: true, password_login_enabled: false, button_label: 'Company SSO' };
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: 'Company SSO' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('starts SSO once when automatic sign-in is enabled and password login is disabled', async () => {
    authConfig = { oidc_enabled: true, oidc_ready: true, password_login_enabled: false, oidc_auto_login: true, button_label: 'Company SSO' };
    mockSearch = { redirect: '/charging?view=table' };
    mockStartOidc.mockRejectedValue(new Error('provider unavailable'));
    render(<LoginPage />);
    await waitFor(() => expect(mockStartOidc).toHaveBeenCalledTimes(1));
    expect(mockStartOidc).toHaveBeenCalledWith('/charging?view=table');
    expect(await screen.findByRole('alert')).toHaveTextContent('Contact an administrator');
    expect(screen.getByRole('button', { name: 'Company SSO' })).toBeInTheDocument();
  });

  it('starts SSO with password login enabled and leaves the password form after a failed start', async () => {
    authConfig = { oidc_enabled: true, oidc_ready: true, password_login_enabled: true, oidc_auto_login: true, button_label: 'Company SSO' };
    mockStartOidc.mockRejectedValue(new Error('provider unavailable'));
    const { rerender } = render(<LoginPage />);
    await waitFor(() => expect(mockStartOidc).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use your password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    rerender(<LoginPage />);
    await act(async () => {});
    expect(mockStartOidc).toHaveBeenCalledTimes(1);
  });

  it('waits for session restoration before starting automatic SSO', async () => {
    authConfig = { oidc_enabled: true, oidc_ready: true, password_login_enabled: false, oidc_auto_login: true, button_label: 'Company SSO' };
    isBootstrapping = true;
    let resolveResume!: (resumed: boolean) => void;
    mockResumeSession.mockImplementation(() => new Promise<boolean>((resolve) => { resolveResume = resolve; }));
    mockStartOidc.mockRejectedValue(new Error('provider unavailable'));

    const { rerender } = render(<LoginPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/restoring your session/i);
    expect(mockStartOidc).not.toHaveBeenCalled();

    isBootstrapping = false;
    await act(async () => { resolveResume(false); });
    rerender(<LoginPage />);
    await waitFor(() => expect(mockStartOidc).toHaveBeenCalledTimes(1));
  });

  it('waits until the provider is ready before starting automatic SSO', async () => {
    authConfig = { oidc_enabled: false, oidc_ready: false, password_login_enabled: false, oidc_auto_login: true, button_label: 'Company SSO' };
    mockStartOidc.mockRejectedValue(new Error('provider unavailable'));
    const { rerender } = render(<LoginPage />);
    await act(async () => {});
    expect(mockStartOidc).not.toHaveBeenCalled();
    authConfig = { ...authConfig, oidc_enabled: true, oidc_ready: true };
    rerender(<LoginPage />);
    await waitFor(() => expect(mockStartOidc).toHaveBeenCalledTimes(1));
  });

  it('does not restart SSO after a provider callback error or during first-owner setup', async () => {
    authConfig = { oidc_enabled: true, oidc_ready: true, password_login_enabled: false, oidc_auto_login: true, button_label: 'Company SSO' };
    mockSearch = { error: 'oidc_failed' };
    const { rerender } = render(<LoginPage />);
    await act(async () => {});
    expect(mockStartOidc).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('contact an administrator');
    setupRequired = true;
    mockSearch = {};
    rerender(<LoginPage />);
    await act(async () => {});
    expect(mockStartOidc).not.toHaveBeenCalled();
  });

  it('keeps a failed callback on the login page without automatic restart when password login is enabled', async () => {
    authConfig = { oidc_enabled: true, oidc_ready: true, password_login_enabled: true, oidc_auto_login: true, button_label: 'Company SSO' };
    mockSearch = { error: 'oidc_failed' };
    render(<LoginPage />);
    await act(async () => {});
    expect(mockStartOidc).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('use your password');
  });

  it('preserves a safe redirect when starting SSO', async () => {
    authConfig = { oidc_enabled: true, oidc_ready: true, password_login_enabled: true, button_label: 'Company SSO' };
    mockSearch = { redirect: '/charging?view=table' };
    mockStartOidc.mockRejectedValue(new Error('provider unavailable'));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: 'Company SSO' }));
    expect(mockStartOidc).toHaveBeenCalledWith('/charging?view=table');
  });

  it('shows a stable callback error without provider details', () => {
    mockSearch = { error: 'oidc_expired' };
    render(<LoginPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/attempt expired/i);
  });

  it('logs in and preserves the requested redirect', async () => {
    mockLogin.mockResolvedValue(undefined); mockSearch = { redirect: '/charging?view=table' };
    const user = userEvent.setup(); render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'owner@example.com');
    await user.type(document.querySelector('input[type="password"]')!, 'password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/charging?view=table' }));
  });

  it('resumes a valid session and preserves the requested redirect', async () => {
    isBootstrapping = true;
    mockSearch = { redirect: '/dashboard?vehicle=primary' };
    mockResumeSession.mockResolvedValue(true);

    render(<LoginPage />);

    expect(screen.getByRole('status')).toHaveTextContent(/restoring your session/i);
    await waitFor(() => expect(mockResumeSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard?vehicle=primary',
      replace: true,
    }));
  });

  it('shows the sign-in form when no session can be resumed', async () => {
    isBootstrapping = true;
    mockResumeSession.mockResolvedValue(false);

    render(<LoginPage />);

    await waitFor(() => expect(mockResumeSession).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not resume after a password change', () => {
    isBootstrapping = true;
    mockSearch = { password_changed: '1' };

    render(<LoginPage />);

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(mockResumeSession).not.toHaveBeenCalled();
  });

  it('redirects an already-authenticated visitor', async () => {
    isAuthenticated = true;
    mockSearch = { redirect: '/settings' };

    render(<LoginPage />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/settings', replace: true }));
    expect(mockResumeSession).not.toHaveBeenCalled();
  });

  it('does not navigate after an in-flight resume is unmounted', async () => {
    isBootstrapping = true;
    let resolveResume!: (value: boolean) => void;
    mockResumeSession.mockImplementation(() => new Promise<boolean>((resolve) => { resolveResume = resolve; }));

    const { unmount } = render(<LoginPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/restoring your session/i);
    unmount();

    await act(async () => { resolveResume(true); });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('drops a nested login redirect instead of creating a login loop', async () => {
    isAuthenticated = true;
    mockSearch = { redirect: '/login?redirect=%2Fdashboard' };

    render(<LoginPage />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/', replace: true }));
  });

  it('keeps a sign-in failure inline and announces it as an error toast', async () => {
    mockLogin.mockRejectedValue({ status: 401 });
    const toast = vi.fn();
    window.addEventListener('riviamigo:toast', toast as EventListener);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'owner@example.com');
    await user.type(document.querySelector('input[type="password"]')!, 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    try {
      const message = 'Incorrect email or password. Please try again.';
      expect(await screen.findByText(message)).toBeInTheDocument();
      await waitFor(() => expect(toast).toHaveBeenCalled());
      const event = toast.mock.calls.at(0)?.at(0) as CustomEvent | undefined;
      expect(event?.detail).toMatchObject({
        title: 'Sign-in failed',
        message,
        variant: 'error',
      });
    } finally {
      window.removeEventListener('riviamigo:toast', toast as EventListener);
    }
  });

  it('registers the owner and opens Rivian connection only during setup', async () => {
    setupRequired = true; mockRegister.mockResolvedValue(undefined);
    const user = userEvent.setup(); render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'owner@example.com');
    await user.type(document.querySelector('input[type="password"]')!, 'fresh-install-password');
    await user.click(screen.getByRole('button', { name: /create owner account/i }));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith('owner@example.com', 'fresh-install-password', undefined));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/connect' });
  });

  it('collects the configured setup token for production first-owner setup', async () => {
    setupRequired = true; setupProofRequired = true; setupProofAvailable = true;
    mockRegister.mockResolvedValue(undefined);
    const user = userEvent.setup(); render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'owner@example.com');
    await user.type(document.querySelector('input[type="password"]')!, 'fresh-install-password');
    await user.type(screen.getByLabelText('Instance setup token'), 'correct-setup-token');
    await user.click(screen.getByRole('button', { name: /create owner account/i }));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith('owner@example.com', 'fresh-install-password', 'correct-setup-token'));
  });

  it('explains when production setup has no configured proof', async () => {
    setupRequired = true; setupProofRequired = true; setupProofAvailable = false;
    const user = userEvent.setup(); render(<LoginPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/needs a setup token/i);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'owner@example.com');
    await user.type(document.querySelector('input[type="password"]')!, 'fresh-install-password');
    await user.click(screen.getByRole('button', { name: /create owner account/i }));
    expect(mockRegister).not.toHaveBeenCalled();
    expect(screen.getByText(/recreate the app without deleting the database/i)).toBeInTheDocument();
  });
});
