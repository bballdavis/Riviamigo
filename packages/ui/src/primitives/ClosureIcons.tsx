import * as React from 'react';

interface ClosureIconProps {
  className?: string | undefined;
}

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// Line icons traced from the Rivian app's "Open hood" and "Open liftgate"
// controls (shared with the Home Assistant dashboards). The glyphs are drawn
// around their own centres, so each group is re-centred in the 24-unit box.
export function FrunkIcon({ className }: ClosureIconProps) {
  return (
    <svg className={className} {...svgProps} strokeWidth={1.2}>
      <g transform="translate(12 12) scale(1.35) translate(-11.3 -9.2)">
        <path d="M5.9,15 V12.9 Q6.1,11.5 8,11.3 L15.4,10.7 L16.7,9.5" />
        <path d="M7.76,5.14 L13.6,10.95 M15.3,9.76 L9.24,3.66 A1.05,1.05 0 0 0 7.76,5.14" />
        <path d="M6.5,10.1 L8.7,7.6 M6.3,7.5 H8.7 V9.9" />
      </g>
    </svg>
  );
}

export function LiftgateIcon({ className }: ClosureIconProps) {
  return (
    <svg className={className} {...svgProps} strokeWidth={1.2}>
      <g transform="translate(12 12) scale(1.35) translate(-11.1 -9.75)">
        <path d="M6.2,4.3 H7.9 Q9.6,4.4 10.3,7.4 Q10.8,10 10.6,13 Q10.4,14.6 8.3,15.2 H6.1" />
        <path d="M9.3,4.7 H14.9 Q16.1,4.7 16.1,5.85 Q16.1,7 14.9,7 H9.9" />
        <path d="M12.3,11.4 L15.1,9.5 M12.8,9.2 H15.1 V11.6" />
      </g>
    </svg>
  );
}
