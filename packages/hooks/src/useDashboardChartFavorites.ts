import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './useAuth';
import { useAuthReady } from './useAuthState';

function queryKey(userId: string | null) {
  return ['auth', 'dashboard-chart-favorites', userId] as const;
}

export function useDashboardChartFavorites() {
  const authReady = useAuthReady();
  const userId = useAuth((state) => state.userId);
  return useQuery({
    queryKey: queryKey(userId),
    queryFn: () => api.getDashboardChartFavorites(),
    enabled: authReady && !!userId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useUpdateDashboardChartFavorite() {
  const queryClient = useQueryClient();
  const userId = useAuth((state) => state.userId);
  return useMutation({
    mutationFn: ({ key, chartId }: { key: string; chartId: string }) =>
      api.updateDashboardChartFavorite(key, chartId),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey(userId), data);
    },
  });
}
