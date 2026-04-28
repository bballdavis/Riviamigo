import React from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useVehicles } from '@riviamigo/hooks';
import {
  PageLayout, Card, CardHeader, CardTitle, CardContent,
  Button, Badge, ThemeToggle,
} from '@riviamigo/ui/primitives';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { Car, LogOut, Plus } from 'lucide-react';

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

function SettingsPage() {
  return <AuthGuard><SettingsContent /></AuthGuard>;
}

export function SettingsContent() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { data: vehicles } = useVehicles();

  async function handleLogout() {
    await logout();
    navigate({ to: '/login' });
  }

  return (
    <AppLayout activeKey="settings">
      <PageLayout title="Settings">
        <Card>
          <CardHeader>
            <CardTitle>Vehicles</CardTitle>
            <Button variant="secondary" size="sm" iconLeft={<Plus className="h-3.5 w-3.5" />}
              onClick={() => navigate({ to: '/connect' })}>
              Add Vehicle
            </Button>
          </CardHeader>
          <CardContent>
            {(vehicles?.length ?? 0) === 0 && (
              <p className="text-sm text-fg-tertiary">No vehicles connected yet.</p>
            )}
            {vehicles?.map((v) => (
              <div key={v.id} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                <div className="w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center">
                  <Car className="h-4 w-4 text-fg-secondary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg truncate">{v.display_name}</p>
                  <p className="text-xs text-fg-tertiary">{v.model} · {v.year}</p>
                </div>
                <Badge variant="success" dot>Active</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-fg">Theme</p>
                <p className="text-xs text-fg-tertiary mt-0.5">Toggle between dark and light mode</p>
              </div>
              <ThemeToggle />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="danger" size="sm" iconLeft={<LogOut className="h-3.5 w-3.5" />}
              onClick={handleLogout}>
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </PageLayout>
    </AppLayout>
  );
}
