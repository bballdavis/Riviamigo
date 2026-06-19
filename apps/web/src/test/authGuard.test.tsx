/**
 * AuthGuard bootstrap, redirect, and per-user cache isolation tests.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

const mockHydrate = vi.fn();
const mockClearQueryCache = vi.fn();

vi.mock('../queryClient', () => ({
  hydrateQueryCacheForUser: (...args: unknown[]) => mockHydrate(...args),
  clearQueryCacheForUser: (...args: unknown[]) => mockClearQueryCache(...args),
  queryClient: {
    defaultOptions: {},
    getQueryCache: () => ({ subscribe: vi.fn() }),
    clear: vi.fn(),
    cancelQueries: vi.fn(),
  },
}));

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

import { AuthGuard, forceLoginRedirect } from '../components/layout/AuthGuard';

function makeToken(sub: string) {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub, iat: 0, exp: 9999999999 }));
  return `${header}.${payload}.sig`;
}

function setAuth(overrides: Partial<AuthState>) {
  authState = { ...authState, ...overrides };
}

describe('AuthGuard bootstrap', () => {
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
      <AuthGuard><span data-testid="protected">content</span></AuthGuard>,
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

  it('clears session after bootstrap refresh failure', async () => {
    const refresh = vi.fn().mockResolvedValue(false);
    const clearSession = vi.fn();
    setAuth({ isBootstrapping: true, isAuthenticated: false, refresh, clearSession });
    render(<AuthGuard><span>content</span></AuthGuard>);

    await act(async () => {
      await Promise.resolve();
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('does not call refresh() when already authenticated', () => {
    const refresh = vi.fn().mockResolvedValue(true);
    setAuth({ isBootstrapping: false, isAuthenticated: true, accessToken: makeToken('user-1'), refresh });
    render(<AuthGuard><span>content</span></AuthGuard>);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('AuthGuard cache hydration', () => {
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

describe('AuthGuard auth-expired handling', () => {
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

    await act(async () => {
      window.dispatchEvent(new CustomEvent('riviamigo:auth-expired'));
    });

    expect(mockClearQueryCache).toHaveBeenCalledWith('user-7');
    expect(clearSession).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
  });

  it('does not call clearQueryCacheForUser if the user was never hydrated', async () => {
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

    expect(mockClearQueryCache).not.toHaveBeenCalled();
  });
});

describe('forceLoginRedirect', () => {
  it('falls back to a hard redirect when router navigation leaves the user off /login', () => {
    const navigate = vi.fn();
    const replace = vi.fn();
    const locationLike = { pathname: '/', replace };
    const scheduleRedirect = (callback: () => void) => {
      callback();
      return 0;
    };

    forceLoginRedirect(navigate, locationLike, scheduleRedirect);

    expect(navigate).toHaveBeenCalledWith({ to: '/login' });
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('does not hard redirect when already on /login', () => {
    const navigate = vi.fn();
    const replace = vi.fn();
    const locationLike = { pathname: '/login', replace };
    const scheduleRedirect = (callback: () => void) => {
      callback();
      return 0;
    };

    forceLoginRedirect(navigate, locationLike, scheduleRedirect);

    expect(navigate).toHaveBeenCalledWith({ to: '/login' });
    expect(replace).not.toHaveBeenCalled();
  });
});
