import React from 'react';
import { Icon, _api, addAPIProvider, type IconProps } from '@iconify/react';
import { api } from '@riviamigo/hooks';

// Every Iconify icon in the app loads through Riviamigo's authenticated
// same-origin proxy; the API owns the provider policy and strips browser
// identity. This runs when the module is first imported, before any icon can
// render, so pages that never load the dashboard editor still get icons.
addAPIProvider('', { resources: ['/v1/external/iconify'], path: '/' });
// Iconify's provider configuration cannot attach auth headers. Scope its
// fetch override to the first-party proxy so tokens can never reach Iconify.
if (typeof window !== 'undefined') {
  _api.setFetch((input: RequestInfo | URL, init?: RequestInit) => api.proxyFetch(input, init));
}

/**
 * The one way to render an Iconify icon (`lucide:bolt`, `mdi:…`) in the app.
 * Import it instead of `@iconify/react`'s `Icon` so the proxy above is always
 * configured first.
 */
export function AppIcon(props: IconProps) {
  return <Icon {...props} />;
}
