import type {
  ThemeCatalogResponse,
  ThemeMutationResponse,
  ThemePalette,
  ThemePreferencesResponse,
  ThemePreferencesV2,
  ThemeResource,
} from '@riviamigo/types';
import { transport } from './transport';

const etagHeaders = (etag?: string) => etag ? { 'If-Match': etag } : undefined;
const themeMutationHeaders = (themeEtag: string, preferenceEtag?: string) => ({
  'If-Match': themeEtag,
  ...(preferenceEtag ? { 'X-Theme-Preferences-If-Match': preferenceEtag } : {}),
});
const json = <T>(response: Response) => response.json() as Promise<T>;

export const themeClient = {
  async getPreferences(): Promise<ThemePreferencesResponse> {
    const response = await transport.requestResponse('GET', '/v2/auth/preferences/theme');
    return { preferences: await json(response), etag: response.headers.get('etag') ?? '' };
  },
  async updatePreferences(preferences: ThemePreferencesV2, etag: string): Promise<ThemePreferencesResponse> {
    const response = await transport.requestResponse('PUT', '/v2/auth/preferences/theme', preferences, undefined, true, true, etagHeaders(etag));
    return { preferences: await json(response), etag: response.headers.get('etag') ?? '' };
  },
  async getCatalog(): Promise<ThemeCatalogResponse> {
    return json(await transport.requestResponse('GET', '/v2/themes/catalog'));
  },
  async create(name: string, baseThemeId: ThemePalette): Promise<ThemeMutationResponse> {
    return json(await transport.requestResponse('POST', '/v2/themes', { name, baseThemeId }));
  },
  async get(themeId: string): Promise<ThemeResource> {
    return json(await transport.requestResponse('GET', `/v2/themes/${themeId}`));
  },
  async saveRevision(themeId: string, definition: unknown, etag: string): Promise<ThemeMutationResponse> {
    return json(await transport.requestResponse('POST', `/v2/themes/${themeId}/revisions`, { definition }, undefined, true, true, etagHeaders(etag)));
  },
  async publishRevision(themeId: string, revision: number, apply: boolean, etag: string, preferenceEtag?: string): Promise<ThemeMutationResponse> {
    return json(await transport.requestResponse('POST', `/v2/themes/${themeId}/revisions/${revision}/publish`, { apply }, undefined, true, true, themeMutationHeaders(etag, preferenceEtag)));
  },
  async rollback(themeId: string, revision: number, etag: string, preferenceEtag: string): Promise<ThemePreferencesResponse> {
    const response = await transport.requestResponse('POST', `/v2/themes/${themeId}/rollback`, { revision }, undefined, true, true, themeMutationHeaders(etag, preferenceEtag));
    return { preferences: await json(response), etag: response.headers.get('etag') ?? '' };
  },
  async retire(themeId: string, etag: string): Promise<ThemeMutationResponse> {
    return json(await transport.requestResponse('DELETE', `/v2/themes/${themeId}`, undefined, undefined, true, true, etagHeaders(etag)));
  },
};
