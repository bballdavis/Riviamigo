import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, themeClient } from '@riviamigo/hooks';

describe('theme client', () => {
  beforeEach(() => {
    api.setToken('theme-token');
    vi.restoreAllMocks();
  });

  it('reads V2 preferences with their account-resource ETag', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: 2,
      mode: 'dark',
      selection: { kind: 'builtin', themeId: 'classic' },
    }), { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"theme-preferences-3"' } }));

    const result = await themeClient.getPreferences();

    expect(result.etag).toBe('"theme-preferences-3"');
    expect(result.preferences.selection).toEqual({ kind: 'builtin', themeId: 'classic' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/v2/auth/preferences/theme');
  });

  it('protects preference and revision writes with If-Match', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 2, mode: 'light', selection: { kind: 'builtin', themeId: 'rad' } }), { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"theme-preferences-4"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ themeId: 'custom-1', revision: 2, definitionHash: 'hash', etag: '"theme-custom-1-2"' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await themeClient.updatePreferences({ schemaVersion: 2, mode: 'light', selection: { kind: 'builtin', themeId: 'rad' } }, '"theme-preferences-3"');
    await themeClient.saveRevision('custom-1', { theme: 'classic' }, '"theme-custom-1-1"');

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT', headers: expect.objectContaining({ 'If-Match': '"theme-preferences-3"' }) });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', headers: expect.objectContaining({ 'If-Match': '"theme-custom-1-1"' }) });
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/v2/themes/custom-1/revisions');
  });

  it('returns the fully resolved account preference after applying a published revision', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: 2,
      mode: 'system',
      selection: {
        kind: 'custom',
        themeId: 'custom-1',
        revision: 2,
        baseThemeId: 'classic',
        definition: { theme: 'classic' },
        definitionHash: 'revision-2-hash',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"theme-preferences-5"' } }));

    const result = await themeClient.rollback('custom-1', 2, '"theme-custom-1-4"', '"theme-preferences-4"');

    expect(result.etag).toBe('"theme-preferences-5"');
    expect(result.preferences.selection).toMatchObject({ kind: 'custom', revision: 2 });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'If-Match': '"theme-custom-1-4"',
        'X-Theme-Preferences-If-Match': '"theme-preferences-4"',
      }),
    });
  });
});
