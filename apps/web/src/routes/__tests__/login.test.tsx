import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => import('../../test/mockPrimitives'));

const mockNavigate = vi.fn();
let mockSearch = {} as { redirect?: string };
let setupRequired = false;
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ data: { setup_required: setupRequired } }),
}));

const mockLogin = vi.fn();
const mockRegister = vi.fn();
vi.mock('@riviamigo/hooks', () => ({
  useAuth: () => ({ login: mockLogin, register: mockRegister }),
  useDocumentTheme: () => false,
  api: { setup: vi.fn() },
}));

import { LoginPage } from '../login';

beforeEach(() => {
  mockNavigate.mockClear(); mockLogin.mockClear(); mockRegister.mockClear();
  mockSearch = {}; setupRequired = false;
});

describe('LoginPage', () => {
  it('renders the normal sign-in state after initial setup', () => {
    render(<LoginPage />);
    expect(screen.getByAltText('Riviamigo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/ask an administrator for an activation link/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create one/i })).not.toBeInTheDocument();
  });

  it('renders first-owner setup for an empty installation', () => {
    setupRequired = true;
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /create owner account/i })).toBeInTheDocument();
    expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0/12');
    expect(document.querySelector('input[type="password"]')).toHaveAttribute('minlength', '12');
  });

  it('logs in and preserves the requested redirect', async () => {
    mockLogin.mockResolvedValue(undefined); mockSearch = { redirect: '/charging?view=table' };
    const user = userEvent.setup(); render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'owner@example.com');
    await user.type(document.querySelector('input[type="password"]')!, 'password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/charging?view=table' }));
  });

  it('registers the owner and opens Rivian connection only during setup', async () => {
    setupRequired = true; mockRegister.mockResolvedValue(undefined);
    const user = userEvent.setup(); render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('you@example.com'), 'owner@example.com');
    await user.type(document.querySelector('input[type="password"]')!, 'fresh-install-password');
    await user.click(screen.getByRole('button', { name: /create owner account/i }));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith('owner@example.com', 'fresh-install-password'));
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/connect' });
  });
});
