import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../packages/hooks/src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../packages/hooks/src/api')>();
  return {
    ...actual,
    api: new Proxy(actual.api, {
      get(target, property, receiver) {
        if (property === 'authenticatedAsset') {
          return () => Promise.reject(new Error('protected artwork unavailable'));
        }
        return Reflect.get(target, property, receiver);
      },
    }),
  };
});

import {
  AuthenticatedVehicleArtwork,
  getVehicleArtworkFallback,
  normalizeVehicleArtworkModel,
  resolveVehicleArtwork,
} from '@riviamigo/hooks';

afterEach(cleanup);

function renderArtwork(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

describe('vehicle artwork fallback contract', () => {
  it('resolves supported model variants to semantic fallback canvases', () => {
    expect(normalizeVehicleArtworkModel('Gen 2 R1T Adventure')).toBe('r1t');
    expect(normalizeVehicleArtworkModel('R2S Launch Edition')).toBe('r2s');
    expect(getVehicleArtworkFallback('R1S', 'overview')).toBe(
      '/vehicle-images/fallbacks/r1s/overview.webp',
    );
    expect(getVehicleArtworkFallback('R1T', 'charging')).toBe(
      '/vehicle-images/fallbacks/r1t/charging.webp',
    );
    expect(getVehicleArtworkFallback('Gen 1 R2-S', 'health')).toBe(
      '/vehicle-images/fallbacks/r2s/health.webp',
    );
    expect(getVehicleArtworkFallback('R1T', 'vehicle-card')).toBe(
      '/vehicle-images/fallbacks/r1t/side.webp',
    );
    expect(getVehicleArtworkFallback('R2', 'health')).toBeNull();
  });

  it('resolves API artwork by surface priority before model fallbacks', () => {
    const images = {
      all: [
        { placement: 'front', design: 'light', size: null, resolution: null, url: '/front.webp' },
        { placement: 'three-quarter', design: 'light', size: null, resolution: null, url: '/hero.webp' },
        { placement: 'side-charging', design: 'light', size: null, resolution: null, url: '/charging.webp' },
      ],
      side: { light: '/side.webp', dark: '/side-dark.webp' },
      overhead: { light: '/overhead.webp', dark: '/overhead-dark.webp' },
    };

    expect(resolveVehicleArtwork(images, 'R1S', 'overview')).toMatchObject({ light: '/overhead.webp' });
    expect(resolveVehicleArtwork(images, 'R1S', 'charging')).toMatchObject({ light: '/charging.webp' });
    expect(resolveVehicleArtwork(images, 'R1S', 'health')).toMatchObject({ light: '/hero.webp' });
    expect(resolveVehicleArtwork(images, 'R1S', 'vehicle-card')).toMatchObject({
      light: '/side.webp',
      fallback: '/vehicle-images/fallbacks/r1s/side.webp',
    });
  });

  it('uses the local asset immediately when no API artwork exists', () => {
    renderArtwork(
      <AuthenticatedVehicleArtwork
        source={null}
        fallbackSource="/vehicle-images/fallbacks/r2s/health.webp"
        alt="Fallback Rivian"
      />,
    );

    const image = screen.getByRole('img', { name: 'Fallback Rivian' });
    expect(image.getAttribute('src')).toBe('/vehicle-images/fallbacks/r2s/health.webp');
    expect(image.getAttribute('data-artwork-fallback')).toBe('true');
  });

  it('uses the local asset when protected artwork cannot be fetched', async () => {
    renderArtwork(
      <AuthenticatedVehicleArtwork
        source="/v1/vehicle-image-cache/00000000-0000-0000-0000-000000000000/health.webp"
        fallbackSource="/vehicle-images/fallbacks/r1s/health.webp"
        alt="Protected fallback Rivian"
      />,
    );

    await waitFor(() => {
      const image = screen.getByRole('img', { name: 'Protected fallback Rivian' });
      expect(image.getAttribute('src')).toBe('/vehicle-images/fallbacks/r1s/health.webp');
      expect(image.getAttribute('data-artwork-fallback')).toBe('true');
    });
  });

  it('switches presentation rules when an API image fails in the browser', () => {
    renderArtwork(
      <AuthenticatedVehicleArtwork
        source="/broken-api-artwork.webp"
        fallbackSource="/vehicle-images/fallbacks/r2s/charging.webp"
        fallbackProps={{
          className: 'normalized-fallback',
          style: { transform: 'none' },
        }}
        alt="Charging Rivian"
        className="api-crop"
        style={{ transform: 'scale(2)' }}
      />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'Charging Rivian' }));

    const image = screen.getByRole('img', { name: 'Charging Rivian' });
    expect(image.getAttribute('src')).toBe('/vehicle-images/fallbacks/r2s/charging.webp');
    expect(image.className).toBe('normalized-fallback');
    expect(image.style.transform).toBe('none');
    expect(image.getAttribute('data-artwork-fallback')).toBe('true');
  });

  it('keeps every manifest fallback in the web public directory', () => {
    const publicDirectory = resolve(process.cwd(), 'public');
    const manifest = JSON.parse(
      readFileSync(resolve(publicDirectory, 'vehicle-images/fallbacks/manifest.json'), 'utf8'),
    ) as {
      assets: Array<{
        model: string;
        usage: string;
        output: string;
        width: number;
        visible_bbox: [number, number, number, number] | null;
      }>;
    };

    for (const asset of manifest.assets) {
      expect(() =>
        readFileSync(resolve(publicDirectory, 'vehicle-images/fallbacks', asset.output)),
      ).not.toThrow();
    }

    for (const model of ['R1T', 'R2S']) {
      const chargingAsset = manifest.assets.find((asset) => asset.model === model && asset.usage === 'charging');
      expect(chargingAsset?.visible_bbox).not.toBeNull();
      expect(chargingAsset?.visible_bbox?.[0]).toBeLessThanOrEqual(chargingAsset!.width * 0.05);
      expect(chargingAsset?.visible_bbox?.[2]).toBeGreaterThanOrEqual(chargingAsset!.width * 0.98);
    }
  });

  it('shows packaged artwork on the first render while protected artwork is pending', () => {
    renderArtwork(
      <AuthenticatedVehicleArtwork
        source="/v1/vehicle-image-cache/00000000-0000-0000-0000-000000000000/overview.webp"
        fallbackSource="/vehicle-images/fallbacks/r1t/overview.webp"
        alt="Pending protected Rivian"
      />,
    );

    const image = screen.getByRole('img', { name: 'Pending protected Rivian' });
    expect(image.getAttribute('src')).toBe('/vehicle-images/fallbacks/r1t/overview.webp');
    expect(image.getAttribute('data-artwork-fallback')).toBe('true');
  });
});
