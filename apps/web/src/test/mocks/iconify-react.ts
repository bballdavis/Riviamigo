import React from 'react';

interface MockIconProps {
  icon?: unknown;
  'data-testid'?: string;
}

/** Renders a placeholder that records the requested icon id. */
export function Icon({ icon, 'data-testid': testId }: MockIconProps) {
  return React.createElement('span', {
    'data-iconify': typeof icon === 'string' ? icon : undefined,
    ...(testId ? { 'data-testid': testId } : {}),
  });
}

export function InlineIcon(props: MockIconProps) {
  return Icon(props);
}

/** Provider registrations made while the test module graph loaded. */
export const providerRegistrations: Array<{ prefix: string; resources: string[] }> = [];

export function addAPIProvider(prefix: string, config: { resources?: string[] }) {
  providerRegistrations.push({ prefix, resources: config.resources ?? [] });
  return true;
}

export const _api = {
  setFetch() {},
};
