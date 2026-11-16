/**
 * Browser cache for protected vehicle artwork (`/v1/vehicle-image-cache/…`).
 *
 * The API names each mirrored image after a hash of its bytes, so a URL never
 * changes content: when Rivian's artwork changes, or a vehicle is reconnected
 * with new art, it gets a new URL. That makes the URL a safe cache key with no
 * expiry. Images are kept in memory for the visit and in IndexedDB across
 * page loads, so a refresh shows the real picture instead of downloading it
 * again. Entries no current vehicle refers to are pruned whenever the vehicle
 * list loads, and everything is cleared when the session ends.
 */

const DB_NAME = 'riviamigo-vehicle-artwork';
const DB_VERSION = 1;
const STORE = 'assets';

export const PROTECTED_ARTWORK_PREFIX = '/v1/vehicle-image-cache/';

export interface CachedVehicleArtwork {
  /** Object URL for the image, or null while the server is still restoring it. */
  objectUrl: string | null;
  restoring: boolean;
}

interface StoredAsset {
  url: string;
  blob: Blob;
  storedAt: number;
}

/** Minimal persistent store, swappable in tests. */
export interface ArtworkStore {
  get(url: string): Promise<Blob | null>;
  put(url: string, blob: Blob): Promise<void>;
  keys(): Promise<string[]>;
  delete(urls: string[]): Promise<void>;
  clear(): Promise<void>;
}

const memory = new Map<string, string>();
let store: ArtworkStore | null | undefined;

// Protected artwork belongs to the signed-in user's vehicles; forget it when
// the session ends so the next person on this browser starts clean.
if (typeof window !== 'undefined') {
  window.addEventListener('riviamigo:session-cleared', () => {
    void clearVehicleArtworkCache();
  });
}

export function isProtectedArtwork(source: string | null | undefined): source is string {
  return Boolean(source?.startsWith(PROTECTED_ARTWORK_PREFIX));
}

/** The object URL for an image already loaded this visit, without waiting. */
export function peekVehicleArtwork(url: string): CachedVehicleArtwork | undefined {
  const objectUrl = memory.get(url);
  return objectUrl ? { objectUrl, restoring: false } : undefined;
}

/**
 * Returns the image from memory, then IndexedDB, then the network. Only a
 * complete image (HTTP 200) is cached; the 202 placeholder the API returns
 * while it repairs its own cache is never stored.
 */
export async function loadVehicleArtwork(
  url: string,
  fetchAsset: (url: string) => Promise<Response>,
): Promise<CachedVehicleArtwork> {
  const remembered = peekVehicleArtwork(url);
  if (remembered) return remembered;

  const persistent = getStore();
  const stored = persistent ? await persistent.get(url).catch(() => null) : null;
  if (stored) return { objectUrl: remember(url, stored), restoring: false };

  const response = await fetchAsset(url);
  if (response.status === 202) return { objectUrl: null, restoring: true };
  const blob = await response.blob();
  if (persistent) await persistent.put(url, blob).catch(() => undefined);
  return { objectUrl: remember(url, blob), restoring: false };
}

/** Drops cached images that no vehicle refers to any more. */
export async function pruneVehicleArtworkCache(keep: Iterable<string>): Promise<void> {
  const keepSet = new Set(keep);
  for (const url of [...memory.keys()]) {
    // Leave the object URL alive: an image still on screen may use it until
    // the next render swaps in the new artwork.
    if (!keepSet.has(url)) memory.delete(url);
  }
  const persistent = getStore();
  if (!persistent) return;
  try {
    const stale = (await persistent.keys()).filter((url) => !keepSet.has(url));
    if (stale.length) await persistent.delete(stale);
  } catch {
    // Pruning is housekeeping; a failure only leaves unused images behind.
  }
}

/** Forgets every cached image, for sign-out and session changes. */
export async function clearVehicleArtworkCache(): Promise<void> {
  for (const objectUrl of memory.values()) URL.revokeObjectURL(objectUrl);
  memory.clear();
  const persistent = getStore();
  if (persistent) await persistent.clear().catch(() => undefined);
}

/** Every protected artwork URL mentioned anywhere in a vehicle list response. */
export function collectProtectedArtworkUrls(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (isProtectedArtwork(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectProtectedArtworkUrls(entry, into);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectProtectedArtworkUrls(entry, into);
  }
  return into;
}

/** Test seam: replace the persistent store (null disables persistence). */
export function setVehicleArtworkStoreForTests(next: ArtworkStore | null) {
  store = next;
  for (const objectUrl of memory.values()) URL.revokeObjectURL(objectUrl);
  memory.clear();
}

function remember(url: string, blob: Blob): string {
  const existing = memory.get(url);
  if (existing) return existing;
  const objectUrl = URL.createObjectURL(blob);
  memory.set(url, objectUrl);
  return objectUrl;
}

function getStore(): ArtworkStore | null {
  if (store === undefined) {
    store = typeof indexedDB === 'undefined' ? null : createIndexedDbStore();
  }
  return store;
}

function createIndexedDbStore(): ArtworkStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'url' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        opening = null;
        reject(request.error ?? new Error('vehicle artwork cache unavailable'));
      };
    });
    return opening;
  };
  const run = async <T>(mode: IDBTransactionMode, work: (objects: IDBObjectStore) => IDBRequest<T> | void) => {
    const db = await open();
    return new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error('vehicle artwork cache failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('vehicle artwork cache aborted'));
    });
  };
  return {
    async get(url) {
      const record = await run<StoredAsset | undefined>('readonly', (objects) => objects.get(url));
      return record?.blob ?? null;
    },
    async put(url, blob) {
      await run('readwrite', (objects) => {
        objects.put({ url, blob, storedAt: Date.now() } satisfies StoredAsset);
      });
    },
    async keys() {
      const keys = await run<IDBValidKey[]>('readonly', (objects) => objects.getAllKeys());
      return (keys ?? []).filter((key): key is string => typeof key === 'string');
    },
    async delete(urls) {
      await run('readwrite', (objects) => {
        for (const url of urls) objects.delete(url);
      });
    },
    async clear() {
      await run('readwrite', (objects) => {
        objects.clear();
      });
    },
  };
}
