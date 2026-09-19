import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => import('../../../test/mockPrimitives'));
const { getSettings, updateSettings, testSettings } = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn(), testSettings: vi.fn() }));
vi.mock('@riviamigo/hooks', () => ({ api: { getAuthenticationSettings: getSettings, updateAuthenticationSettings: updateSettings, testAuthenticationSettings: testSettings }, queryKeys: { auth: { authenticationSettings: ['authentication-settings'] } } }));
import { AuthenticationSection } from '../AuthenticationSection';

const response = { oidc_enabled: { value: false, source: 'database' }, password_login_enabled: { value: true, source: 'environment' }, issuer_url: { value: 'https://issuer.example', source: 'database' }, public_base_url: { value: 'https://app.example', source: 'database' }, client_id: { value: 'client', source: 'database' }, client_secret: { configured: true, source: 'database' }, button_label: { value: 'Continue with SSO', source: 'database' }, scopes: { value: 'openid email', source: 'database' }, token_auth_method: { value: 'client_secret_basic', source: 'database' }, auto_signup: { value: false, source: 'database' }, auto_link_verified_email: { value: false, source: 'database' }, allowed_email_domains: { value: [], source: 'database' }, required_claim_name: { value: null, source: 'database' }, required_claim_value: { value: null, source: 'database' }, last_validation_at: null, callback_url: 'https://app.example/v1/auth/oidc/callback' };
function renderSection() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthenticationSection /></QueryClientProvider>); }
beforeEach(() => { getSettings.mockResolvedValue(response); updateSettings.mockResolvedValue(response); testSettings.mockResolvedValue({ valid: true }); });

describe('AuthenticationSection', () => {
  it('disables environment-owned controls and omits them from save payload', async () => {
    const user = userEvent.setup(); renderSection();
    await screen.findByText('Keep password login');
    const password = screen.getByRole('switch', { name: 'Keep password login' });
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
    await user.type(screen.getByPlaceholderText('Enter replacement secret'), 'new-secret');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(updateSettings.mock.calls.at(-1)?.[0]).toHaveProperty('client_secret', 'new-secret');
    await user.click(screen.getByRole('button', { name: 'Clear secret' })); await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(updateSettings.mock.calls.at(-1)?.[0]).toHaveProperty('client_secret', null);
  });

  it('shows validation feedback after a successful provider test', async () => {
    const user = userEvent.setup(); renderSection(); await user.click(await screen.findByRole('button', { name: 'Test provider' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/validated/i);
  });
});
