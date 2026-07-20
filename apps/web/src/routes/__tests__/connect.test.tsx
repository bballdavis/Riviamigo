import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  addVehicle: vi.fn(),
  setDefaultVehicleId: vi.fn(),
}));

function apiError(code: string) {
  return Object.assign(new Error(code), { code });
}

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
    addVehicle: apiMocks.addVehicle,
  },
  useAuth: (selector: (state: { setDefaultVehicleId: (vehicleId: string) => void }) => unknown) =>
    selector({ setDefaultVehicleId: apiMocks.setDefaultVehicleId }),
  useVehicles: () => ({ data: [] }),
}));

import { ConnectContent } from '../connect';
import { ConnectOtpContent } from '../connect.otp';

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  routerMocks.navigate.mockClear();
  apiMocks.connectRivian.mockReset();
  apiMocks.connectRivianOtp.mockReset();
  apiMocks.addVehicle.mockReset();
  apiMocks.setDefaultVehicleId.mockClear();
  routerMocks.search = { challenge_id: 'challenge-123', email: 'driver@example.com' };
});

describe('ConnectContent', () => {
  it('shows the add vehicle progress stages', () => {
    renderWithQueryClient(<ConnectContent />);

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
      vehicles: [],
    });

    const user = userEvent.setup();
    renderWithQueryClient(<ConnectContent />);

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

  it('explains when Rivian rejects the entered credentials', async () => {
    apiMocks.connectRivian.mockRejectedValue(apiError('RIVIAN_CREDENTIALS_REJECTED'));

    const user = userEvent.setup();
    renderWithQueryClient(<ConnectContent />);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'driver@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /connect account/i }));

    expect(
      await screen.findByText(
        'Rivian did not accept that email or password. Check both and try again.'
      )
    ).toBeInTheDocument();
  });

  it('adds the returned vehicle and shows success when MFA is not required', async () => {
    apiMocks.connectRivian.mockResolvedValue({
      status: 'connected',
      requires_otp: false,
      challenge_id: null,
      vehicle_id: null,
      vehicles: [
        {
          id: 'rivian-vehicle-1',
          name: 'Launch Green',
          vin: '7FCTGAAL0NN000001',
          model: 'R1T',
          model_year: 2022,
        },
      ],
    });
    apiMocks.addVehicle.mockResolvedValue({ vehicle_id: 'local-vehicle-1' });

    const user = userEvent.setup();
    renderWithQueryClient(<ConnectContent />);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'driver@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /connect account/i }));

    await waitFor(() => {
      expect(apiMocks.addVehicle).toHaveBeenCalledWith({
        rivian_vehicle_id: 'rivian-vehicle-1',
        name: 'Launch Green',
        model: 'R1T',
        vin: '7FCTGAAL0NN000001',
      });
      expect(apiMocks.setDefaultVehicleId).toHaveBeenCalledWith('local-vehicle-1');
      expect(screen.getByText('Vehicle added')).toBeInTheDocument();
    });
  });

  it('shows an error when Rivian returns no vehicles', async () => {
    apiMocks.connectRivian.mockResolvedValue({
      status: 'connected',
      requires_otp: false,
      challenge_id: null,
      vehicle_id: null,
      vehicles: [],
    });

    const user = userEvent.setup();
    renderWithQueryClient(<ConnectContent />);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'driver@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /connect account/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Rivian sign-in succeeded, but no vehicles were returned for this account.'
        )
      ).toBeInTheDocument();
      expect(apiMocks.addVehicle).not.toHaveBeenCalled();
    });
  });

  it('explains a temporary secure-session failure while saving the vehicle', async () => {
    apiMocks.connectRivian.mockResolvedValue({
      status: 'connected',
      requires_otp: false,
      challenge_id: null,
      vehicle_id: null,
      vehicles: [
        {
          id: 'rivian-vehicle-1',
          name: 'Launch Green',
          vin: '7FCTGAAL0NN000001',
          model: 'R1T',
          model_year: 2022,
        },
      ],
    });
    apiMocks.addVehicle.mockRejectedValue(apiError('DEPENDENCY_UNAVAILABLE'));

    const user = userEvent.setup();
    renderWithQueryClient(<ConnectContent />);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'driver@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: /connect account/i }));

    expect(
      await screen.findByText('Temporary secure-session storage is unavailable. Please try again.')
    ).toBeInTheDocument();
  });

  it('shows the vehicle picker when multiple vehicles are returned', async () => {
    apiMocks.connectRivian.mockResolvedValue({
      status: 'connected',
      requires_otp: false,
      challenge_id: null,
      vehicle_id: null,
      vehicles: [
        {
          id: 'rivian-vehicle-1',
          name: 'Launch Green',
          vin: '7FCTGAAL0NN000001',
          model: 'R1T',
          model_year: 2022,
        },
        {
          id: 'rivian-vehicle-2',
          name: 'Forest R1S',
          vin: '7PDSGABL0PN000002',
          model: 'R1S',
          model_year: 2023,
        },
      ],
    });

    const user = userEvent.setup();
    renderWithQueryClient(<ConnectContent />);

    await user.type(screen.getByPlaceholderText('you@example.com'), 'driver@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: /connect account/i }));

    await waitFor(() => {
      expect(screen.getByText('Choose a vehicle')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /launch green/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /forest r1s/i })).toBeInTheDocument();
    });
  });
});

describe('ConnectOtpContent', () => {
  it('submits the OTP challenge, persists the vehicle, and shows success', async () => {
    apiMocks.connectRivianOtp.mockResolvedValue({
      status: 'connected',
      requires_otp: false,
      challenge_id: null,
      vehicle_id: null,
      vehicles: [
        {
          id: 'rivian-vehicle-2',
          name: 'Forest R1S',
          vin: '7PDSGABL0PN000002',
          model: 'R1S',
          model_year: 2023,
        },
      ],
    });
    apiMocks.addVehicle.mockResolvedValue({ vehicle_id: 'local-vehicle-2' });

    const user = userEvent.setup();
    renderWithQueryClient(<ConnectOtpContent />);

    expect(screen.getByText('Credentials accepted')).toBeInTheDocument();
    expect(screen.getByText('MFA required')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('123456'), '654321');
    await user.click(screen.getByRole('button', { name: /verify and connect/i }));

    await waitFor(() => {
      expect(apiMocks.connectRivianOtp).toHaveBeenCalledWith('challenge-123', '654321');
      expect(apiMocks.addVehicle).toHaveBeenCalledWith({
        rivian_vehicle_id: 'rivian-vehicle-2',
        name: 'Forest R1S',
        model: 'R1S',
        vin: '7PDSGABL0PN000002',
      });
      expect(apiMocks.setDefaultVehicleId).toHaveBeenCalledWith('local-vehicle-2');
      expect(screen.getByText('Vehicle added')).toBeInTheDocument();
    });
  });

  it('explains when Rivian rejects the verification code', async () => {
    apiMocks.connectRivianOtp.mockRejectedValue(apiError('RIVIAN_OTP_REJECTED'));

    const user = userEvent.setup();
    renderWithQueryClient(<ConnectOtpContent />);

    await user.type(screen.getByPlaceholderText('123456'), '654321');
    await user.click(screen.getByRole('button', { name: /verify and connect/i }));

    expect(
      await screen.findByText(
        'Rivian did not accept that verification code. Check it and try again.'
      )
    ).toBeInTheDocument();
  });

  it('shows an error when OTP succeeds without any vehicles', async () => {
    apiMocks.connectRivianOtp.mockResolvedValue({
      status: 'connected',
      requires_otp: false,
      challenge_id: null,
      vehicle_id: null,
      vehicles: [],
    });

    const user = userEvent.setup();
    renderWithQueryClient(<ConnectOtpContent />);

    await user.type(screen.getByPlaceholderText('123456'), '654321');
    await user.click(screen.getByRole('button', { name: /verify and connect/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Rivian verification succeeded, but no vehicles were returned for this account.'
        )
      ).toBeInTheDocument();
      expect(apiMocks.addVehicle).not.toHaveBeenCalled();
    });
  });

  it('shows the vehicle picker when OTP returns multiple vehicles', async () => {
    apiMocks.connectRivianOtp.mockResolvedValue({
      status: 'connected',
      requires_otp: false,
      challenge_id: null,
      vehicle_id: null,
      vehicles: [
        {
          id: 'rivian-vehicle-1',
          name: 'Launch Green',
          vin: '7FCTGAAL0NN000001',
          model: 'R1T',
          model_year: 2022,
        },
        {
          id: 'rivian-vehicle-2',
          name: 'Forest R1S',
          vin: '7PDSGABL0PN000002',
          model: 'R1S',
          model_year: 2023,
        },
      ],
    });

    const user = userEvent.setup();
    renderWithQueryClient(<ConnectOtpContent />);

    await user.type(screen.getByPlaceholderText('123456'), '654321');
    await user.click(screen.getByRole('button', { name: /verify and connect/i }));

    await waitFor(() => {
      expect(screen.getByText('Choose a vehicle')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /launch green/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /forest r1s/i })).toBeInTheDocument();
    });
  });
});
