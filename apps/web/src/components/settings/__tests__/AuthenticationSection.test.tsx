import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => import('../../../test/mockPrimitives'));
const { getSettings, updateSettings, testSettings } = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn(), testSettings: vi.fn() }));
vi.mock('@riviamigo/hooks', () => ({ api: { getAuthenticationSettings: getSettings, updateAuthenticationSettings: updateSettings, testAuthenticationSettings: testSettings }, queryKeys: { auth: { authenticationSettings: ['authentication-settings'] } } }));
import { AuthenticationSection } from '../AuthenticationSection';

const response = { oidc_enabled: { value: false, source: 'database' }, password_login_enabled: { value: true, source: 'environment' }, oidc_auto_login: { value: false, source: 'database' }, issuer_url: { value: 'https://issuer.example', source: 'database' }, public_base_url: { value: 'https://app.example', source: 'database' }, client_id: { value: 'client', source: 'database' }, client_secret: { configured: true, source: 'database' }, button_label: { value: 'Continue with SSO', source: 'database' }, scopes: { value: 'openid email', source: 'database' }, token_auth_method: { value: 'client_secret_basic', source: 'database' }, auto_signup: { value: false, source: 'database' }, auto_link_verified_email: { value: false, source: 'database' }, allowed_email_domains: { value: [], source: 'database' }, required_claim_name: { value: null, source: 'database' }, required_claim_value: { value: null, source: 'database' }, last_validation_at: null, callback_url: 'https://app.example/v1/auth/oidc/callback' };
function renderSection() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthenticationSection /></QueryClientProvider>); }
beforeEach(() => { getSettings.mockResolvedValue(response); updateSettings.mockResolvedValue(response); testSettings.mockResolvedValue({ valid: true }); });

describe('AuthenticationSection', () => {
  it('disables environment-owned controls and omits them from save payload', async () => {
    const user = userEvent.setup(); renderSection();
    await screen.findByText('Allow password login');
    const password = screen.getByRole('switch', { name: 'Allow password login' });
    expect(password).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls[0]?.[0]).not.toHaveProperty('password_login_enabled');
    expect(updateSettings.mock.calls[0]?.[0]).not.toHaveProperty('issuer_url');
  });

  it('keeps, replaces, and explicitly clears the write-only secret', async () => {
    const user = userEvent.setup(); renderSection(); await screen.findByText('Authentication');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(updateSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty('client_secret');
    const secret = screen.getByPlaceholderText('Enter replacement secret');
    await user.type(secret, 'new-secret');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(updateSettings.mock.calls.at(-1)?.[0]).toHaveProperty('client_secret', 'new-secret');
    await user.clear(secret);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(updateSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty('client_secret');
    await user.click(screen.getByRole('checkbox', { name: 'Remove stored secret when saving' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(updateSettings.mock.calls.at(-1)?.[0]).toHaveProperty('client_secret', null);
  });

  it('removes saved and default source chips while preserving environment indicators', async () => {
    renderSection();
    await screen.findByText('Provider connection');
    expect(screen.queryByText('Saved', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Default', { exact: true })).not.toBeInTheDocument();
    expect(screen.getAllByText('Environment', { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText('Sign-in options')).toBeInTheDocument();
    const signIn = screen.getByText('Sign-in options');
    const provider = screen.getByText('Provider connection');
    expect(signIn.compareDocumentPosition(provider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Account access')).toBeInTheDocument();
    expect(screen.getByText('Advanced provider options')).toBeInTheDocument();
  });

  it('saves the automatic SSO setting with the other sign-in choices', async () => {
    const user = userEvent.setup(); renderSection();
    const autoLogin = await screen.findByRole('switch', { name: 'Automatically login to SSO' });
    await user.click(autoLogin);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls.at(-1)?.[0]).toHaveProperty('oidc_auto_login', true);
  });

  it('saves the site-wide password-login choice when it is database-owned', async () => {
    getSettings.mockResolvedValueOnce({
      ...response,
      password_login_enabled: { value: true, source: 'database' },
    });
    const user = userEvent.setup();
    renderSection();
    const passwordLogin = await screen.findByRole('switch', { name: 'Allow password login' });
    expect(passwordLogin).toBeEnabled();
    await user.click(passwordLogin);
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(updateSettings.mock.calls.at(-1)?.[0]).toHaveProperty('password_login_enabled', false));
  });

  it('disables environment-owned secrets and omits them from the save payload', async () => {
    getSettings.mockResolvedValueOnce({ ...response, client_secret: { configured: true, source: 'environment' } });
    const user = userEvent.setup(); renderSection();
    const secret = await screen.findByPlaceholderText('Enter replacement secret');
    expect(secret).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Remove stored secret when saving' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(updateSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty('client_secret');
  });

  it('shows validation feedback after a successful provider test', async () => {
    const user = userEvent.setup(); renderSection(); await user.click(await screen.findByRole('button', { name: 'Test provider' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/validated/i);
  });

  it('explains the broad verified-email account linking policy', async () => {
    const user = userEvent.setup(); renderSection();
    const toggle = await screen.findByRole('switch', { name: 'Link verified existing emails' });
    expect(screen.queryByText(/automatic account linking is on/i)).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText(/automatic account linking is on/i)).toBeInTheDocument();
    expect(screen.getByText(/anyone whose verified email/i)).toBeInTheDocument();
  });

  it('clears stale save feedback when the form changes', async () => {
    updateSettings.mockRejectedValueOnce(new Error('invalid settings'));
    const user = userEvent.setup(); renderSection();
    await user.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/unable to save/i);
    await user.type(screen.getByRole('textbox', { name: /button label/i }), ' updated');
    expect(screen.queryByText(/unable to save/i)).not.toBeInTheDocument();
  });

  it('shows the server validation reason when settings are rejected', async () => {
    updateSettings.mockRejectedValueOnce({
      detail: { message: 'OIDC required claim name and value must be configured together.' },
    });
    const user = userEvent.setup(); renderSection();
    await user.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/claim name and value/i);
  });
});
