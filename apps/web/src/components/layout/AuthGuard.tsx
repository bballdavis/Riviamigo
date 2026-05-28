import React, { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@riviamigo/hooks';
import { hydrateQueryCacheForUser, clearQueryCacheForUser } from '../../queryClient';

/** Decode the `sub` claim from a JWT without verifying the signature. */
function jwtUserId(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part)) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Wraps a page component. On first load, attempts to rehydrate the session
 * from the HttpOnly refresh cookie before deciding whether to redirect.
 * This replaces the old approach of persisting the access token in localStorage.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isBootstrapping, accessToken, refresh, clearSession } = useAuth();
  const navigate = useNavigate();
  const hydratedForRef = useRef<string | null>(null);

  // On mount, bootstrap the session from the HttpOnly cookie if not yet authenticated.
  useEffect(() => {
    if (isAuthenticated) return;
    let cancelled = false;
    const retryDelaysMs = [0, 250, 500, 1000, 2000];

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const bootstrap = async () => {
      for (const delayMs of retryDelaysMs) {
        if (cancelled) return;
        if (delayMs > 0) {
          await sleep(delayMs);
          if (cancelled) return;
        }

        const ok = await refresh();
        if (ok) return;
      }

      if (!cancelled) {
        navigate({ to: '/login' });
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  // Hydrate per-user query cache after auth is established.
  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;
    const userId = jwtUserId(accessToken);
    if (!userId || hydratedForRef.current === userId) return;
    hydratedForRef.current = userId;
    hydrateQueryCacheForUser(userId);
  }, [isAuthenticated, accessToken]);

  useEffect(() => {
    if (!isBootstrapping && !isAuthenticated) {
      // Clear stale cache when user is no longer authenticated.
      if (hydratedForRef.current) {
        clearQueryCacheForUser(hydratedForRef.current);
        hydratedForRef.current = null;
      }
      navigate({ to: '/login' });
    }
  }, [isAuthenticated, isBootstrapping, navigate]);

  useEffect(() => {
    function handleAuthExpired() {
      if (hydratedForRef.current) {
        clearQueryCacheForUser(hydratedForRef.current);
        hydratedForRef.current = null;
      }
      clearSession();
      navigate({ to: '/login' });
    }

    window.addEventListener('riviamigo:auth-expired', handleAuthExpired);
    return () => window.removeEventListener('riviamigo:auth-expired', handleAuthExpired);
  }, [clearSession, navigate]);

  if (isBootstrapping) return null;
  if (!isAuthenticated) return null;
  return <>{children}</>;
}
