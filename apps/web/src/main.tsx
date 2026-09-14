import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { routeTree } from './routeTree';
import { ToastProvider } from './components/feedback/ToastProvider';
import { AppErrorBoundary } from './components/feedback/AppErrorBoundary';
import { queryClient } from './queryClient';
import { installGlobalClientErrorHandlers } from '@riviamigo/ui/lib/clientDiagnostics';
import './index.css';

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

installGlobalClientErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppErrorBoundary>
          <RouterProvider router={router} />
        </AppErrorBoundary>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
