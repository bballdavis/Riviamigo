import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@riviamigo/ui/primitives', async () => import('../../../test/mockPrimitives'));
const { identities, startLink, startPasswordSetup, unlink } = vi.hoisted(() => ({
  identities: vi.fn(),
  startLink: vi.fn(),
  startPasswordSetup: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock('@riviamigo/hooks', () => ({
  api: {
    getOidcIdentities: identities,
    startOidcLink: startLink,
    startOidcPasswordSetup: startPasswordSetup,
    unlinkOidc: unlink,
  },
  queryKeys: { auth: { identities: ['auth-identities'] } },
}));
import { AccountIdentitySection } from '../AccountIdentitySection';
function renderSection() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AccountIdentitySection />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  identities.mockResolvedValue({
    password_configured: true,
    oidc_linked: false,
    oidc_link_available: true,
  });
  startLink.mockResolvedValue({ authorization_url: 'https://idp.example/auth' });
  startPasswordSetup.mockResolvedValue({ authorization_url: 'https://idp.example/reauth' });
  unlink.mockResolvedValue(undefined);
  Object.defineProperty(window, 'location', { configurable: true, value: { assign: vi.fn() } });
});
describe('AccountIdentitySection', () => {
  it('starts linking only when the provider is available', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Connect SSO' }));
    await waitFor(() => expect(startLink).toHaveBeenCalledWith('/settings?section=account'));
    expect(window.location.assign).toHaveBeenCalledWith('https://idp.example/auth');
  });
  it('requires a password before unlinking and submits it', async () => {
    const user = userEvent.setup();
    identities.mockResolvedValue({
      password_configured: true,
      oidc_linked: true,
      oidc_link_available: true,
    });
    renderSection();
    const input = await screen.findByLabelText(/current password/i);
    await user.type(input, 'current');
    await user.click(screen.getByRole('button', { name: 'Disconnect SSO' }));
    await waitFor(() => expect(unlink).toHaveBeenCalledWith('current'));
  });
  it('requires OIDC reauthentication to set an initial recovery password', async () => {
    const user = userEvent.setup();
    identities.mockResolvedValue({
      password_configured: false,
      oidc_linked: true,
      oidc_link_available: true,
    });
    renderSection();
    expect(await screen.findByText(/only sign-in method/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect SSO' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('New recovery password'), 'newrecoverypassword123');
    await user.type(screen.getByLabelText('Confirm recovery password'), 'newrecoverypassword123');
    await user.click(screen.getByRole('button', { name: 'Verify SSO and set password' }));
    await waitFor(() => expect(startPasswordSetup).toHaveBeenCalledWith('newrecoverypassword123'));
    expect(window.location.assign).toHaveBeenCalledWith('https://idp.example/reauth');
  });
});
