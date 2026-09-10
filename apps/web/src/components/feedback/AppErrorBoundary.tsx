import React from 'react';
import { Button, Card } from '@riviamigo/ui/primitives';
import { reportClientError } from '@riviamigo/ui/lib/clientDiagnostics';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    const diagnosticError = info.componentStack
      ? new Error(`${error.message}\n${info.componentStack}`)
      : error;
    reportClientError(diagnosticError, {
      event: 'react.render_failed',
      area: 'render',
      operation: 'app-root',
      severity: 'error',
    });
  }

  private reload = () => {
    window.location.reload();
  };

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-page p-6" role="alert">
        <Card className="w-full max-w-md text-center">
          <h1 className="text-lg font-semibold text-fg">Riviamigo needs to reload</h1>
          <p className="mt-2 text-sm text-fg-secondary">
            The app hit an unexpected error. Reload to try again.
          </p>
          <Button type="button" className="mt-5" onClick={this.reload}>
            Reload app
          </Button>
        </Card>
      </main>
    );
  }
}
