import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLeaseOwner, withSessionLock } from '../../../../packages/hooks/src/api/sessionLock';

/**
 * Minimal asynchronous IndexedDB stand-in covering exactly what the lease
 * fallback uses: open + upgrade, one readwrite store, get/put/delete, and
 * transaction completion. Plain-HTTP LAN origins keep IndexedDB but lose the
 * secure-context-only navigator.locks and crypto.randomUUID.
 */
function createFakeIndexedDb() {
  const data = new Map<string, unknown>();
  const schedule = (fn: () => void) => setTimeout(fn, 0);
  // Real IndexedDB runs overlapping readwrite transactions one at a time.
  let transactionChain: Promise<void> = Promise.resolve();

  const db = {
    createObjectStore: () => undefined,
    close: vi.fn(),
    transaction: () => {
      const tx: Record<string, unknown> = {};
      let pending = 0;
      let finish!: () => void;
      const done = new Promise<void>((resolve) => { finish = resolve; });
      const ready = transactionChain;
      transactionChain = ready.then(() => done);
      const settle = () => {
        if (--pending === 0) {
          schedule(() => {
            (tx.oncomplete as (() => void) | undefined)?.();
            finish();
          });
        }
      };
      const request = (run: () => unknown) => {
        const req: Record<string, unknown> = {};
        pending += 1;
        void ready.then(() => schedule(() => {
          req.result = run();
          (req.onsuccess as (() => void) | undefined)?.();
          settle();
        }));
        return req;
      };
      tx.objectStore = () => ({
        get: (key: string) => request(() => data.get(key)),
        put: (value: unknown, key: string) => request(() => data.set(key, value)),
        delete: (key: string) => request(() => data.delete(key)),
      });
      return tx;
    },
  };

  return {
    data,
    factory: {
      open: () => {
        const req: Record<string, unknown> = { result: db };
        schedule(() => {
          (req.onupgradeneeded as (() => void) | undefined)?.();
          (req.onsuccess as (() => void) | undefined)?.();
        });
        return req;
      },
    },
  };
}

function simulatePlainHttpBrowser() {
  const fakeDb = createFakeIndexedDb();
  vi.stubGlobal('indexedDB', fakeDb.factory);
  vi.stubGlobal('crypto', {
    // Only getRandomValues survives in an insecure context.
    getRandomValues: <T extends ArrayBufferView>(array: T) => {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
      return array;
    },
  });
  // jsdom exposes no navigator.locks; assert that rather than assume it.
  expect((navigator as Navigator & { locks?: unknown }).locks).toBeUndefined();
  return fakeDb;
}

describe('session renewal lock on plain-HTTP (insecure context) origins', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a unique lease owner without crypto.randomUUID', () => {
    simulatePlainHttpBrowser();
    expect(typeof (globalThis.crypto as Crypto & { randomUUID?: unknown }).randomUUID).toBe('undefined');

    const owners = new Set(Array.from({ length: 50 }, () => createLeaseOwner()));
    expect(owners.size).toBe(50);
    for (const owner of owners) expect(owner).toMatch(/^[0-9a-f]{32}$/);
  });

  it('still falls back to a unique owner when no crypto API is present', () => {
    vi.stubGlobal('crypto', undefined);
    const owners = new Set(Array.from({ length: 20 }, () => createLeaseOwner()));
    expect(owners.size).toBe(20);
  });

  it('runs and serializes renewals through the IndexedDB lease', async () => {
    const fakeDb = simulatePlainHttpBrowser();
    const order: string[] = [];

    const first = withSessionLock(async () => {
      order.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('first:end');
      return 'first';
    });
    const second = withSessionLock(async () => {
      order.push('second:start');
      return 'second';
    });

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    // Each renewal releases its lease so the next tab or request can proceed.
    expect(fakeDb.data.size).toBe(0);
  });
});
