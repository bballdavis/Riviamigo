import { useId } from 'react';
import { TbCarSuvFilled } from 'react-icons/tb';
import { Button } from '@riviamigo/ui/primitives';
import { ArrowRight } from 'lucide-react';

interface ConnectedVehicleSuccessProps {
  vehicleName: string;
  onOpenDashboard: () => void;
}

const HILLS_LINE = "M-10,65 C20,65 50,25 75,25 C100,25 125,65 148,65 C165,65 195,16 220,16 C245,16 260,64 280,64 C298,64 320,35 342,35 C360,35 380,56 410,52";
const HILLS_FILL = `${HILLS_LINE} L410,80 L-10,80 Z`;
const MOTION_DURATION = '2.2s';

export function ConnectedVehicleSuccess({ vehicleName, onOpenDashboard }: ConnectedVehicleSuccessProps) {
  const hillPathId = `rm-success-hills-${useId().replace(/:/g, '')}`;

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
          <path
            id={hillPathId}
            d={HILLS_LINE}
            fill="none"
            stroke="var(--rm-accent)"
            strokeOpacity="0.25"
            strokeWidth="1.5"
          />

          <g
            className="rm-success-vehicle rm-success-vehicle-animated"
            transform="translate(-16 -29)"
            opacity="0"
          >
            <TbCarSuvFilled
              width="32"
              height="32"
              className="text-accent"
              aria-hidden="true"
              focusable="false"
              style={{ filter: 'drop-shadow(0 1px 6px color-mix(in oklab, var(--rm-accent) 50%, transparent))' }}
            />

            <animateMotion
              dur={MOTION_DURATION}
              calcMode="paced"
              rotate="auto"
              repeatCount="indefinite"
            >
              <mpath href={`#${hillPathId}`} />
            </animateMotion>
            <animate
              attributeName="opacity"
              dur={MOTION_DURATION}
              keyTimes="0;0.12;0.82;1"
              repeatCount="indefinite"
              values="0;1;1;0"
            />
          </g>

          <g
            className="rm-success-vehicle rm-success-vehicle-static"
            transform="translate(200 25) translate(-16 -29)"
          >
            <TbCarSuvFilled
              width="32"
              height="32"
              className="text-accent"
              aria-hidden="true"
              focusable="false"
              style={{ filter: 'drop-shadow(0 1px 6px color-mix(in oklab, var(--rm-accent) 50%, transparent))' }}
            />
          </g>
        </svg>
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
