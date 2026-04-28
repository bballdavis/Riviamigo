import { Button } from '@riviamigo/ui/primitives';
import { Car, Gauge, ArrowRight } from 'lucide-react';

interface ConnectedVehicleSuccessProps {
  vehicleName: string;
  onOpenDashboard: () => void;
}

export function ConnectedVehicleSuccess({ vehicleName, onOpenDashboard }: ConnectedVehicleSuccessProps) {
  return (
    <div className="py-3 text-center">
      <div className="relative mx-auto h-20 max-w-sm overflow-hidden rounded-xl border border-border bg-bg-elevated/40">
        <div className="absolute inset-x-8 bottom-5 h-px bg-border-strong" />
        <div className="rm-drive-across absolute bottom-6 left-0 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-fg-on-accent shadow-glow-button">
          <Car className="h-6 w-6" />
        </div>
        <div className="absolute right-6 top-5 flex h-8 w-8 items-center justify-center rounded-lg bg-bg-surface text-accent">
          <Gauge className="h-4 w-4" />
        </div>
      </div>

      <div className="mx-auto mt-7 max-w-sm">
        <p className="font-display text-xl font-semibold text-fg">Vehicle added</p>
        <p className="mt-2 text-sm leading-6 text-fg-secondary">
          {vehicleName} is connected and ready for Riviamigo telemetry.
        </p>
      </div>

      <Button className="mt-7" iconRight={<ArrowRight className="h-4 w-4" />} onClick={onOpenDashboard}>
        Open Dashboard
      </Button>
    </div>
  );
}
