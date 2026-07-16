#!/usr/bin/env python3
"""Apply the shared vehicle-artwork fallback integration.

This bootstrap script is intentionally deterministic: it creates the shared
resolver/tests and performs guarded, one-time replacements at the three current
vehicle artwork surfaces. It fails loudly when the expected source seam moves.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8-sig")


def write(path: str, content: str) -> None:
    destination = ROOT / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


def main() -> int:
    write_shared_resolver()
    write_authenticated_artwork_component()
    export_shared_resolver()
    patch_overview_widget()
    patch_charging_widget()
    patch_health_route()
    write_tests()
    document_contract()
    print("Applied shared vehicle fallback artwork integration.")
    return 0


def write_shared_resolver() -> None:
    write(
        "packages/hooks/src/vehicleArtworkFallback.ts",
        """export type VehicleArtworkUsage = 'overview' | 'charging' | 'health';
export type VehicleArtworkFallbackModel = 'r1s' | 'r1t';

const VEHICLE_ARTWORK_FALLBACKS: Record<
  VehicleArtworkFallbackModel,
  Record<VehicleArtworkUsage, string>
> = {
  r1s: {
    overview: '/vehicle-images/fallbacks/r1s/overview.webp',
    charging: '/vehicle-images/fallbacks/r1s/charging.webp',
    health: '/vehicle-images/fallbacks/r1s/health.webp',
  },
  r1t: {
    overview: '/vehicle-images/fallbacks/r1t/overview.webp',
    charging: '/vehicle-images/fallbacks/r1t/charging.webp',
    health: '/vehicle-images/fallbacks/r1t/health.webp',
  },
};

export function normalizeVehicleArtworkModel(
  model: string | null | undefined,
): VehicleArtworkFallbackModel | null {
  const normalized = (model ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.includes('r1t')) return 'r1t';
  if (normalized.includes('r1s')) return 'r1s';
  return null;
}

export function getVehicleArtworkFallback(
  model: string | null | undefined,
  usage: VehicleArtworkUsage,
): string | null {
  const normalizedModel = normalizeVehicleArtworkModel(model);
  return normalizedModel ? VEHICLE_ARTWORK_FALLBACKS[normalizedModel][usage] : null;
}
""",
    )


def write_authenticated_artwork_component() -> None:
    write(
        "packages/hooks/src/useVehicleArtwork.tsx",
        """import React from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from './api';

type ArtworkAsset = {
  blob: Blob;
  restoring: boolean;
};

type FallbackImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'alt'
>;

type AuthenticatedVehicleArtworkProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src'
> & {
  source: string | null | undefined;
  fallbackSource?: string | null | undefined;
  fallbackProps?: FallbackImageProps;
};

function isProtectedArtwork(source: string | null | undefined): source is string {
  return Boolean(source?.startsWith('/v1/vehicle-image-cache/'));
}

export function useVehicleArtwork(source: string | null | undefined) {
  const protectedArtwork = isProtectedArtwork(source);
  const query = useQuery({
    queryKey: ['vehicle-artwork-asset', source],
    enabled: protectedArtwork,
    staleTime: Infinity,
    retry: 1,
    refetchInterval: (query) => (query.state.data?.restoring ? 3_000 : false),
    queryFn: async (): Promise<ArtworkAsset> => {
      const response = await api.authenticatedAsset(source!);
      return {
        blob: await response.blob(),
        restoring: response.status === 202,
      };
    },
  });

  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!query.data?.blob) {
      setObjectUrl(null);
      return;
    }
    const next = URL.createObjectURL(query.data.blob);
    setObjectUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [query.data?.blob]);

  return {
    src: protectedArtwork ? objectUrl : source ?? null,
    restoring: query.data?.restoring ?? false,
    isLoading: protectedArtwork && query.isLoading,
    isError: protectedArtwork && query.isError,
  };
}

export function AuthenticatedVehicleArtwork({
  source,
  fallbackSource,
  fallbackProps,
  alt,
  className,
  style,
  onError,
  ...props
}: AuthenticatedVehicleArtworkProps) {
  const primaryArtwork = useVehicleArtwork(source);
  const fallbackArtwork = useVehicleArtwork(fallbackSource);
  const [primaryFailed, setPrimaryFailed] = React.useState(false);

  React.useEffect(() => {
    setPrimaryFailed(false);
  }, [source]);

  const primaryUnavailable =
    primaryArtwork.isError || (!primaryArtwork.src && !primaryArtwork.isLoading);
  const usingFallback =
    Boolean(fallbackArtwork.src) && (primaryFailed || primaryUnavailable);
  const artwork = usingFallback ? fallbackArtwork : primaryArtwork;

  if (!artwork.src) return null;

  const {
    className: fallbackClassName,
    style: fallbackStyle,
    onError: fallbackOnError,
    ...fallbackRest
  } = fallbackProps ?? {};
  const activeProps = usingFallback ? { ...props, ...fallbackRest } : props;

  const handleError: React.ReactEventHandler<HTMLImageElement> = (event) => {
    if (!usingFallback && fallbackArtwork.src) {
      setPrimaryFailed(true);
      return;
    }
    if (usingFallback) fallbackOnError?.(event);
    else onError?.(event);
  };

  return (
    <img
      {...activeProps}
      src={artwork.src}
      alt={alt}
      className={usingFallback ? fallbackClassName ?? className : className}
      style={usingFallback ? { ...style, ...fallbackStyle } : style}
      onError={handleError}
      data-artwork-fallback={usingFallback || undefined}
      data-artwork-restoring={artwork.restoring || undefined}
    />
  );
}
""",
    )


def export_shared_resolver() -> None:
    replace_once(
        "packages/hooks/src/index.ts",
        "export { AuthenticatedVehicleArtwork, useVehicleArtwork } from './useVehicleArtwork';\n",
        "export { AuthenticatedVehicleArtwork, useVehicleArtwork } from './useVehicleArtwork';\n"
        "export { getVehicleArtworkFallback, normalizeVehicleArtworkModel } from './vehicleArtworkFallback';\n"
        "export type { VehicleArtworkFallbackModel, VehicleArtworkUsage } from './vehicleArtworkFallback';\n",
    )


def patch_overview_widget() -> None:
    path = "packages/dashboards/src/widgets/custom/OverviewVehicleWidget.tsx"
    replace_once(
        path,
        "import { AuthenticatedVehicleArtwork, useAuth, useCurrentVehicleStatus, useVehicles, useVehicleArtwork } from '@riviamigo/hooks';",
        "import { AuthenticatedVehicleArtwork, getVehicleArtworkFallback, useAuth, useCurrentVehicleStatus, useVehicles, useVehicleArtwork } from '@riviamigo/hooks';",
    )
    replace_once(
        path,
        """  const baseOverheadLight = images?.overhead?.light ?? findFirstOverheadImage(images?.all, 'light');
  const baseOverheadDark = images?.overhead?.dark ?? findFirstOverheadImage(images?.all, 'dark');
  const baseOverheadFallback = baseOverheadLight ?? baseOverheadDark ?? findFirstOverheadImage(images?.all);
""",
        """  const baseOverheadLight = images?.overhead?.light ?? findFirstOverheadImage(images?.all, 'light');
  const baseOverheadDark = images?.overhead?.dark ?? findFirstOverheadImage(images?.all, 'dark');
  const apiOverheadFallback = baseOverheadLight ?? baseOverheadDark ?? findFirstOverheadImage(images?.all);
  const localOverheadFallback = getVehicleArtworkFallback(vehicleModel, 'overview');
  const baseOverheadFallback = apiOverheadFallback ?? localOverheadFallback;
""",
    )
    replace_once(
        path,
        """              <VehicleArtFrame source={baseOverheadFallback} heightPx={imageStageHeight} widthPx={imageStageWidth}>
                <VehicleOverheadLayers base={baseOverheadLight ?? baseOverheadFallback} overlays={overlaysLight} darkClassName="dark:hidden" vehicleName={vehicleName} />
                <VehicleOverheadLayers base={baseOverheadDark ?? baseOverheadFallback} overlays={overlaysDark} darkClassName="hidden dark:block" />
""",
        """              <VehicleArtFrame source={baseOverheadFallback} fallbackSource={localOverheadFallback} heightPx={imageStageHeight} widthPx={imageStageWidth}>
                <VehicleOverheadLayers base={baseOverheadLight ?? baseOverheadFallback} fallbackBase={localOverheadFallback} overlays={overlaysLight} darkClassName="dark:hidden" vehicleName={vehicleName} />
                <VehicleOverheadLayers base={baseOverheadDark ?? baseOverheadFallback} fallbackBase={localOverheadFallback} overlays={overlaysDark} darkClassName="hidden dark:block" />
""",
    )
    replace_once(
        path,
        """function VehicleArtFrame({
  source,
  heightPx,
  widthPx,
  children,
}: {
  source: string;
  heightPx: number;
  widthPx: number;
  children: React.ReactNode;
}) {
  const artwork = useVehicleArtwork(source);
  const [rotatedAspectRatio, setRotatedAspectRatio] = useState(2.25);
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setRotatedAspectRatio(image.naturalHeight / image.naturalWidth);
      }
    };
    if (artwork.src) image.src = artwork.src;
  }, [artwork.src]);
  const maxHeight = heightPx > 0 ? Math.max(120, (heightPx - 34) / 1.12) : 216;
  const maxWidth = widthPx > 0 ? Math.max(260, (widthPx - 34) / 1.04) : 520;
  const frameHeight = Math.round(Math.min(maxHeight, maxWidth / rotatedAspectRatio));
  const frameWidth = Math.round(frameHeight * rotatedAspectRatio);
  return (
    <div
      data-testid="overview-vehicle-art-frame"
      className="relative"
      style={{
        containerType: 'inline-size',
        height: frameHeight,
        width: frameWidth,
        transform: 'translateX(-5%)',
        '--vehicle-frame-height': `${frameHeight}px`,
        '--vehicle-frame-width': `${frameWidth}px`,
      } as React.CSSProperties}
    >
      {artwork.src ? children : null}
    </div>
  );
}

function VehicleOverheadLayers({ base, overlays, darkClassName, vehicleName }: { base: string; overlays: string[]; darkClassName: string; vehicleName?: string | undefined }) {
  const imageStyle = {
    height: 'var(--vehicle-frame-width)',
    width: 'var(--vehicle-frame-height)',
    transform: 'translate(-50%, -50%) rotate(90deg)',
  } as React.CSSProperties;
  return (
    <div className={`absolute inset-0 ${darkClassName}`}>
      <AuthenticatedVehicleArtwork source={base} alt={vehicleName ?? 'Rivian vehicle'} className="absolute left-1/2 top-1/2 max-w-none object-contain object-center" style={imageStyle} />
      {overlays.map((overlayUrl) => <AuthenticatedVehicleArtwork key={overlayUrl} source={overlayUrl} alt="" className="absolute left-1/2 top-1/2 max-w-none object-contain object-center" style={imageStyle} />)}
    </div>
  );
}
""",
        """function VehicleArtFrame({
  source,
  fallbackSource,
  heightPx,
  widthPx,
  children,
}: {
  source: string;
  fallbackSource?: string | null | undefined;
  heightPx: number;
  widthPx: number;
  children: React.ReactNode;
}) {
  const artwork = useVehicleArtwork(source);
  const fallbackArtwork = useVehicleArtwork(fallbackSource);
  const frameArtworkSrc = artwork.src ?? (!artwork.isLoading ? fallbackArtwork.src : null);
  const [rotatedAspectRatio, setRotatedAspectRatio] = useState(2.25);
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setRotatedAspectRatio(image.naturalHeight / image.naturalWidth);
      }
    };
    if (frameArtworkSrc) image.src = frameArtworkSrc;
  }, [frameArtworkSrc]);
  const maxHeight = heightPx > 0 ? Math.max(120, (heightPx - 34) / 1.12) : 216;
  const maxWidth = widthPx > 0 ? Math.max(260, (widthPx - 34) / 1.04) : 520;
  const frameHeight = Math.round(Math.min(maxHeight, maxWidth / rotatedAspectRatio));
  const frameWidth = Math.round(frameHeight * rotatedAspectRatio);
  return (
    <div
      data-testid="overview-vehicle-art-frame"
      className="relative"
      style={{
        containerType: 'inline-size',
        height: frameHeight,
        width: frameWidth,
        transform: 'translateX(-5%)',
        '--vehicle-frame-height': `${frameHeight}px`,
        '--vehicle-frame-width': `${frameWidth}px`,
      } as React.CSSProperties}
    >
      {frameArtworkSrc ? children : null}
    </div>
  );
}

function VehicleOverheadLayers({
  base,
  fallbackBase,
  overlays,
  darkClassName,
  vehicleName,
}: {
  base: string;
  fallbackBase?: string | null | undefined;
  overlays: string[];
  darkClassName: string;
  vehicleName?: string | undefined;
}) {
  const imageStyle = {
    height: 'var(--vehicle-frame-width)',
    width: 'var(--vehicle-frame-height)',
    transform: 'translate(-50%, -50%) rotate(90deg)',
  } as React.CSSProperties;
  return (
    <div className={`absolute inset-0 ${darkClassName}`}>
      <AuthenticatedVehicleArtwork
        source={base}
        fallbackSource={fallbackBase}
        alt={vehicleName ?? 'Rivian vehicle'}
        className="absolute left-1/2 top-1/2 max-w-none object-contain object-center"
        style={imageStyle}
      />
      {overlays.map((overlayUrl) => <AuthenticatedVehicleArtwork key={overlayUrl} source={overlayUrl} alt="" className="absolute left-1/2 top-1/2 max-w-none object-contain object-center" style={imageStyle} />)}
    </div>
  );
}
""",
    )


def patch_charging_widget() -> None:
    path = "packages/dashboards/src/widgets/custom/ChargingConnectionWidget.tsx"
    replace_once(
        path,
        "import { AuthenticatedVehicleArtwork, useAuth, useChargingSummary, useCurrentVehicleStatus, useVehicles } from '@riviamigo/hooks';",
        "import { AuthenticatedVehicleArtwork, getVehicleArtworkFallback, useAuth, useChargingSummary, useCurrentVehicleStatus, useVehicles } from '@riviamigo/hooks';",
    )
    replace_once(
        path,
        """  const cropFamily = chargingCropFamily(activeVehicle?.model);
  const imageMode = 'side-charging';
  const displaySideLight = chargingSideLight;
  const displaySideDark = chargingSideDark;
""",
        """  const cropFamily = chargingCropFamily(activeVehicle?.model);
  const fallbackChargingSource = getVehicleArtworkFallback(activeVehicle?.model, 'charging');
  const imageMode = 'side-charging';
  const displaySideLight = chargingSideLight ?? fallbackChargingSource;
  const displaySideDark = chargingSideDark ?? fallbackChargingSource;
""",
    )
    replace_once(
        path,
        """      data-image-light={displaySideLight}
      data-image-dark={displaySideDark}
""",
        """      data-image-light={displaySideLight}
      data-image-dark={displaySideDark}
      data-fallback-image={fallbackChargingSource ?? undefined}
""",
    )
    replace_once(
        path,
        """        {displaySideLight ? <VehicleSideImage source={displaySideLight} darkClassName="dark:hidden" cropConfig={CHARGING_CROP_CONFIG[cropFamily]} /> : null}
        {displaySideDark ? <VehicleSideImage source={displaySideDark} darkClassName="hidden dark:block" cropConfig={CHARGING_CROP_CONFIG[cropFamily]} /> : null}
""",
        """        {displaySideLight ? <VehicleSideImage source={chargingSideLight} fallbackSource={fallbackChargingSource} darkClassName="dark:hidden" cropConfig={CHARGING_CROP_CONFIG[cropFamily]} /> : null}
        {displaySideDark ? <VehicleSideImage source={chargingSideDark} fallbackSource={fallbackChargingSource} darkClassName="hidden dark:block" cropConfig={CHARGING_CROP_CONFIG[cropFamily]} /> : null}
""",
    )
    replace_once(
        path,
        """function VehicleSideImage({
  source,
  darkClassName,
  cropConfig,
}: {
  source: string;
  darkClassName: string;
  cropConfig: ChargingCropConfig;
}) {
  const translateY = cropConfig.translateY ?? 0;
  const transform =
    translateY === 0
      ? `translateX(${cropConfig.translateX}%) scale(${cropConfig.scale})`
      : `translate(${cropConfig.translateX}%, ${translateY}%) scale(${cropConfig.scale})`;
  return (
    <div className={`absolute inset-y-0 right-0 flex h-full w-full items-center justify-end ${darkClassName}`}>
      <AuthenticatedVehicleArtwork
        source={source}
        alt="Vehicle side view showing charging port location"
        data-testid="charging-side-image"
        data-image-mode="charging"
        className="h-full w-auto max-w-none object-contain"
        style={{
          objectPosition: cropConfig.objectPosition ?? 'left center',
          transform,
          transformOrigin: 'left top',
        }}
      />
    </div>
  );
}
""",
        """function VehicleSideImage({
  source,
  fallbackSource,
  darkClassName,
  cropConfig,
}: {
  source: string | null | undefined;
  fallbackSource?: string | null | undefined;
  darkClassName: string;
  cropConfig: ChargingCropConfig;
}) {
  const translateY = cropConfig.translateY ?? 0;
  const transform =
    translateY === 0
      ? `translateX(${cropConfig.translateX}%) scale(${cropConfig.scale})`
      : `translate(${cropConfig.translateX}%, ${translateY}%) scale(${cropConfig.scale})`;
  return (
    <div className={`absolute inset-y-0 right-0 flex h-full w-full items-center justify-end ${darkClassName}`}>
      <AuthenticatedVehicleArtwork
        source={source}
        fallbackSource={fallbackSource}
        fallbackProps={{
          className: 'h-full w-full max-w-none object-contain object-right',
          style: {
            objectPosition: 'right center',
            transform: 'none',
            transformOrigin: 'center',
          },
        }}
        alt="Vehicle side view showing charging port location"
        data-testid="charging-side-image"
        data-image-mode="charging"
        className="h-full w-auto max-w-none object-contain"
        style={{
          objectPosition: cropConfig.objectPosition ?? 'left center',
          transform,
          transformOrigin: 'left top',
        }}
      />
    </div>
  );
}
""",
    )


def patch_health_route() -> None:
    path = "apps/web/src/routes/health.tsx"
    replace_once(
        path,
        """  api,
  AuthenticatedVehicleArtwork,
  useAuth,
""",
        """  api,
  AuthenticatedVehicleArtwork,
  getVehicleArtworkFallback,
  useAuth,
""",
    )
    replace_once(
        path,
        """  const hasVehicleChoices = availableVehicles.length > 1;
  const { data, isLoading } = useVehicleHealth(effectiveVehicleId);
""",
        """  const hasVehicleChoices = availableVehicles.length > 1;
  const activeVehicle = availableVehicles.find((vehicle) => vehicle.id === effectiveVehicleId);
  const { data, isLoading } = useVehicleHealth(effectiveVehicleId);
""",
    )
    replace_once(
        path,
        """  const heroImageUrl = selectHealthHeroImage(images);
""",
        """  const heroImageUrl = selectHealthHeroImage(images);
  const fallbackHeroImageUrl = getVehicleArtworkFallback(
    data?.vehicle?.model ?? activeVehicle?.model,
    'health',
  );
""",
    )
    replace_once(
        path,
        """                    {heroImageUrl ? (
                      <div className="relative h-56 w-[24rem] shrink-0 overflow-hidden lg:h-64 lg:w-[30rem]">
                        <AuthenticatedVehicleArtwork
                          source={heroImageUrl}
                          alt="Vehicle three-quarter view"
                          className="absolute -right-2 -top-3 h-[110%] w-[110%] object-contain object-right-bottom lg:-right-3 lg:-top-4"
                        />
                      </div>
                    ) : null}
""",
        """                    {heroImageUrl || fallbackHeroImageUrl ? (
                      <div className="relative h-56 w-[24rem] shrink-0 overflow-hidden lg:h-64 lg:w-[30rem]">
                        <AuthenticatedVehicleArtwork
                          source={heroImageUrl}
                          fallbackSource={fallbackHeroImageUrl}
                          fallbackProps={{
                            className: 'absolute inset-0 h-full w-full object-contain object-right-bottom',
                          }}
                          alt="Vehicle three-quarter view"
                          className="absolute -right-2 -top-3 h-[110%] w-[110%] object-contain object-right-bottom lg:-right-3 lg:-top-4"
                        />
                      </div>
                    ) : null}
""",
    )


def write_tests() -> None:
    write(
        "apps/web/src/routes/__tests__/vehicle-artwork-fallback.test.tsx",
        """import React from 'react';
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
""",
    )


def document_contract() -> None:
    marker = "### Empty, loading, and error states\n"
    section = """### Vehicle artwork

- Rivian API artwork remains the primary source. Local model artwork is the final fallback for missing image metadata, protected-image fetch failures, browser image errors, and demo/test vehicles.
- Resolve local artwork through `getVehicleArtworkFallback(model, usage)` and render it through `AuthenticatedVehicleArtwork` using `fallbackSource`. Do not hard-code route-local asset paths.
- Source renders under `assets/vehicles_generated` are not presentation assets. Regenerate the transparent, normalized files under `apps/web/public/vehicle-images/fallbacks` with `scripts/build_vehicle_fallback_artwork.py`.
- The semantic canvases are stable contracts: `overview` is a 640×1440 portrait overhead image rotated by the shared overview frame; `charging` is a 1200×900 front/charge-port composition with no API crop transform; `health` is a 1600×900 three-quarter hero.
- API and local charging artwork intentionally use different presentation rules. Put fallback-only class and style changes in `fallbackProps` instead of adding model-specific CSS guesses to route code.
- Keep the transparent canvas and visible bounds consistent across models. Validate changes on both light and dark surfaces and run the artwork build in check mode before review.

"""
    replace_once("docs/branding.md", marker, section + marker)


if __name__ == "__main__":
    raise SystemExit(main())
