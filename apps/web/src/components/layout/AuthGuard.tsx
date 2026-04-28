import React, { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@riviamigo/hooks';

/**
 * Wraps a page component and redirects to /login when unauthenticated.
 * Avoids calling hooks inside conditionals in every route.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, clearSession } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate({ to: '/login' });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    function handleAuthExpired() {
      clearSession();
      navigate({ to: '/login' });
    }

    window.addEventListener('riviamigo:auth-expired', handleAuthExpired);
    return () => window.removeEventListener('riviamigo:auth-expired', handleAuthExpired);
  }, [clearSession, navigate]);

  if (!isAuthenticated) return null;
  return <>{children}</>;
}
