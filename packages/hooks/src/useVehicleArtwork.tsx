import React from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { isProtectedArtwork, loadVehicleArtwork, peekVehicleArtwork } from './vehicleArtworkCache';

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
  onFallbackChange?: (usingFallback: boolean) => void;
  /**
   * Shown while the real artwork is still loading. Packaged fallback art is
   * reserved for vehicles that have no usable artwork, so it never flashes
   * in before the real picture.
   */
  loadingIndicator?: React.ReactNode;
};

export function useVehicleArtwork(source: string | null | undefined) {
  const protectedArtwork = isProtectedArtwork(source);
  const query = useQuery({
    queryKey: ['vehicle-artwork-asset', source],
    enabled: protectedArtwork,
    staleTime: Infinity,
    gcTime: Infinity,
    // An image already loaded this visit renders on the first pass.
    initialData: () => (protectedArtwork ? peekVehicleArtwork(source) : undefined),
    // A failed protected image should yield to packaged artwork immediately;
    // retrying here only delays a usable fallback and the cache repair path
    // already refreshes explicit 202 restoring responses.
    retry: false,
    refetchInterval: (query) => (query.state.data?.restoring ? 3_000 : false),
    queryFn: () => loadVehicleArtwork(source!, (url) => api.authenticatedAsset(url)),
  });

  return {
    // A restoring cache endpoint deliberately returns a placeholder response.
    // Do not treat that SVG as usable vehicle art: consumers with packaged
    // artwork should show it while the protected cache repairs in the background.
    src: protectedArtwork ? (query.data?.restoring ? null : query.data?.objectUrl ?? null) : source ?? null,
    restoring: query.data?.restoring ?? false,
    /** True only until the first answer for protected artwork arrives. */
    isLoading: protectedArtwork && query.data === undefined && !query.isError,
    isError: protectedArtwork && query.isError,
  };
}

export function AuthenticatedVehicleArtwork({
  source,
  fallbackSource,
  fallbackProps,
  onFallbackChange,
  loadingIndicator = null,
  alt,
  className,
  style,
  onError,
  ...props
}: AuthenticatedVehicleArtworkProps) {
  const primaryArtwork = useVehicleArtwork(source);
  const fallbackArtwork = useVehicleArtwork(fallbackSource);
  const [primaryFailed, setPrimaryFailed] = React.useState(false);

  // A load failure applies to one concrete primary URL. Clear it whenever that
  // URL changes (new source, refetched blob, or repaired cache) so a transient
  // failure never pins the packaged fallback for the rest of the session.
  React.useEffect(() => {
    setPrimaryFailed(false);
  }, [source, primaryArtwork.src]);

  const primaryLoading = primaryArtwork.isLoading && !primaryFailed;
  const primaryUnavailable =
    primaryArtwork.isError || !primaryArtwork.src;
  const usingFallback =
    !primaryLoading &&
    Boolean(fallbackArtwork.src) &&
    (primaryFailed || primaryArtwork.restoring || primaryUnavailable);
  const artwork = usingFallback ? fallbackArtwork : primaryArtwork;

  React.useEffect(() => {
    onFallbackChange?.(usingFallback);
  }, [onFallbackChange, usingFallback]);

  if (primaryLoading) return <>{loadingIndicator}</>;
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
      onError?.(event);
      return;
    }
    onError?.(event);
    if (usingFallback) fallbackOnError?.(event);
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
