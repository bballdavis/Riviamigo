import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@riviamigo/hooks';

describe('OIDC API transport', () => {
  beforeEach(() => { api.setToken('stale-token'); vi.restoreAllMocks(); });
  it('classifies public config and start requests without auth refresh', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ oidc_enabled: true, oidc_ready: true, password_login_enabled: true, button_label: 'SSO' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await api.getAuthConfig();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v1/auth/config');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).not.toHaveProperty('Authorization');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ authorization_url: 'https://idp.example' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await api.startOidc('/');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/v1/auth/oidc/start');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).not.toHaveProperty('Authorization');
  });
});
