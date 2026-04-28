import React, { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { api } from '@riviamigo/hooks';
import { PageLayout, Button, Input, Card } from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { Check, KeyRound, ShieldCheck, Zap } from 'lucide-react';

export const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connect',
  component: ConnectPage,
});

function ConnectPage() {
  return <AuthGuard><ConnectContent /></AuthGuard>;
}

export function ConnectContent() {
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const currentStep = loading ? 1 : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.connectRivian(email, password);
      if (result.requires_otp && result.challenge_id) {
        navigate({ to: '/connect/otp', search: { challenge_id: result.challenge_id, email } });
      } else {
        navigate({ to: '/' });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppLayout activeKey="settings">
      <PageLayout
        title="Add a Vehicle"
        subtitle="Connect your Rivian account so Riviamigo can securely prepare telemetry access."
        className="min-h-[calc(100vh-3rem)] justify-center [&>div:first-child]:justify-center [&>div:first-child>div]:text-center"
      >
        <div className="mx-auto w-full max-w-xl">
          <Card padding="lg" className="shadow-lg">
            <ConnectProgress currentStep={currentStep} />

            <div className="mt-8 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-muted">
                <Zap className="h-4 w-4 text-accent" />
              </div>
              <div>
                <p className="text-sm font-medium text-fg">Rivian Account</p>
                <p className="text-xs text-fg-tertiary">Most accounts continue through a one-time verification code.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
              <Input label="Rivian Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              <Input label="Rivian Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
              {error && <p className="text-xs text-[#F87171]">{error}</p>}
              <Button type="submit" loading={loading} iconLeft={<KeyRound className="h-4 w-4" />} className="mt-1">
                {loading ? 'Checking account' : 'Connect Account'}
              </Button>
            </form>
          </Card>
        </div>
      </PageLayout>
    </AppLayout>
  );
}

const steps = [
  {
    label: 'Credentials',
    description: 'Sign in with the Rivian account that has access to the vehicle.',
    icon: KeyRound,
  },
  {
    label: 'Verification',
    description: 'If Rivian requests MFA, enter the email or authenticator code next.',
    icon: ShieldCheck,
  },
];

function ConnectProgress({ currentStep }: { currentStep: number }) {
  return (
    <div aria-label="Add vehicle progress">
      <div className="h-2 overflow-hidden rounded-full bg-bg-elevated">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
        />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const active = index === currentStep;
          const complete = index < currentStep;
          return (
            <div
              key={step.label}
              className={`flex gap-3 rounded-lg border p-3 ${
                active || complete ? 'border-accent/50 bg-accent-muted/20' : 'border-border bg-bg-elevated/40'
              }`}
            >
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                complete ? 'bg-accent text-fg-on-accent' : 'bg-bg-surface text-accent'
              }`}>
                {complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div>
                <p className="text-sm font-medium text-fg">{step.label}</p>
                <p className="mt-1 text-xs leading-5 text-fg-tertiary">{step.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
