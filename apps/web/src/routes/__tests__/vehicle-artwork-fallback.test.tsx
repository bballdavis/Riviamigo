import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AuthenticatedVehicleArtwork,
  getVehicleArtworkFallback,
  normalizeVehicleArtworkModel,
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
    expect(getVehicleArtworkFallback('R1S', 'overview')).toBe(
      '/vehicle-images/fallbacks/r1s/overview.webp',
    );
    expect(getVehicleArtworkFallback('R1T', 'charging')).toBe(
      '/vehicle-images/fallbacks/r1t/charging.webp',
    );
    expect(getVehicleArtworkFallback('R2', 'health')).toBeNull();
  });

  it('uses the local asset immediately when no API artwork exists', () => {
    renderArtwork(
      <AuthenticatedVehicleArtwork
        source={null}
        fallbackSource="/vehicle-images/fallbacks/r1s/health.webp"
        alt="Fallback Rivian"
      />,
    );

    const image = screen.getByRole('img', { name: 'Fallback Rivian' });
    expect(image.getAttribute('src')).toBe('/vehicle-images/fallbacks/r1s/health.webp');
    expect(image.getAttribute('data-artwork-fallback')).toBe('true');
  });

  it('switches presentation rules when an API image fails in the browser', () => {
    renderArtwork(
      <AuthenticatedVehicleArtwork
        source="/broken-api-artwork.webp"
        fallbackSource="/vehicle-images/fallbacks/r1t/charging.webp"
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
    expect(image.getAttribute('src')).toBe('/vehicle-images/fallbacks/r1t/charging.webp');
    expect(image.className).toBe('normalized-fallback');
    expect(image.style.transform).toBe('none');
    expect(image.getAttribute('data-artwork-fallback')).toBe('true');
  });
});
