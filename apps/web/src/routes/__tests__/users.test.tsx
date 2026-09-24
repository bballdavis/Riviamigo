import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/layout/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../components/users/UserManagementPage', () => ({
  UserManagementPage: () => <div>Account management</div>,
}));

import { usersRoute } from '../users';

describe('users route', () => {
  it('composes the protected route with the user management page', () => {
    const UsersPage = usersRoute.options.component as React.ComponentType;

    render(<UsersPage />);

    expect(screen.getByText('Account management')).toBeInTheDocument();
  });
});
