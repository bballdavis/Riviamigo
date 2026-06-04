import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './useAuth';

const ONE_HOUR_MS = 60 * 60 * 1000;

export function useMe() {
  const accessToken = useAuth((state) => state.accessToken);
  const isAuthenticated = useAuth((state) => state.isAuthenticated);

  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(),
    enabled: isAuthenticated && !!accessToken,
    staleTime: ONE_HOUR_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });
}
