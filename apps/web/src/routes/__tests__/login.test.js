import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
vi.mock('@riviamigo/ui/primitives', async () => {
    const m = await import('../../test/mockPrimitives');
    return m;
});
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, useNavigate: () => mockNavigate };
});
const mockLogin = vi.fn();
const mockRegister = vi.fn();
vi.mock('@riviamigo/hooks', () => ({
    useAuth: () => ({ login: mockLogin, register: mockRegister }),
}));
import { LoginPage } from '../login';
beforeEach(() => {
    mockNavigate.mockClear();
    mockLogin.mockClear();
    mockRegister.mockClear();
});
describe('LoginPage', () => {
    it('renders the Riviamigo brand name', () => {
        render(_jsx(LoginPage, {}));
        expect(screen.getByText('Riviamigo')).toBeInTheDocument();
    });
    it('renders the tagline', () => {
        render(_jsx(LoginPage, {}));
        expect(screen.getByText('Your Rivian, deeply understood.')).toBeInTheDocument();
    });
    it('renders the brand logo mark', () => {
        render(_jsx(LoginPage, {}));
        expect(screen.getByAltText('Riviamigo logo')).toBeInTheDocument();
    });
    it('renders email and password inputs', () => {
        render(_jsx(LoginPage, {}));
        expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
    });
    it('renders the Sign in submit button', () => {
        render(_jsx(LoginPage, {}));
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });
    it('renders the feature callout labels', () => {
        render(_jsx(LoginPage, {}));
        expect(screen.getByText('Trip analytics')).toBeInTheDocument();
        expect(screen.getByText('Charge history')).toBeInTheDocument();
        expect(screen.getByText('Battery health')).toBeInTheDocument();
    });
    it('shows "Don\'t have an account?" toggle in login mode', () => {
        render(_jsx(LoginPage, {}));
        expect(screen.getByText(/don't have an account/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /create one/i })).toBeInTheDocument();
    });
    it('switches to register mode when Create one is clicked', () => {
        render(_jsx(LoginPage, {}));
        fireEvent.click(screen.getByRole('button', { name: /create one/i }));
        expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
        expect(screen.getByText(/already have an account/i)).toBeInTheDocument();
    });
    it('calls login with email and password on submit', async () => {
        mockLogin.mockResolvedValue(undefined);
        const user = userEvent.setup();
        render(_jsx(LoginPage, {}));
        await user.type(screen.getByPlaceholderText('you@example.com'), 'test@example.com');
        await user.type(screen.getByPlaceholderText('••••••••'), 'secret123');
        await user.click(screen.getByRole('button', { name: /sign in/i }));
        await waitFor(() => {
            expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'secret123');
        });
    });
    it('navigates to / after successful login', async () => {
        mockLogin.mockResolvedValue(undefined);
        const user = userEvent.setup();
        render(_jsx(LoginPage, {}));
        await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
        await user.type(screen.getByPlaceholderText('••••••••'), 'pw');
        await user.click(screen.getByRole('button', { name: /sign in/i }));
        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/' }));
    });
    it('shows an error message when login fails', async () => {
        mockLogin.mockRejectedValue(new Error('Invalid credentials'));
        const user = userEvent.setup();
        render(_jsx(LoginPage, {}));
        await user.type(screen.getByPlaceholderText('you@example.com'), 'bad@test.com');
        await user.type(screen.getByPlaceholderText('••••••••'), 'wrong');
        await user.click(screen.getByRole('button', { name: /sign in/i }));
        await waitFor(() => {
            expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
        });
    });
    it('calls register when in register mode', async () => {
        mockRegister.mockResolvedValue(undefined);
        const user = userEvent.setup();
        render(_jsx(LoginPage, {}));
        // Switch to register mode
        fireEvent.click(screen.getByRole('button', { name: /create one/i }));
        await user.type(screen.getByPlaceholderText('you@example.com'), 'new@user.com');
        await user.type(screen.getByPlaceholderText('••••••••'), 'newpassword');
        await user.click(screen.getByRole('button', { name: /create account/i }));
        await waitFor(() => {
            expect(mockRegister).toHaveBeenCalledWith('new@user.com', 'newpassword');
        });
    });
});
