import { createRoute, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { SettingsContent } from '../features/settings/SettingsPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';
import { rootRoute } from './__root';

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  validateSearch: z.object({
    section: z
      .enum([
        'vehicles',
        'dashboards',
        'charts',
        'units',
        'places',
        'charging',
        'external',
        'api',
        'jobs',
        'raw',
        'backup',
        'appearance',
        'account',
        'authentication',
      ])
      .optional(),
    oidc: z.enum(['linked']).optional(),
    password: z.enum(['set']).optional(),
    error: z.enum(['oidc_cancelled', 'oidc_failed', 'oidc_denied', 'oidc_expired']).optional(),
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const search = useSearch({ from: '/settings' });
  return (
    <ProtectedRoute>
      <SettingsContent
        {...(search.section ? { initialSection: search.section } : {})}
        {...(search.password
          ? {
              oidcFeedback: 'Recovery password set. Other refresh sessions were revoked.',
              oidcFeedbackKind: 'success' as const,
            }
          : search.oidc
            ? { oidcFeedback: 'SSO identity linked.', oidcFeedbackKind: 'success' as const }
            : search.error
              ? {
                  oidcFeedback: 'SSO connection was cancelled or could not be completed.',
                  oidcFeedbackKind: 'error' as const,
                }
              : {})}
      />
    </ProtectedRoute>
  );
}

export { SettingsContent } from '../features/settings/SettingsPage';
