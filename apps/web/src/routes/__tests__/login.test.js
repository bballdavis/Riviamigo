import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { LoginPage } from '../login';
const queryClient = new QueryClient();
function renderLoginPage() {
    const rootRoute = createRootRoute({
        component: () => _jsx(_Fragment, { children: null }),
    });
    const loginRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/login',
        component: LoginPage,
    });
    const routeTree = rootRoute.addChildren([loginRoute]);
    const router = createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: ['/login'] }),
        context: { queryClient },
    });
    return render(_jsx(QueryClientProvider, { client: queryClient, children: _jsx(RouterProvider, { router: router, children: _jsx(LoginPage, {}) }) }));
}
describe('LoginPage', () => {
    it('renders the page title "Riviamigo"', () => {
        renderLoginPage();
        expect(screen.getByText('Riviamigo')).toBeInTheDocument();
    });
    it('renders the tagline "Your Rivian, deeply understood."', () => {
        renderLoginPage();
        expect(screen.getByText('Your Rivian, deeply understood.')).toBeInTheDocument();
    });
    it('renders the R monogram', () => {
        renderLoginPage();
        const monogram = screen.getByText('R');
        expect(monogram).toBeInTheDocument();
        expect(monogram.parentElement).toHaveClass('bg-accent/10');
    });
    it('renders email input', () => {
        renderLoginPage();
        const emailInput = screen.getByPlaceholderText('you@example.com');
        expect(emailInput).toBeInTheDocument();
    });
    it('renders password input', () => {
        renderLoginPage();
        const passwordInput = screen.getByPlaceholderText('••••••••');
        expect(passwordInput).toBeInTheDocument();
    });
    it('renders the sign in button', () => {
        renderLoginPage();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });
    it('renders the feature callouts', () => {
        renderLoginPage();
        expect(screen.getByText('Trip analytics')).toBeInTheDocument();
        expect(screen.getByText('Charge history')).toBeInTheDocument();
        expect(screen.getByText('Battery health')).toBeInTheDocument();
    });
    it('has glass card styling applied', () => {
        renderLoginPage();
        const card = screen.getByText('Sign in to your account').closest('div');
        const cardParent = card?.closest('.bg-bg-glass');
        expect(cardParent).toHaveClass('backdrop-blur-md');
    });
    it('renders toggle between login and register modes', () => {
        renderLoginPage();
        expect(screen.getByText(/don't have an account/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /create one/i })).toBeInTheDocument();
    });
});
