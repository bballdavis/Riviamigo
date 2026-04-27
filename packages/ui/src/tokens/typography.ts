export const typography = {
  fonts: {
    display: '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif',
    sans:    '"Inter Variable", "Inter", system-ui, sans-serif',
    mono:    '"JetBrains Mono Variable", "JetBrains Mono", "Fira Code", monospace',
  },
  sizes: {
    xs:   '0.75rem',   sm:   '0.875rem',  base: '1rem',
    lg:   '1.125rem',  xl:   '1.25rem',   '2xl': '1.5rem',
    '3xl':'2rem',      '4xl':'2.5rem',    '5xl': '3.5rem',
    '6xl':'4.5rem',    '7xl':'6rem',
  },
  weights: { normal: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeights: { tight: '1.15', normal: '1.5', relaxed: '1.7' },
  tracking: {
    tight:  '-0.02em',
    normal: '0',
    wide:   '0.025em',
    wider:  '0.05em',
  },
  numeric: '"tnum"',
} as const;
