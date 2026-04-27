import React, { useState } from 'react';
import { createRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './__root';
import { api } from '@riviamigo/hooks';
import { PageLayout, Button, Input, Card } from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';

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

function ConnectOtpContent() {
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
      <PageLayout title="Verify Your Identity" subtitle="Check your email or phone for a code">
        <div className="max-w-md">
          <Card>
            {email && (
              <p className="text-sm text-fg-secondary mb-4">
                A code was sent to <span className="text-fg font-medium">{email}</span>.
              </p>
            )}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              <Button type="submit" loading={loading}>Verify &amp; Connect</Button>
            </form>
          </Card>
        </div>
      </PageLayout>
    </AppLayout>
  );
}
