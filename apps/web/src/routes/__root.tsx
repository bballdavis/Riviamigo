import React from 'react';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api, queryKeys, useAuth, useAuthReady } from '@riviamigo/hooks';
import { ThemeRuntimeProvider } from '@riviamigo/ui/lib/theme';
import { APP_TIMEZONE_CHANGE_EVENT, setAppTimezone } from '@riviamigo/ui/lib/dateTime';

interface RouterContext {
  queryClient: QueryClient;
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Root,
});

function Root() {
  const [, setTimezoneVersion] = React.useState(0);
  const authReady = useAuthReady();
  const accessToken = useAuth((state) => state.accessToken);
  const userId = useAuth((state) => state.userId);
  const queryClient = useQueryClient();
  const [themeIdentityEpoch, setThemeIdentityEpoch] = React.useState(() => Date.now());
  const previousUserId = React.useRef(userId);
  const themePreferences = useQuery({
    queryKey: queryKeys.unitPreferences.current,
    queryFn: () => api.getUnitPreferences(),
    enabled: authReady && !!accessToken && !!userId,
  });
  const appTimezone = useQuery({
    queryKey: queryKeys.appTimezone.current,
    queryFn: () => api.getAppTimezone(),
    enabled: authReady && !!accessToken,
  });

  React.useEffect(() => {
    const refresh = () => setTimezoneVersion((version) => version + 1);
    window.addEventListener(APP_TIMEZONE_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(APP_TIMEZONE_CHANGE_EVENT, refresh);
  }, []);

  React.useEffect(() => {
    if (appTimezone.data?.timezone) setAppTimezone(appTimezone.data.timezone);
  }, [appTimezone.data?.timezone]);

  React.useEffect(() => {
    if (previousUserId.current === userId) return;
    previousUserId.current = userId;
    setThemeIdentityEpoch(Date.now());
    queryClient.invalidateQueries({ queryKey: queryKeys.unitPreferences.current });
  }, [queryClient, userId]);

  const themeBelongsToCurrentAccount = Boolean(
    authReady && accessToken && userId && themePreferences.dataUpdatedAt >= themeIdentityEpoch,
  );

  return (
    <ThemeRuntimeProvider preferences={themeBelongsToCurrentAccount ? themePreferences.data?.theme ?? null : null}>
      <Outlet />
    </ThemeRuntimeProvider>
  );
}
