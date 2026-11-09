/** Serialize rotating-cookie requests across tabs without persisting tokens. */
const LOCK_NAME = 'riviamigo-session-renewal';
const LEASE_MS = 120_000; // Longer than the bounded renewal request.
let localQueue: Promise<unknown> = Promise.resolve();

export async function withSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, operation);
  }
  if (typeof indexedDB !== 'undefined') return withLease(operation);
  // Server rendering and test environments have no tabs/cookie storage.
  if (typeof window !== 'undefined' && typeof window.document !== 'undefined'
      && !/jsdom/i.test(navigator.userAgent)) {
    throw Object.assign(new Error('Session coordination is unavailable. Please try again.'), { code: 'NETWORK_ERROR' });
  }
  const pending = localQueue.then(operation, operation);
  localQueue = pending.catch(() => undefined);
  return pending;
}

function openLeaseDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('riviamigo-session-coordination', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('leases');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Session coordination database is blocked'));
  });
}

function leaseTransaction(db: IDBDatabase, owner: string, release: boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('leases', 'readwrite');
    const store = tx.objectStore('leases');
    const request = store.get(LOCK_NAME);
    let acquired = false;
    request.onsuccess = () => {
      const lease = request.result as { owner: string; expires: number } | undefined;
      if (release) {
        if (lease?.owner === owner) store.delete(LOCK_NAME);
      } else if (!lease || lease.expires <= Date.now()) {
        store.put({ owner, expires: Date.now() + LEASE_MS }, LOCK_NAME);
        acquired = true;
      }
    };
    tx.oncomplete = () => resolve(acquired);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Session coordination transaction aborted'));
  });
}

async function withLease<T>(operation: () => Promise<T>): Promise<T> {
  let db: IDBDatabase | undefined;
  const owner = crypto.randomUUID();
  try {
    db = await openLeaseDatabase();
    const deadline = Date.now() + LEASE_MS;
    while (!(await leaseTransaction(db, owner, false))) {
      if (Date.now() >= deadline) throw new Error('Session renewal is busy. Please retry.');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    try { return await operation(); }
    finally { await leaseTransaction(db, owner, true); }
  } catch (cause) {
    if (cause instanceof Error && 'detail' in cause) throw cause;
    throw Object.assign(new Error('Unable to coordinate session renewal. Please try again.'), { code: 'NETWORK_ERROR', cause });
  } finally { db?.close(); }
}
