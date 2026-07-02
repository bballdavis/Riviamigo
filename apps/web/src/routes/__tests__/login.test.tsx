import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

const mockNavigate = vi.fn();
let mockSearch = {} as { redirect?: string };
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearch: () => mockSearch,
  };
});

const mockLogin    = vi.fn();
const mockRegister = vi.fn();
vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ login: mockLogin, register: mockRegister }),
  useDocumentTheme: () => false,
}));

import { LoginPage } from '../login';

beforeEach(() => {
  mockNavigate.mockClear();
  mockLogin.mockClear();
  mockRegister.mockClear();
  mockSearch = {};
});

describe('LoginPage', () => {
  it('renders the Riviamigo wordmark image', () => {
    render(<LoginPage />);
    expect(screen.getByAltText('Riviamigo')).toBeInTheDocument();
  });

  it('renders the tagline', () => {
    render(<LoginPage />);
    expect(screen.getByText('Your Rivian\'s data companion.')).toBeInTheDocument();
  });

  it('renders the brand logo mark', () => {
    render(<LoginPage />);
    expect(screen.getByAltText('Riviamigo logo')).toBeInTheDocument();
  });

  it('renders email and password inputs', () => {
    render(<LoginPage />);
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
  });

  it('renders the Sign in submit button', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders the feature callout labels', () => {
    render(<LoginPage />);
    expect(screen.getByText('Trip analytics')).toBeInTheDocument();
    expect(screen.getByText('Charge history')).toBeInTheDocument();
    expect(screen.getByText('Battery health')).toBeInTheDocument();
  });

  it('shows "Don\'t have an account?" toggle in login mode', () => {
    render(<LoginPage />);
    expect(screen.getByText(/don't have an account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create one/i })).toBeInTheDocument();
  });

  it('switches to register mode when Create one is clicked', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /create one/i }));
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByText(/already have an account/i)).toBeInTheDocument();
  });

  it('calls login with email and password on submit', async () => {
    mockLogin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);

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
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'pw');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/' }));
  });

  it('navigates back to the requested protected route after successful login', async () => {
    mockLogin.mockResolvedValue(undefined);
    mockSearch = { redirect: '/charging?view=table' };
    const user = userEvent.setup();
    render(<LoginPage />);
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement | null;

    await user.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com');
    expect(passwordInput).not.toBeNull();
    await user.type(passwordInput!, 'pw');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/charging?view=table' }));
  });

  it('shows an error message when login fails', async () => {
    // 401 → mapped to "Incorrect email or password" by the login page
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    mockLogin.mockRejectedValue(err);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'bad@test.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Incorrect email or password. Please try again.')).toBeInTheDocument();
    });
  });

  it('calls register when in register mode', async () => {
    mockRegister.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LoginPage />);

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
