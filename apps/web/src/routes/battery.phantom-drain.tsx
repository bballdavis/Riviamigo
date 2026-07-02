import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { BatteryPhantomDrainPage } from '../components/dashboard/BatteryPhantomDrainPage';
import { ProtectedRoute } from '../components/layout/ProtectedRoute';

export const batteryPhantomDrainRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/battery/phantom-drain',
  component: () => (
    <ProtectedRoute>
      <BatteryPhantomDrainPage navKey="battery.phantom-drain" slug="battery" title="Phantom Drain" />
    </ProtectedRoute>
  ),
});
