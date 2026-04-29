import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter, } from '@tanstack/react-router';
export function createTestQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
        },
    });
}
export function renderWithProviders(ui, options) {
    const queryClient = createTestQueryClient();
    const { initialPath = '/', ...rest } = options ?? {};
    const rootRoute = createRootRoute({ component: () => _jsx(_Fragment, { children: ui }) });
    const indexRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: initialPath,
        component: () => _jsx(_Fragment, { children: ui }),
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([indexRoute]),
        history: createMemoryHistory({ initialEntries: [initialPath] }),
    });
    return render(_jsx(QueryClientProvider, { client: queryClient, children: _jsx(RouterProvider, { router: router }) }), rest);
}
export * from '@testing-library/react';
