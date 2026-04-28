import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { LoginPage } from './login';
// Create a mock router for Storybook
const rootRoute = createRootRoute({
    component: () => _jsx(_Fragment, { children: null }),
});
const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: LoginPage,
});
const routeTree = rootRoute.addChildren([loginRoute]);
const queryClient = new QueryClient();
const meta = {
    title: 'Pages/Login',
    component: LoginPage,
    parameters: {
        layout: 'fullscreen',
    },
    decorators: [
        (Story) => {
            const router = createRouter({
                routeTree,
                history: createMemoryHistory({ initialEntries: ['/login'] }),
                context: { queryClient },
            });
            return (_jsx(QueryClientProvider, { client: queryClient, children: _jsx(RouterProvider, { router: router, children: _jsx(Story, {}) }) }));
        },
    ],
};
export default meta;
export const Default = {};
