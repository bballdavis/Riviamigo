import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => import('../../../test/mockPrimitives'));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => ({ status: 'idle' }) }));
const { getSettings, updateSettings, testSettings } = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn(), testSettings: vi.fn() }));
vi.mock('@riviamigo/hooks', () => ({ api: { getAuthenticationSettings: getSettings, updateAuthenticationSettings: updateSettings, testAuthenticationSettings: testSettings }, queryKeys: { auth: { authenticationSettings: ['authentication-settings'], config: ['auth-config'] } } }));
import { SettingsDraftProvider } from '../../../features/settings/drafts/SettingsDraftProvider';
import { AuthenticationSection } from '../AuthenticationSection';

const response = { oidc_enabled: { value: false, source: 'database' }, password_login_enabled: { value: true, source: 'environment' }, oidc_auto_login: { value: false, source: 'database' }, issuer_url: { value: 'https://issuer.example', source: 'database' }, public_base_url: { value: 'https://app.example', source: 'database' }, client_id: { value: 'client', source: 'database' }, client_secret: { configured: true, source: 'database' }, button_label: { value: 'Continue with SSO', source: 'database' }, scopes: { value: 'openid email', source: 'database' }, token_auth_method: { value: 'client_secret_basic', source: 'database' }, auto_signup: { value: false, source: 'database' }, auto_link_verified_email: { value: false, source: 'database' }, allowed_email_domains: { value: [], source: 'database' }, required_claim_name: { value: null, source: 'database' }, required_claim_value: { value: null, source: 'database' }, last_validation_at: null, callback_url: 'https://app.example/v1/auth/oidc/callback' };
function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <SettingsDraftProvider>
          <AuthenticationSection />
        </SettingsDraftProvider>
      </QueryClientProvider>,
    ),
  };
}
const UNSAVED = 'Unsaved changes';
beforeEach(() => { vi.clearAllMocks(); getSettings.mockResolvedValue(response); updateSettings.mockResolvedValue(response); testSettings.mockResolvedValue({ valid: true }); });

describe('AuthenticationSection', () => {
  it('stages edits behind the page save bar and sends only changed non-environment fields', async () => {
    const user = userEvent.setup(); renderSection();
    await screen.findByText('Allow password login');
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Allow password login' })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: /button label/i }), ' updated');
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]?.[0]).toEqual({ button_label: 'Continue with SSO updated' });
    expect(updateSettings.mock.calls[0]?.[0]).not.toHaveProperty('password_login_enabled');
    expect(updateSettings.mock.calls[0]?.[0]).not.toHaveProperty('issuer_url');
    expect(updateSettings.mock.calls[0]?.[0]).not.toHaveProperty('client_secret');
    await waitFor(() => expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument());
  });

  it('keeps the bar open and shows the server validation reason when save is rejected', async () => {
    updateSettings.mockRejectedValueOnce({
      detail: { message: 'OIDC required claim name and value must be configured together.' },
    });
    const user = userEvent.setup(); renderSection();
    await user.type(await screen.findByRole('textbox', { name: /button label/i }), ' updated');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/claim name and value/i);
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
  });

  it('does not submit when Enter is pressed in a field', async () => {
    const user = userEvent.setup(); renderSection();
    await user.type(await screen.findByRole('textbox', { name: /button label/i }), ' updated{Enter}');
    expect(updateSettings).not.toHaveBeenCalled();
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
  });

  it('discard reverts staged fields and clears a typed secret', async () => {
    const user = userEvent.setup(); renderSection();
    await user.type(await screen.findByRole('textbox', { name: /button label/i }), ' updated');
    await user.type(screen.getByPlaceholderText('Enter replacement secret'), 'pending-secret');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /button label/i })).toHaveValue('Continue with SSO');
    expect(screen.getByPlaceholderText('Enter replacement secret')).toHaveValue('');
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('keeps staged edits when the settings refetch while the form is dirty', async () => {
    const user = userEvent.setup(); const { client } = renderSection();
    await user.type(await screen.findByRole('textbox', { name: /button label/i }), ' updated');
    getSettings.mockResolvedValue({ ...response, button_label: { value: 'Server label', source: 'database' }, last_validation_at: '2026-07-01T10:00:00Z' });
    await act(async () => { await client.invalidateQueries({ queryKey: ['authentication-settings'] }); });
    await waitFor(() => expect(screen.getByText(/last validation/i)).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: /button label/i })).toHaveValue('Continue with SSO updated');
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
  });

  it('follows server data while the form is clean', async () => {
    const { client } = renderSection();
    expect(await screen.findByRole('textbox', { name: /button label/i })).toHaveValue('Continue with SSO');
    getSettings.mockResolvedValue({ ...response, button_label: { value: 'Server label', source: 'database' } });
    await act(async () => { await client.invalidateQueries({ queryKey: ['authentication-settings'] }); });
    await waitFor(() => expect(screen.getByRole('textbox', { name: /button label/i })).toHaveValue('Server label'));
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();
  });

  it('stages the write-only secret until Save, then supports replacement and explicit removal', async () => {
    const user = userEvent.setup(); renderSection();
    const secret = await screen.findByPlaceholderText('Enter replacement secret');
    await user.type(secret, 'new-secret');
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]?.[0]).toEqual({ client_secret: 'new-secret' });
    await waitFor(() => expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Enter replacement secret'), 'x');
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Enter replacement secret'));
    expect(screen.queryByText(UNSAVED)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Remove stored secret when saving' }));
    expect(screen.getByText(UNSAVED)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2));
    expect(updateSettings.mock.calls.at(-1)?.[0]).toEqual({ client_secret: null });
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSettings.mock.calls.at(-1)?.[0]).toHaveProperty('password_login_enabled', false));
  });

  it('disables environment-owned secrets and omits them from the save payload', async () => {
    getSettings.mockResolvedValueOnce({ ...response, client_secret: { configured: true, source: 'environment' } });
    const user = userEvent.setup(); renderSection();
    const secret = await screen.findByPlaceholderText('Enter replacement secret');
    expect(secret).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Remove stored secret when saving' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /button label/i }), ' updated');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty('client_secret');
  });

  it('shows validation feedback after a successful provider test', async () => {
    const user = userEvent.setup(); renderSection(); await user.click(await screen.findByRole('button', { name: 'Test provider' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/validated/i);
  });

  it('shows an actionable error when authentication settings cannot be loaded', async () => {
    getSettings.mockRejectedValueOnce(new Error('settings unavailable'));
    renderSection();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
  });

  it('shows provider validation failure feedback', async () => {
    testSettings.mockRejectedValueOnce(new Error('provider unavailable'));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Test provider' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/provider validation failed/i);
  });

  it('explains the broad verified-email account linking policy', async () => {
    const user = userEvent.setup(); renderSection();
    const toggle = await screen.findByRole('switch', { name: 'Link verified existing emails' });
    expect(screen.queryByText(/automatic account linking is on/i)).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByText(/automatic account linking is on/i)).toBeInTheDocument();
    expect(screen.getByText(/anyone whose verified email/i)).toBeInTheDocument();
  });
});
