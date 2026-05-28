/**
 * AuthGuard — bootstrap, redirect, and per-user cache isolation tests.
 *
 * AuthGuard handles three important behaviours that have historically been
 * sources of bugs:
 *
 *  1. Bootstrap: on mount it attempts to rehydrate the session from the
 *     HttpOnly refresh cookie.  Content must not render until the attempt
 *     resolves; a failure must redirect to /login.
 *
 *  2. Logout / auth-expired: the query cache must be wiped and the user
 *     redirected to /login.  The cache wipe is per-user-id so User A's
 *     data is never visible to User B.
 *
 *  3. Hydration guard: `hydrateQueryCacheForUser` must be called at most
 *     once per user-id within a session, even if isAuthenticated toggling
 *     causes the effect to re-run.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Router mock ────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// ── queryClient mock ───────────────────────────────────────────────────────────

const mockHydrate = vi.fn();
const mockClearQueryCache = vi.fn();

vi.mock('../queryClient', () => ({
  hydrateQueryCacheForUser: (...args: unknown[]) => mockHydrate(...args),
  clearQueryCacheForUser:   (...args: unknown[]) => mockClearQueryCache(...args),
  queryClient: {
    defaultOptions: {},
    getQueryCache: () => ({ subscribe: vi.fn() }),
    clear: vi.fn(),
    cancelQueries: vi.fn(),
  },
}));

// ── @riviamigo/hooks mock ──────────────────────────────────────────────────────

type AuthState = {
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  accessToken: string | null;
  refresh: () => Promise<boolean>;
  clearSession: () => void;
};

let authState: AuthState = {
  isAuthenticated: false,
  isBootstrapping: true,
  accessToken: null,
  refresh: vi.fn().mockResolvedValue(true),
  clearSession: vi.fn(),
};

vi.mock('@riviamigo/hooks', () => ({
  useAuth: (selector?: (state: AuthState) => unknown) => {
    if (typeof selector === 'function') return selector(authState);
    return authState;
  },
}));

// Deferred import so mocks are registered first.
import { AuthGuard } from '../components/layout/AuthGuard';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Minimal JWT with the given sub claim (no signature — AuthGuard only decodes). */
function makeToken(sub: string) {
  const header  = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub, iat: 0, exp: 9999999999 }));
  return `${header}.${payload}.sig`;
}

function setAuth(overrides: Partial<AuthState>) {
  authState = { ...authState, ...overrides };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AuthGuard — bootstrap', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockHydrate.mockClear();
    mockClearQueryCache.mockClear();

    authState = {
      isAuthenticated: false,
      isBootstrapping: true,
      accessToken: null,
      refresh: vi.fn().mockResolvedValue(true),
      clearSession: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing while bootstrapping', () => {
    setAuth({ isBootstrapping: true, isAuthenticated: false });
    const { container } = render(
      <AuthGuard><span data-testid="protected">content</span></AuthGuard>
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('renders children once authenticated and no longer bootstrapping', () => {
    setAuth({ isBootstrapping: false, isAuthenticated: true, accessToken: makeToken('user-1') });
    render(<AuthGuard><span data-testid="protected">content</span></AuthGuard>);
    expect(screen.getByTestId('protected')).toBeInTheDocument();
  });

  it('navigates to /login when not authenticated and not bootstrapping', async () => {
    setAuth({ isBootstrapping: false, isAuthenticated: false });
    render(<AuthGuard><span>content</span></AuthGuard>);
    await act(async () => {});
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
  });

  it('calls refresh() on mount when not authenticated', async () => {
    const refresh = vi.fn().mockResolvedValue(false);
    setAuth({ isBootstrapping: true, isAuthenticated: false, refresh });
    render(<AuthGuard><span>content</span></AuthGuard>);
    await act(async () => {});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('navigates to /login after repeated bootstrap refresh failures', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(false);
    setAuth({ isBootstrapping: true, isAuthenticated: false, refresh });
    render(<AuthGuard><span>content</span></AuthGuard>);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
    expect(refresh).toHaveBeenCalledTimes(5);
    vi.useRealTimers();
  });

  it('does not call refresh() when already authenticated', () => {
    const refresh = vi.fn().mockResolvedValue(true);
    setAuth({ isBootstrapping: false, isAuthenticated: true, accessToken: makeToken('user-1'), refresh });
    render(<AuthGuard><span>content</span></AuthGuard>);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('AuthGuard — per-user cache hydration', () => {
  beforeEach(() => {
    mockHydrate.mockClear();
    mockClearQueryCache.mockClear();
    mockNavigate.mockClear();
  });

  it('calls hydrateQueryCacheForUser with the token sub on first auth', async () => {
    setAuth({ isBootstrapping: false, isAuthenticated: true, accessToken: makeToken('user-42') });
    render(<AuthGuard><span>content</span></AuthGuard>);
    await act(async () => {});
    expect(mockHydrate).toHaveBeenCalledOnce();
    expect(mockHydrate).toHaveBeenCalledWith('user-42');
  });

  it('does not call hydrateQueryCacheForUser a second time for the same user', async () => {
    const token = makeToken('user-42');
    setAuth({ isBootstrapping: false, isAuthenticated: true, accessToken: token });
    const { rerender } = render(<AuthGuard><span>content</span></AuthGuard>);
    await act(async () => {});

    rerender(<AuthGuard><span>content</span></AuthGuard>);
    await act(async () => {});

    expect(mockHydrate).toHaveBeenCalledOnce();
  });

  it('does not hydrate when the access token is null', async () => {
    setAuth({ isBootstrapping: false, isAuthenticated: true, accessToken: null });
    render(<AuthGuard><span>content</span></AuthGuard>);
    await act(async () => {});
    expect(mockHydrate).not.toHaveBeenCalled();
  });
});

describe('AuthGuard — logout / auth-expired cache wipe', () => {
  beforeEach(() => {
    mockHydrate.mockClear();
    mockClearQueryCache.mockClear();
    mockNavigate.mockClear();
  });

  it('clears the query cache for the user when riviamigo:auth-expired fires', async () => {
    const clearSession = vi.fn();
    setAuth({
      isBootstrapping: false,
      isAuthenticated: true,
      accessToken: makeToken('user-7'),
      clearSession,
    });
    render(<AuthGuard><span>content</span></AuthGuard>);
    await act(async () => {});

    // Simulate token expiry event (fired by the API client on 401 after failed refresh)
    await act(async () => {
      window.dispatchEvent(new CustomEvent('riviamigo:auth-expired'));
    });

    expect(mockClearQueryCache).toHaveBeenCalledWith('user-7');
    expect(clearSession).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
  });

  it('does not call clearQueryCacheForUser if the user was never hydrated', async () => {
    // Guard renders while still bootstrapping — no userId has been recorded yet.
    setAuth({ isBootstrapping: true, isAuthenticated: false });
    render(<AuthGuard><span>content</span></AuthGuard>);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('riviamigo:auth-expired'));
    });

    expect(mockClearQueryCache).not.toHaveBeenCalled();
  });

  it('removes the auth-expired listener on unmount', async () => {
    const clearSession = vi.fn();
    setAuth({
      isBootstrapping: false,
      isAuthenticated: true,
      accessToken: makeToken('user-3'),
      clearSession,
    });
    const { unmount } = render(<AuthGuard><span>content</span></AuthGuard>);
    await act(async () => {});

    unmount();
    mockClearQueryCache.mockClear();
    mockNavigate.mockClear();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('riviamigo:auth-expired'));
    });

    // After unmount the handler is gone — wipe must not be called again
    expect(mockClearQueryCache).not.toHaveBeenCalled();
  });
});
