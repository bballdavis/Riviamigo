import React from 'react';
import { AuthGuard } from './AuthGuard';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
