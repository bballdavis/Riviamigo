import React from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from './api';

type ArtworkAsset = {
  blob: Blob;
  restoring: boolean;
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
  };
}

export function AuthenticatedVehicleArtwork({
  source,
  alt,
  ...props
}: Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { source: string | null | undefined }) {
  const artwork = useVehicleArtwork(source);
  if (!artwork.src) return null;
  return <img {...props} src={artwork.src} alt={alt} data-artwork-restoring={artwork.restoring || undefined} />;
}
