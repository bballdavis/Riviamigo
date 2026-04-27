import React, { useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { api } from '@riviamigo/hooks';
import { PageLayout, Button, Input, Card } from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { Zap } from 'lucide-react';

export const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connect',
  component: ConnectPage,
});

function ConnectPage() {
  return <AuthGuard><ConnectContent /></AuthGuard>;
}

function ConnectContent() {
  const navigate = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

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
      <PageLayout title="Connect Rivian" subtitle="Link your Rivian account to start tracking">
        <div className="max-w-md">
          <Card>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-lg bg-accent-muted flex items-center justify-center">
                <Zap className="h-4 w-4 text-accent" />
              </div>
              <div>
                <p className="text-sm font-medium text-fg">Rivian Account</p>
                <p className="text-xs text-fg-tertiary">Your credentials are encrypted at rest</p>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input label="Rivian Email"    type="email"    value={email}    onChange={(e) => setEmail(e.target.value)}    placeholder="you@example.com" required />
              <Input label="Rivian Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"        required />
              {error && <p className="text-xs text-[#F87171]">{error}</p>}
              <Button type="submit" loading={loading} className="mt-1">Connect Account</Button>
            </form>
          </Card>
        </div>
      </PageLayout>
    </AppLayout>
  );
}
