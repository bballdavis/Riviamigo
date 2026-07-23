import React from 'react';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api, useAuth, useAuthReady } from '@riviamigo/hooks';
import { ThemeModeSync } from '@riviamigo/ui/lib/theme';
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
  const appTimezone = useQuery({
    queryKey: ['app-timezone'],
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

  return (
    <>
      <ThemeModeSync />
      <Outlet />
    </>
  );
}
