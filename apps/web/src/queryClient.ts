import {
  QueryClient,
  dehydrate,
  hydrate,
  type DehydratedState,
  type Query,
  type QueryKey,
} from '@tanstack/react-query';

const QUERY_CACHE_STORAGE_KEY = 'rm-query-cache-v1';
const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
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
  state: DehydratedState;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status?: unknown }).status)
          : null;
        if (status === 401 || status === 403) return false;
        return failureCount < 2;
      },
      staleTime: 30 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnReconnect: 'always',
      refetchOnWindowFocus: true,
      refetchOnMount: true,
    },
  },
});

hydrateQueryCache(queryClient);
installQueryCachePersistence(queryClient);

function hydrateQueryCache(client: QueryClient) {
  if (typeof window === 'undefined') return;

  try {
    const raw = window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY);
    if (!raw) return;

    const persisted = JSON.parse(raw) as PersistedQueryCache;
    if (!persisted?.timestamp || Date.now() - persisted.timestamp > QUERY_CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
      return;
    }

    hydrate(client, persisted.state);
  } catch {
    window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
  }
}

function installQueryCachePersistence(client: QueryClient) {
  if (typeof window === 'undefined') return;

  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const save = () => {
    saveTimer = undefined;
    try {
      const state = dehydrate(client, { shouldDehydrateQuery });
      window.localStorage.setItem(
        QUERY_CACHE_STORAGE_KEY,
        JSON.stringify({ timestamp: Date.now(), state } satisfies PersistedQueryCache),
      );
    } catch {
      // localStorage can be unavailable or full; keeping the in-memory cache is still useful.
    }
  };

  client.getQueryCache().subscribe(() => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, QUERY_CACHE_SAVE_DELAY_MS);
  });

  window.addEventListener('beforeunload', save);
}

function shouldDehydrateQuery(query: Query) {
  return query.state.status === 'success' && isPersistedQueryKey(query.queryKey);
}

function isPersistedQueryKey(queryKey: QueryKey) {
  const root = queryKey[0];
  return typeof root === 'string' && PERSISTED_QUERY_ROOTS.has(root);
}
