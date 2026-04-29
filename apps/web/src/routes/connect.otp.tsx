import React, { useState } from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root';
import { api, useAuth } from '@riviamigo/hooks';
import type { ConnectedRivianVehicle, ConnectResult } from '@riviamigo/types';
import { PageLayout, Button, Input, Card } from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { ConnectedVehicleSuccess } from '../components/connect/ConnectedVehicleSuccess';
import { Car, Check, KeyRound, ShieldCheck } from 'lucide-react';

const searchSchema = z.object({
  challenge_id: z.string(),
  email: z.string().optional(),
});

export const connectOtpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connect/otp',
  validateSearch: searchSchema,
  component: ConnectOtpPage,
});

function ConnectOtpPage() {
  return <AuthGuard><ConnectOtpContent /></AuthGuard>;
}

export function ConnectOtpContent() {
  const navigate = useNavigate();
  const { challenge_id, email } = useSearch({ from: '/connect/otp' });
  const setDefaultVehicleId = useAuth((state) => state.setDefaultVehicleId);
  const [otp, setOtp]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [vehicles, setVehicles] = useState<ConnectedRivianVehicle[]>([]);
  const [successVehicleName, setSuccessVehicleName] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.connectRivianOtp(challenge_id, otp);
      await finishConnectedResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  }

  async function finishConnectedResult(result: ConnectResult) {
    if (!result.vehicles.length) {
      setError('Rivian verification succeeded, but no vehicles were returned for this account.');
      return;
    }
    if (result.vehicles.length > 1) {
      setVehicles(result.vehicles);
      return;
    }
    const vehicle = result.vehicles[0];
    if (!vehicle) return;
    await persistVehicle(vehicle);
  }

  async function persistVehicle(vehicle: ConnectedRivianVehicle) {
    setLoading(true);
    const added = await api.addVehicle({
      rivian_vehicle_id: vehicle.id,
      name: vehicle.name,
      model: vehicle.model,
      vin: vehicle.vin,
    });
    setDefaultVehicleId(added.vehicle_id);
    setSuccessVehicleName(formatVehicleName(vehicle));
    setVehicles([]);
  }

  return (
    <AppLayout activeKey="settings">
      <PageLayout
        title="Add a Vehicle"
        subtitle="Complete Rivian verification so encrypted vehicle access can be saved."
        className="min-h-[calc(100vh-3rem)] justify-center [&>div:first-child]:justify-center [&>div:first-child>div]:text-center"
      >
        <div className="mx-auto w-full max-w-xl">
          <Card padding="lg" className="shadow-lg">
            <ConnectOtpProgress loading={loading} success={Boolean(successVehicleName)} />

            {successVehicleName ? (
              <ConnectedVehicleSuccess
                vehicleName={successVehicleName}
                onOpenDashboard={() => navigate({ to: '/' })}
              />
            ) : vehicles.length > 1 ? (
              <VehiclePicker
                vehicles={vehicles}
                loading={loading}
                error={error}
                onSelect={(vehicle) => {
                  setError('');
                  persistVehicle(vehicle).catch((err) => {
                    setError(err instanceof Error ? err.message : 'Vehicle add failed');
                    setLoading(false);
                  });
                }}
              />
            ) : (
              <>
                <div className="mt-8">
                  <p className="text-sm font-medium text-fg">Verification code</p>
                  <p className="mt-1 text-sm text-fg-secondary">
                    {email ? (
                      <>
                        Enter the code Rivian sent for <span className="font-medium text-fg">{email}</span>.
                      </>
                    ) : (
                      'Enter the code from your Rivian email or authenticator app.'
                    )}
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
                  <Input
                    label="Verification Code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="123456"
                    required
                    autoFocus
                  />
                  {error && <p className="text-xs text-[#F87171]">{error}</p>}
                  <Button type="submit" loading={loading} iconLeft={<ShieldCheck className="h-4 w-4" />}>
                    {loading ? 'Verifying code' : 'Verify and Connect'}
                  </Button>
                </form>
              </>
            )}
          </Card>
        </div>
      </PageLayout>
    </AppLayout>
  );
}

function ConnectOtpProgress({ loading, success }: { loading: boolean; success: boolean }) {
  const items = [
    { label: 'Credentials accepted', icon: Check, complete: true },
    { label: loading ? 'Verifying code' : 'MFA required', icon: loading ? ShieldCheck : KeyRound, complete: false },
    { label: success ? 'Vehicle saved' : 'Save vehicle', icon: Car, complete: success },
  ];

  return (
    <div aria-label="Add vehicle progress">
      <div className="h-2 overflow-hidden rounded-full bg-bg-elevated">
        <div className="h-full w-full rounded-full bg-accent transition-all duration-300" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="flex gap-3 rounded-lg border border-accent/50 bg-accent-muted/20 p-3"
            >
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                item.complete ? 'bg-accent text-fg-on-accent' : 'bg-bg-surface text-accent'
              }`}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-fg">{item.label}</p>
                <p className="mt-1 text-xs leading-5 text-fg-tertiary">
                  {item.complete
                    ? 'Rivian accepted the account credentials.'
                    : 'This protects accounts that use email codes or authenticator apps.'}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VehiclePicker({
  vehicles,
  loading,
  error,
  onSelect,
}: {
  vehicles: ConnectedRivianVehicle[];
  loading: boolean;
  error: string;
  onSelect: (vehicle: ConnectedRivianVehicle) => void;
}) {
  return (
    <div className="mt-8">
      <p className="text-sm font-medium text-fg">Choose a vehicle</p>
      <p className="mt-1 text-xs leading-5 text-fg-tertiary">
        Rivian returned multiple vehicles for this account. Pick the one to add first.
      </p>
      <div className="mt-4 grid gap-3">
        {vehicles.map((vehicle) => (
          <button
            key={vehicle.id}
            type="button"
            disabled={loading}
            onClick={() => onSelect(vehicle)}
            className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated/40 p-4 text-left transition hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span>
              <span className="block text-sm font-medium text-fg">{formatVehicleName(vehicle)}</span>
              <span className="mt-1 block text-xs text-fg-tertiary">{vehicle.vin ?? vehicle.id}</span>
            </span>
            <Car className="h-5 w-5 text-accent" />
          </button>
        ))}
      </div>
      {error && <p className="mt-4 text-xs text-[#F87171]">{error}</p>}
    </div>
  );
}

function formatVehicleName(vehicle: ConnectedRivianVehicle) {
  return vehicle.name || [vehicle.model_year, vehicle.model].filter(Boolean).join(' ') || 'Rivian vehicle';
}
