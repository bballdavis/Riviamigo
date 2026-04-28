import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@riviamigo/ui/primitives', async () => {
  const m = await import('../../test/mockPrimitives');
  return m;
});

vi.mock('../../components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('../../components/layout/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: { challenge_id: 'challenge-123', email: 'driver@example.com' },
}));
const apiMocks = vi.hoisted(() => ({
  connectRivian: vi.fn(),
  connectRivianOtp: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
    useSearch: () => routerMocks.search,
  };
});

vi.mock('@riviamigo/hooks', () => ({
  api: {
    connectRivian: apiMocks.connectRivian,
    connectRivianOtp: apiMocks.connectRivianOtp,
  },
}));

import { ConnectContent } from '../connect';
import { ConnectOtpContent } from '../connect.otp';

beforeEach(() => {
  routerMocks.navigate.mockClear();
  apiMocks.connectRivian.mockClear();
  apiMocks.connectRivianOtp.mockClear();
  routerMocks.search = { challenge_id: 'challenge-123', email: 'driver@example.com' };
});

describe('ConnectContent', () => {
  it('shows the add vehicle progress stages', () => {
    render(<ConnectContent />);

    expect(screen.getByText('Add a Vehicle')).toBeInTheDocument();
    expect(screen.getByLabelText('Add vehicle progress')).toBeInTheDocument();
    expect(screen.getByText('Credentials')).toBeInTheDocument();
    expect(screen.getByText('Verification')).toBeInTheDocument();
  });

  it('routes MFA accounts to the OTP step', async () => {
    apiMocks.connectRivian.mockResolvedValue({
      status: 'otp_required',
      requires_otp: true,
      challenge_id: 'challenge-456',
      vehicle_id: null,
    });

    const user = userEvent.setup();
    render(<ConnectContent />);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'driver@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /connect account/i }));

    await waitFor(() => {
      expect(routerMocks.navigate).toHaveBeenCalledWith({
        to: '/connect/otp',
        search: { challenge_id: 'challenge-456', email: 'driver@example.com' },
      });
    });
  });

  it('routes connected accounts home when MFA is not required', async () => {
    apiMocks.connectRivian.mockResolvedValue({
      status: 'connected',
      requires_otp: false,
      challenge_id: null,
      vehicle_id: null,
    });

    const user = userEvent.setup();
    render(<ConnectContent />);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'driver@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /connect account/i }));

    await waitFor(() => expect(routerMocks.navigate).toHaveBeenCalledWith({ to: '/' }));
  });
});

describe('ConnectOtpContent', () => {
  it('submits the OTP challenge and returns home', async () => {
    apiMocks.connectRivianOtp.mockResolvedValue({
      status: 'connected',
      requires_otp: false,
      challenge_id: null,
      vehicle_id: null,
    });

    const user = userEvent.setup();
    render(<ConnectOtpContent />);

    expect(screen.getByText('Credentials accepted')).toBeInTheDocument();
    expect(screen.getByText('MFA required')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('123456'), '654321');
    await user.click(screen.getByRole('button', { name: /verify and connect/i }));

    await waitFor(() => {
      expect(apiMocks.connectRivianOtp).toHaveBeenCalledWith('challenge-123', '654321');
      expect(routerMocks.navigate).toHaveBeenCalledWith({ to: '/' });
    });
  });
});
