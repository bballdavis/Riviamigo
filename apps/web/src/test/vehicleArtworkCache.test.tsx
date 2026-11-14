import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const assetFetch = vi.hoisted(() => ({
  impl: (_url: string): Promise<Response> => Promise.reject(new Error('not configured')),
}));

vi.mock('../../../../packages/hooks/src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../packages/hooks/src/api')>();
  return {
    ...actual,
    api: new Proxy(actual.api, {
      get(target, property, receiver) {
        if (property === 'authenticatedAsset') return (url: string) => assetFetch.impl(url);
        return Reflect.get(target, property, receiver);
      },
    }),
  };
});

import { AuthenticatedVehicleArtwork } from '@riviamigo/hooks';
import {
  clearVehicleArtworkCache,
  collectProtectedArtworkUrls,
  loadVehicleArtwork,
  pruneVehicleArtworkCache,
  setVehicleArtworkStoreForTests,
  type ArtworkStore,
} from '../../../../packages/hooks/src/vehicleArtworkCache';

const OVERHEAD = '/v1/vehicle-image-cache/11111111-1111-1111-1111-111111111111/abc-0123456789abcdef.webp';
const SIDE = '/v1/vehicle-image-cache/11111111-1111-1111-1111-111111111111/def-fedcba9876543210.webp';

function memoryStore(): ArtworkStore & { entries: Map<string, Blob> } {
  const entries = new Map<string, Blob>();
  return {
    entries,
    get: async (url) => entries.get(url) ?? null,
    put: async (url, blob) => {
      entries.set(url, blob);
    },
    keys: async () => [...entries.keys()],
    delete: async (urls) => {
      for (const url of urls) entries.delete(url);
    },
    clear: async () => {
      entries.clear();
    },
  };
}

function imageResponse(status = 200) {
  return new Response(new Blob(['webp-bytes'], { type: 'image/webp' }), { status });
}

let objectUrlCount = 0;
let store: ReturnType<typeof memoryStore>;
const queryClients: QueryClient[] = [];

beforeEach(() => {
  objectUrlCount = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:artwork-${++objectUrlCount}`),
    revokeObjectURL: vi.fn(),
  }));
  store = memoryStore();
  setVehicleArtworkStoreForTests(store);
});

afterEach(async () => {
  cleanup();
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe('vehicle artwork cache', () => {
  it('downloads an image once, then serves it from memory for the rest of the visit', async () => {
    const fetchAsset = vi.fn(async () => imageResponse());

    const first = await loadVehicleArtwork(OVERHEAD, fetchAsset);
    const second = await loadVehicleArtwork(OVERHEAD, fetchAsset);

    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ objectUrl: 'blob:artwork-1', restoring: false });
    expect(second.objectUrl).toBe(first.objectUrl);
    expect(store.entries.has(OVERHEAD)).toBe(true);
  });

  it('serves a stored image after a page reload without downloading it again', async () => {
    await loadVehicleArtwork(OVERHEAD, async () => imageResponse());
    // A reload empties memory but keeps the browser's stored images.
    setVehicleArtworkStoreForTests(store);
    const fetchAsset = vi.fn(async () => imageResponse());

    const reloaded = await loadVehicleArtwork(OVERHEAD, fetchAsset);

    expect(fetchAsset).not.toHaveBeenCalled();
    expect(reloaded.objectUrl).not.toBeNull();
    expect(reloaded.restoring).toBe(false);
  });

  it('never stores the placeholder the API returns while it restores artwork', async () => {
    const restoring = await loadVehicleArtwork(OVERHEAD, async () => imageResponse(202));

    expect(restoring).toEqual({ objectUrl: null, restoring: true });
    expect(store.entries.size).toBe(0);
  });

  it('drops images no vehicle refers to, and clears everything at sign-out', async () => {
    await loadVehicleArtwork(OVERHEAD, async () => imageResponse());
    await loadVehicleArtwork(SIDE, async () => imageResponse());

    await pruneVehicleArtworkCache([SIDE]);
    expect([...store.entries.keys()]).toEqual([SIDE]);

    await clearVehicleArtworkCache();
    expect(store.entries.size).toBe(0);
  });

  it('finds every protected artwork URL in a vehicle list', () => {
    const vehicles = [
      {
        id: 'v1',
        images: {
          overhead: { light: OVERHEAD, dark: null },
          all: [{ url: SIDE }, { url: 'https://cdn.example/remote.webp' }],
        },
      },
    ];

    expect([...collectProtectedArtworkUrls(vehicles)].sort()).toEqual([OVERHEAD, SIDE].sort());
  });
});

describe('AuthenticatedVehicleArtwork while loading', () => {
  function renderArtwork() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClients.push(queryClient);
    return render(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedVehicleArtwork
          source={OVERHEAD}
          fallbackSource="/vehicle-images/fallbacks/r1s/overview.webp"
          alt="My R1S"
          loadingIndicator={<span>Loading picture</span>}
        />
      </QueryClientProvider>,
    );
  }

  it('shows the loading indicator, not the packaged fallback, until the real picture arrives', async () => {
    let finish: (response: Response) => void = () => {};
    const download = new Promise<Response>((resolve) => { finish = resolve; });
    const requested = vi.fn();
    assetFetch.impl = () => {
      requested();
      return download;
    };

    renderArtwork();

    expect(screen.getByText('Loading picture')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();

    await waitFor(() => expect(requested).toHaveBeenCalled());
    expect(screen.queryByRole('img')).toBeNull();
    finish(imageResponse());

    await waitFor(() => {
      const image = screen.getByRole('img', { name: 'My R1S' });
      expect(image.getAttribute('src')).toMatch(/^blob:artwork-/);
      expect(image.hasAttribute('data-artwork-fallback')).toBe(false);
    });
  });

  it('renders a picture already loaded this visit on the first pass', async () => {
    await loadVehicleArtwork(OVERHEAD, async () => imageResponse());
    assetFetch.impl = () => Promise.reject(new Error('should not download again'));

    renderArtwork();

    const image = screen.getByRole('img', { name: 'My R1S' });
    expect(image.getAttribute('src')).toBe('blob:artwork-1');
    expect(screen.queryByText('Loading picture')).toBeNull();
  });
});
