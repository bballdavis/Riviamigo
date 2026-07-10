import {
  QueryClient,
  dehydrate,
  hydrate,
  type DehydratedState,
  type Query,
  type QueryKey,
} from '@tanstack/react-query';

const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PERSISTED_CACHE_BYTES = 1_500_000;
const QUERY_CACHE_SAVE_DELAY_MS = 750;
const PERSISTED_QUERY_ROOTS = new Set([
  'vehicles',
  'stats',
  'battery',
  'charging',
  'efficiency',
  'trips',
  'dashboards',
]);

interface PersistedQueryCache {
  timestamp: number;
  userId: string;
  state: DehydratedState;
}

/** Returns a per-user localStorage key so User A's cache never loads for User B. */
function cacheKey(userId: string) {
  return `rm-query-cache-v2-${userId}`;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const e = error as { status?: unknown; code?: unknown } | null;
        if (!e) return failureCount < 2;
        const status = Number(e.status);
        // Never retry auth failures — the user is logged out.
        if (status === 401 || status === 403 || e.code === 'AUTH_EXPIRED') return false;
        // Retrying throttled requests causes request storms and more throttling.
        if (status === 429) return false;
        return failureCount < 2;
      },
      staleTime: 30 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
    },
  },
});

installQueryCachePersistence(queryClient);
installSessionClearedHandler(queryClient);

/** Call this after the user's identity is known (post-login or post-refresh). */
export function hydrateQueryCacheForUser(userId: string) {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(cacheKey(userId));
    if (!raw) return;
    const persisted = JSON.parse(raw) as PersistedQueryCache;
    if (
      !persisted?.timestamp ||
      persisted.userId !== userId ||
      Date.now() - persisted.timestamp > QUERY_CACHE_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(cacheKey(userId));
      return;
    }
    hydrate(queryClient, persisted.state);
  } catch {
    if (typeof window !== 'undefined') window.localStorage.removeItem(cacheKey(userId));
  }
}

/** Call this on logout to wipe the persisted cache. */
export function clearQueryCacheForUser(userId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(cacheKey(userId));
  queryClient.clear();
}

function installSessionClearedHandler(client: QueryClient) {
  if (typeof window === 'undefined') return;
  window.addEventListener('riviamigo:session-cleared', () => {
    client.cancelQueries();
  });
}

function installQueryCachePersistence(client: QueryClient) {
  if (typeof window === 'undefined') return;

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let idleHandle: number | undefined;

  const save = () => {
    saveTimer = undefined;
    idleHandle = undefined;
    // Determine the current user id from the auth store without creating a
    // circular dependency — read directly from localStorage.
    let userId: string | null = null;
    try {
      const authRaw = window.localStorage.getItem('rm-auth');
      if (authRaw) userId = (JSON.parse(authRaw) as { state?: { userId?: string } })?.state?.userId ?? null;
    } catch { /* ignore */ }
    if (!userId) return;

    try {
      const state = dehydrate(client, { shouldDehydrateQuery });
      const serialized = JSON.stringify({ timestamp: Date.now(), userId, state } satisfies PersistedQueryCache);
      if (new TextEncoder().encode(serialized).byteLength > MAX_PERSISTED_CACHE_BYTES) {
        window.localStorage.removeItem(cacheKey(userId));
        return;
      }
      window.localStorage.setItem(cacheKey(userId), serialized);
    } catch {
      // localStorage can be unavailable or full; in-memory cache is still useful.
    }
  };

  client.getQueryCache().subscribe(() => {
    if (saveTimer) clearTimeout(saveTimer);
    if (idleHandle !== undefined && 'cancelIdleCallback' in window) {
      (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(idleHandle);
      idleHandle = undefined;
    }
    saveTimer = setTimeout(() => {
      const requestIdleCallback = (window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      }).requestIdleCallback;
      if (requestIdleCallback) {
        idleHandle = requestIdleCallback(save, { timeout: 2_000 });
      } else {
        save();
      }
    }, QUERY_CACHE_SAVE_DELAY_MS);
  });

  window.addEventListener('beforeunload', save);
}

function shouldDehydrateQuery(query: Query) {
  return query.state.status === 'success'
    && isPersistedQueryKey(query.queryKey)
    && (query.meta as { persist?: unknown } | undefined)?.persist !== false;
}

function isPersistedQueryKey(queryKey: QueryKey) {
  const root = queryKey[0];
  return typeof root === 'string' && PERSISTED_QUERY_ROOTS.has(root);
}
