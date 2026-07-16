import React from 'react';
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
