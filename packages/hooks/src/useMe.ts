import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuthReady } from './useAuthState';

const ONE_HOUR_MS = 60 * 60 * 1000;

export function useMe() {
  const authReady = useAuthReady();

  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(),
    enabled: authReady,
    staleTime: ONE_HOUR_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });
}
