import React, { useState } from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root';
import { api } from '@riviamigo/hooks';
import { PageLayout, Button, Input, Card } from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { Check, KeyRound, ShieldCheck } from 'lucide-react';

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
  const [otp, setOtp]         = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.connectRivianOtp(challenge_id, otp);
      navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setLoading(false);
    }
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
            <ConnectOtpProgress loading={loading} />

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
          </Card>
        </div>
      </PageLayout>
    </AppLayout>
  );
}

function ConnectOtpProgress({ loading }: { loading: boolean }) {
  const items = [
    { label: 'Credentials accepted', icon: Check, complete: true },
    { label: loading ? 'Verifying code' : 'MFA required', icon: loading ? ShieldCheck : KeyRound, complete: false },
  ];

  return (
    <div aria-label="Add vehicle progress">
      <div className="h-2 overflow-hidden rounded-full bg-bg-elevated">
        <div className="h-full w-full rounded-full bg-accent transition-all duration-300" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
