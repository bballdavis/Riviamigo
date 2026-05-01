import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { useAuth, useVehicleHealth } from '@riviamigo/hooks';
import { AppLayout } from '../components/layout/AppLayout';
import { AuthGuard } from '../components/layout/AuthGuard';
import { NoVehicleState } from '../components/layout/NoVehicleState';
import { Card, CardContent, CardHeader, CardTitle, PageLayout, StatCard, StatCardGrid } from '@riviamigo/ui/primitives';
import { formatPressure } from '@riviamigo/ui/lib/utils';

export const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/health',
  component: VehicleHealthPage,
});

function VehicleHealthPage() {
  return <AuthGuard><VehicleHealthContent /></AuthGuard>;
}

function VehicleHealthContent() {
  const { defaultVehicleId } = useAuth();
  const { data, isLoading } = useVehicleHealth(defaultVehicleId);

  return (
    <AppLayout activeKey="health">
      <PageLayout title="Vehicle Health">
        {!defaultVehicleId ? (
          <NoVehicleState
            title="No vehicle selected"
            description="Connect your Rivian account to view vehicle health."
          />
        ) : (
          <>
            <StatCardGrid>
              <StatCard label="Current Software" value={data?.current_software_version ?? 'Unknown'} accent />
              <StatCard label="Thermal Events (30d)" value={String(data?.thermal_events_30d ?? 0)} />
              <StatCard label="Telemetry Updated" value={data?.generated_at ? new Date(data.generated_at).toLocaleString() : '—'} />
              <StatCard label="Software Entries" value={String(data?.software_history?.length ?? 0)} />
            </StatCardGrid>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Tire Pressure Snapshot</CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="text-sm text-fg-tertiary">Loading...</div>
                  ) : !data?.tires ? (
                    <div className="text-sm text-fg-tertiary">No tire telemetry found.</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <SnapshotItem label="Front Left" value={formatPressure(data.tires.tire_fl_psi)} status={data.tires.tire_fl_status} />
                      <SnapshotItem label="Front Right" value={formatPressure(data.tires.tire_fr_psi)} status={data.tires.tire_fr_status} />
                      <SnapshotItem label="Rear Left" value={formatPressure(data.tires.tire_rl_psi)} status={data.tires.tire_rl_status} />
                      <SnapshotItem label="Rear Right" value={formatPressure(data.tires.tire_rr_psi)} status={data.tires.tire_rr_status} />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Closures</CardTitle>
                </CardHeader>
                <CardContent>
                  {!data?.closures ? (
                    <div className="text-sm text-fg-tertiary">No closure telemetry found.</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <SnapshotItem label="Frunk" value={asOpenClosed(data.closures.closure_frunk_closed)} />
                      <SnapshotItem label="Liftgate" value={asOpenClosed(data.closures.closure_liftgate_closed)} />
                      <SnapshotItem label="Tailgate" value={asOpenClosed(data.closures.closure_tailgate_closed)} />
                      <SnapshotItem label="Front Left Door" value={asOpenClosed(data.closures.door_front_left_closed)} />
                      <SnapshotItem label="Front Right Door" value={asOpenClosed(data.closures.door_front_right_closed)} />
                      <SnapshotItem label="Rear Left Door" value={asOpenClosed(data.closures.door_rear_left_closed)} />
                      <SnapshotItem label="Rear Right Door" value={asOpenClosed(data.closures.door_rear_right_closed)} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Software History</CardTitle>
              </CardHeader>
              <CardContent>
                {(data?.software_history?.length ?? 0) === 0 ? (
                  <div className="text-sm text-fg-tertiary">No software version history yet.</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-tertiary">
                          <th className="py-2 pr-2">Version</th>
                          <th className="py-2 pr-2">Installed</th>
                          <th className="py-2">Observed Until</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data?.software_history.map((entry) => (
                          <tr key={`${entry.version}-${entry.installed_at}`} className="border-b border-border/50">
                            <td className="py-2 pr-2 font-mono text-fg">{entry.version}</td>
                            <td className="py-2 pr-2 text-fg-secondary">{new Date(entry.installed_at).toLocaleString()}</td>
                            <td className="py-2 text-fg-secondary">{entry.observed_until ? new Date(entry.observed_until).toLocaleString() : 'Current'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </PageLayout>
    </AppLayout>
  );
}

function SnapshotItem({ label, value, status }: { label: string; value: string; status?: string | null }) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated/70 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-fg-tertiary">{label}</div>
      <div className="mt-1 font-mono text-fg">{value}</div>
      {status ? <div className="mt-1 text-xs text-fg-tertiary">{status}</div> : null}
    </div>
  );
}

function asOpenClosed(value: boolean | null) {
  if (value === null) return 'Unknown';
  return value ? 'Closed' : 'Open';
}
