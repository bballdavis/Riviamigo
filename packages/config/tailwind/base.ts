import type { Config } from 'tailwindcss';

export const tailwindBase: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          50: '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D',
          400: '#FBBF24', 500: '#F59E0B', 600: '#D97706', 700: '#B45309',
          800: '#92400E', 900: '#78350F',
          DEFAULT: 'var(--rm-accent)',
          hover:   'var(--rm-accent-hover)',
          muted:   'var(--rm-accent-muted)',
        },
        slate: {
          50: '#FAFAF7', 100: '#F4F4EE', 200: '#E5E5DD', 300: '#D4D4C8',
          400: '#A1A1A1', 500: '#71717A', 600: '#52525B', 700: '#3F3F46',
          800: '#27272A', 850: '#1A1A24', 900: '#12121A', 950: '#0A0A0F',
        },
        soc: {
          high: '#10B981', mid: '#F59E0B', low: '#F87171',
        },
        charging: {
          active: '#F59E0B', done: '#10B981', limited: '#F87171',
          ac: '#60A5FA', dc: '#A78BFA', dcfc: '#C084FC',
        },
        bg: {
          page:     'var(--rm-bg-page)',
          surface:  'var(--rm-bg-surface)',
          elevated: 'var(--rm-bg-elevated)',
          glass:    'var(--rm-bg-glass)',
        },
        fg: {
          DEFAULT:    'var(--rm-text-primary)',
          secondary:  'var(--rm-text-secondary)',
          tertiary:   'var(--rm-text-tertiary)',
          disabled:   'var(--rm-text-disabled)',
          'on-accent':'var(--rm-text-on-accent)',
        },
        border: {
          DEFAULT: 'var(--rm-border-default)',
          strong:  'var(--rm-border-strong)',
          accent:  'var(--rm-border-accent)',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk Variable"', '"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans:    ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono Variable"', '"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      borderRadius: {
        sm: '0.375rem', md: '0.5rem', lg: '0.75rem',
        xl: '1rem', '2xl': '1.5rem',
      },
      boxShadow: {
        sm: 'var(--rm-shadow-sm)', md: 'var(--rm-shadow-md)',
        lg: 'var(--rm-shadow-lg)', xl: 'var(--rm-shadow-xl)',
        'glow-sm':     'var(--rm-glow-sm)',
        'glow-md':     'var(--rm-glow-md)',
        'glow-lg':     'var(--rm-glow-lg)',
        'glow-button': 'var(--rm-glow-button)',
      },
      backdropBlur: { xs: '2px', sm: '4px', md: '8px', lg: '12px' },
      animation: {
        'pulse-glow': 'pulseGlow 2.5s ease-in-out infinite',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(245,158,11,0.4)' },
          '50%':      { boxShadow: '0 0 0 6px rgba(245,158,11,0)' },
        },
      },
    },
  },
};
