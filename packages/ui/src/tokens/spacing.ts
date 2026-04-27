export const spacing = {
  px: '1px', 0.5: '0.125rem', 1: '0.25rem', 1.5: '0.375rem',
  2: '0.5rem',  3: '0.75rem',  4: '1rem',    5: '1.25rem',
  6: '1.5rem',  8: '2rem',    10: '2.5rem', 12: '3rem',
  16: '4rem',  20: '5rem',    24: '6rem',   32: '8rem',
} as const;

export const layout = {
  borderRadius: {
    sm: '0.375rem', md: '0.5rem', lg: '0.75rem',
    xl: '1rem', '2xl': '1.5rem', full: '9999px',
  },
  shadows: {
    sm: 'var(--rm-shadow-sm)', md: 'var(--rm-shadow-md)',
    lg: 'var(--rm-shadow-lg)', xl: 'var(--rm-shadow-xl)',
  },
  glow: {
    sm:     'var(--rm-glow-sm)',
    md:     'var(--rm-glow-md)',
    lg:     'var(--rm-glow-lg)',
    button: 'var(--rm-glow-button)',
  },
  chartHeight: {
    sparkline: 64, compact: 200, default: 320, tall: 480, full: 640,
  },
  sidebar: {
    width: 256, widthCollapsed: 72, breakpoint: 'lg' as const,
  },
} as const;

export const motion = {
  duration: { fast: 150, base: 200, slow: 300, slower: 500 },
  easing: {
    out:    'cubic-bezier(0.16, 1, 0.3, 1)',
    inOut:  'cubic-bezier(0.65, 0, 0.35, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;
