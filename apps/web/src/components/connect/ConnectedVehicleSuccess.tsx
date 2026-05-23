import { TbCarSuvFilled } from 'react-icons/tb';
import { Button } from '@riviamigo/ui/primitives';
import { ArrowRight } from 'lucide-react';

interface ConnectedVehicleSuccessProps {
  vehicleName: string;
  onOpenDashboard: () => void;
}

const HILLS_FILL = "M-10,65 C20,65 50,25 75,25 C100,25 125,65 148,65 C165,65 195,16 220,16 C245,16 260,64 280,64 C298,64 320,35 342,35 C360,35 380,56 410,52 L410,80 L-10,80 Z";
const HILLS_LINE = "M-10,65 C20,65 50,25 75,25 C100,25 125,65 148,65 C165,65 195,16 220,16 C245,16 260,64 280,64 C298,64 320,35 342,35 C360,35 380,56 410,52";

export function ConnectedVehicleSuccess({ vehicleName, onOpenDashboard }: ConnectedVehicleSuccessProps) {
  return (
    <div className="py-3 text-center">
      <div className="relative mx-auto h-24 max-w-sm overflow-hidden rounded-xl border border-border bg-bg-elevated/40">
        <svg
          viewBox="0 0 400 80"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <path d={HILLS_FILL} fill="var(--rm-accent)" fillOpacity="0.08" />
          <path d={HILLS_LINE} fill="none" stroke="var(--rm-accent)" strokeOpacity="0.25" strokeWidth="1.5" />
        </svg>

        {/* Outer div carries horizontal travel; inner div carries vertical hill bob */}
        <div className="rm-drive-across absolute bottom-4 left-0">
          <div className="rm-hills-y">
            <TbCarSuvFilled
              className="h-8 w-8 text-accent"
              style={{ filter: 'drop-shadow(0 1px 6px color-mix(in oklab, var(--rm-accent) 50%, transparent))' }}
            />
          </div>
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
